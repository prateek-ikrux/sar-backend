import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import { searchProfiles } from "../services/profileRetriever.service.js";
import { askProfiles, openConversation, resolveConversation, streamAnswer } from "../services/rag.service.js";
import { getConversation, beginTurn, endTurn, deleteConversation } from "../services/conversation.service.js";
import { track } from "../utils/requestStats.js";

// A conversation that is missing, expired or owned by someone else all answer
// the same way: a 403 would confirm that an id belongs to a live conversation.
const conversationNotFound = () =>
    new ApiError(404, "Conversation not found", [
        "It may have been ended or evicted, or it was not started by this user",
    ]);

const searchProfilesController = asyncHandler(async (req, res) => {
    const { query, limit, charsPerDocument, requireResume } = req.validated.body;
    const userId = req.user._id.toString();

    const profiles = await searchProfiles({ query, limit, requireResume });

    const conversation = await openConversation({
        userId,
        question: query,
        profiles,
        limit,
        charsPerDocument,
    });

    return res.status(200).json(
        new ApiResponse(200, "Profiles matched", {
            query,
            requireResume,
            requested: limit,
            count: profiles.length,
            pinnedForChat: conversation.sources.length,
            conversationId: conversation.id,
            results: profiles.map(({ document, ...profile }) => profile),
        })
    );
});

const askProfilesController = asyncHandler(async (req, res) => {
    const { question, limit, charsPerDocument, conversationId, requireResume } = req.validated.body;

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
        const { answer, model, sources, conversation } = await askProfiles({
            question,
            limit,
            charsPerDocument,
            requireResume,
            conversation: existing,
            userId,
        });

        return res.status(200).json(
            new ApiResponse(200, "Answer generated", {
                conversationId: conversation.id,
                turn: conversation.turns,
                question,
                answer,
                model,
                sources,
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
    const { question, limit, charsPerDocument, conversationId, requireResume } = req.validated.body;
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
        ({ active, created } = await resolveConversation({
            question,
            limit,
            charsPerDocument,
            requireResume,
            conversation: existing,
            userId,
        }));

        controller.signal.throwIfAborted();

        res.status(200).set({
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        opened = true;
        heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

        send("meta", { conversationId: active.id, sources: active.sources });

        const answer = await streamAnswer({
            conversation: active,
            question,
            signal: controller.signal,
            onToken: (text) => send("token", { text }),
        });

        send("done", {
            conversationId: active.id,
            turn: active.turns,
            question,
            answer,
            model: process.env.OPENAI_MODEL,
            sources: active.sources,
        });
        res.end();
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
