import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import { searchProfiles } from "../services/profileRetriever.service.js";
import { askProfiles, openConversation, resolveConversation, streamAnswer } from "../services/rag.service.js";
import { getConversation, beginTurn, endTurn, deleteConversation } from "../services/conversation.service.js";
import { recordActivity, teamActivityFor, excludedProfileIds } from "../services/activity.service.js";
import { track, requestLog } from "../utils/requestStats.js";
import { ACTIVITY } from "../constants.js";

/**
 * Candidates as a recruiter's screen gets them: without contact details,
 * which are revealed one candidate at a time (and recorded, see
 * candidate.controller), and with what the team has done with each. The team
 * summary is a nicety; if it fails the results still go out, with team null.
 */
const present = async (profiles, userId) => {
    const team = await teamActivityFor({ userId, profileIds: profiles.map((profile) => profile.id) }).catch(
        (error) => {
            requestLog().warn({ err: error }, "team activity unavailable");
            return new Map();
        }
    );

    return profiles.map(({ document, email, phone, ...profile }) => ({
        ...profile,
        hasEmail: Boolean(email),
        hasPhone: Boolean(phone),
        team: team.get(profile.id) ?? null,
    }));
};

const recordResults = ({ userId, profiles, query, meta }) =>
    recordActivity({
        userId,
        type: ACTIVITY.SEARCH_RESULTS,
        profileIds: profiles.map((profile) => profile.id),
        query,
        meta: { count: profiles.length, ...meta },
    });

// With the model's token counts, so admins can see what each recruiter's
// questions cost. An answer that was stopped part-way isn't recorded.
const recordQuestion = ({ userId, question, conversation, tokens }) =>
    recordActivity({
        userId,
        type: ACTIVITY.QUESTION,
        query: question,
        meta: {
            conversationId: conversation.id,
            turn: conversation.turns,
            model: process.env.OPENAI_MODEL,
            ...(tokens ?? {}),
        },
    });

// A conversation that is missing, expired or owned by someone else all answer
// the same way: a 403 would confirm that an id belongs to a live conversation.
const conversationNotFound = () =>
    new ApiError(404, "Conversation not found", [
        "It may have been ended or evicted, or it was not started by this user",
    ]);

const searchProfilesController = asyncHandler(async (req, res) => {
    const { query, limit, charsPerDocument, requireResume, hideMine, hideTeam } = req.validated.body;
    const userId = req.user._id.toString();

    const exclude = await excludedProfileIds({ userId, hideMine, hideTeam });
    const profiles = await searchProfiles({ query, limit, requireResume, exclude });

    const conversation = await openConversation({
        userId,
        question: query,
        profiles,
        limit,
        charsPerDocument,
    });

    const results = await present(profiles, userId);
    await recordResults({
        userId,
        profiles,
        query,
        meta: { source: "search", requireResume, hideMine, hideTeam },
    });

    return res.status(200).json(
        new ApiResponse(200, "Profiles matched", {
            query,
            requireResume,
            requested: limit,
            count: profiles.length,
            pinnedForChat: conversation.sources.length,
            conversationId: conversation.id,
            results,
        })
    );
});

const askProfilesController = asyncHandler(async (req, res) => {
    const { question, limit, charsPerDocument, conversationId, requireResume, hideMine, hideTeam } =
        req.validated.body;

    // req.user._id is an ObjectId; comparing it to a stored string without
    // toString() would make every follow-up look like someone else's.
    const userId = req.user._id.toString();

    const existing = conversationId ? await getConversation({ conversationId, userId }) : null;

    if (conversationId && !existing) {
        throw conversationNotFound();
    }

    if (existing && !(await beginTurn({ conversation: existing }))) {
        throw new ApiError(409, "Conversation is busy", [
            "Wait for the previous question in this conversation to finish",
        ]);
    }

    try {
        const exclude = existing ? null : await excludedProfileIds({ userId, hideMine, hideTeam });
        const { answer, model, sources, conversation, created, tokens } = await askProfiles({
            question,
            limit,
            charsPerDocument,
            requireResume,
            conversation: existing,
            userId,
            exclude,
        });

        const shown = await present(sources, userId);
        if (created) {
            await recordResults({
                userId,
                profiles: sources,
                query: question,
                meta: { source: "ask", requireResume, hideMine, hideTeam },
            });
        }
        await recordQuestion({ userId, question, conversation, tokens });

        return res.status(200).json(
            new ApiResponse(200, "Answer generated", {
                conversationId: conversation.id,
                turn: conversation.turns,
                question,
                answer,
                model,
                sources: shown,
            })
        );
    } finally {
        if (existing) await endTurn({ conversation: existing });
    }
});

// Keeps idle proxies from closing the stream while retrieval runs and before
// the first token arrives.
const HEARTBEAT_MS = 15 * 1000;

/**
 * The same answer as /search/ask, as server-sent events: `meta` once the set
 * is known (so the client can show it while the answer is written), `token`
 * per piece of text, then `done` with the full answer, or `error`. Anything
 * that fails before the stream opens is an ordinary JSON error response.
 * Closing the connection stops the model and records nothing.
 */
const askStreamController = asyncHandler(async (req, res) => {
    const { question, limit, charsPerDocument, conversationId, requireResume, hideMine, hideTeam } =
        req.validated.body;
    const userId = req.user._id.toString();

    const existing = conversationId ? await getConversation({ conversationId, userId }) : null;

    if (conversationId && !existing) {
        throw conversationNotFound();
    }

    if (existing && !(await beginTurn({ conversation: existing }))) {
        throw new ApiError(409, "Conversation is busy", [
            "Wait for the previous question in this conversation to finish",
        ]);
    }

    const controller = new AbortController();
    const onClose = () => {
        if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);

    // A stream has no Content-Length, so its size is counted as it goes.
    const send = (event, data) => {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        track("stream", { events: 1, bytes: Buffer.byteLength(frame) });
        return res.write(frame);
    };

    let active = existing;
    let created = false;
    let opened = false;
    let heartbeat;

    try {
        const exclude = existing ? null : await excludedProfileIds({ userId, hideMine, hideTeam });
        ({ active, created } = await resolveConversation({
            question,
            limit,
            charsPerDocument,
            requireResume,
            conversation: existing,
            userId,
            exclude,
        }));
        const shown = await present(active.sources, userId);

        controller.signal.throwIfAborted();

        res.status(200).set({
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        opened = true;
        heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

        send("meta", { conversationId: active.id, sources: shown });
        if (created) {
            await recordResults({
                userId,
                profiles: active.sources,
                query: question,
                meta: { source: "ask", requireResume, hideMine, hideTeam },
            });
        }

        let tokens = null;
        const answer = await streamAnswer({
            conversation: active,
            question,
            signal: controller.signal,
            onToken: (text) => send("token", { text }),
            onUsage: (counts) => (tokens = counts),
        });

        send("done", {
            conversationId: active.id,
            turn: active.turns,
            question,
            answer,
            model: process.env.OPENAI_MODEL,
            sources: shown,
        });
        res.end();
        // Not awaited: the turn is released below without waiting on it, and
        // recordActivity never throws.
        void recordQuestion({ userId, question, conversation: active, tokens });
    } catch (error) {
        if (controller.signal.aborted) {
            // The client never learned this conversation's id, so nobody
            // else will end it.
            if (created && !opened) await deleteConversation({ conversationId: active.id, userId });
            return;
        }
        if (!opened) throw error;

        req.log.error({ err: error }, "stream failed after it opened");
        const clientError = error instanceof ApiError && error.statusCode < 500;
        send("error", {
            statusCode: clientError ? error.statusCode : 500,
            message: clientError ? error.message : "Internal Server Error",
            errors: clientError ? error.errors : [],
        });
        res.end();
    } finally {
        clearInterval(heartbeat);
        res.off("close", onClose);
        if (existing) await endTurn({ conversation: existing });
    }
});

const endConversationController = asyncHandler(async (req, res) => {
    const { conversationId } = req.validated.body;
    const userId = req.user._id.toString();

    if (!(await deleteConversation({ conversationId, userId }))) {
        throw conversationNotFound();
    }

    return res
        .status(200)
        .json(new ApiResponse(200, "Conversation ended", { conversationId }));
});

export { searchProfilesController, askProfilesController, askStreamController, endConversationController };
