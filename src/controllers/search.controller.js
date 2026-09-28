import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import { searchProfiles } from "../services/profileRetriever.service.js";
import { askProfiles, openConversation } from "../services/rag.service.js";
import { getConversation, beginTurn, endTurn, deleteConversation } from "../services/conversation.service.js";

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

export { searchProfilesController, askProfilesController, endConversationController };
