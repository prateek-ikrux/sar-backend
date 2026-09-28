import { randomUUID } from "node:crypto";
import {
    MAX_CONVERSATIONS,
    MAX_CONVERSATIONS_PER_USER,
    MAX_STORED_MESSAGES,
} from "../constants.js";

const conversations = new Map();

const evictOldestForUser = (userId) => {
    const owned = [];

    for (const [id, conversation] of conversations) {
        if (conversation.userId === userId) owned.push(id);
    }

    // Per-user cap is applied before the global one so that a single user
    // cannot push everyone else's conversations out by opening new ones.
    while (owned.length >= MAX_CONVERSATIONS_PER_USER) {
        conversations.delete(owned.shift());
    }
};

// Conversations do not expire on a clock. They live until evicted by the caps
// below, ended explicitly, or lost on restart.
const createConversation = async ({
    userId,
    question,
    context,
    sources,
    limit,
    charsPerDocument,
}) => {
    evictOldestForUser(userId);

    while (conversations.size >= MAX_CONVERSATIONS) {
        conversations.delete(conversations.keys().next().value);
    }

    const createdAt = Date.now();
    const conversation = {
        id: randomUUID(),
        userId,
        question,
        context,
        sources,
        resumeUrlsIssuedAt: createdAt,
        limit,
        charsPerDocument,
        messages: [],
        turns: 0,
        createdAt,
        lastUsedAt: createdAt,
        busy: false,
    };

    conversations.set(conversation.id, conversation);

    return conversation;
};

// Returns null for a miss and for another user's record alike, so the caller
// cannot tell those cases apart.
const getConversation = async ({ conversationId, userId }) => {
    const conversation = conversations.get(conversationId);

    if (!conversation) return null;
    if (conversation.userId !== userId) return null;

    conversation.lastUsedAt = Date.now();

    // Re-inserting moves the entry to the end, which turns Map insertion order
    // into least-recently-used order for eviction.
    conversations.delete(conversationId);
    conversations.set(conversationId, conversation);

    return conversation;
};

const appendTurn = async ({ conversation, humanMessage, aiMessage }) => {
    conversation.messages.push(humanMessage, aiMessage);

    if (conversation.messages.length > MAX_STORED_MESSAGES) {
        conversation.messages = conversation.messages.slice(-MAX_STORED_MESSAGES);
    }

    conversation.turns += 1;

    return conversation;
};

const beginTurn = async ({ conversation }) => {
    if (conversation.busy) return false;

    conversation.busy = true;
    return true;
};

const endTurn = async ({ conversation }) => {
    conversation.busy = false;
};

const deleteConversation = async ({ conversationId, userId }) => {
    const conversation = await getConversation({ conversationId, userId });

    if (!conversation) return false;

    conversations.delete(conversationId);
    return true;
};

const conversationCount = () => conversations.size;

export {
    createConversation,
    getConversation,
    appendTurn,
    beginTurn,
    endTurn,
    deleteConversation,
    conversationCount,
};
