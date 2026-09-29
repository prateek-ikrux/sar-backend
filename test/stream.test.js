import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { applyTestEnv, serve } from "./support/helpers.js";

// A stand-in for OpenAI's streaming chat completions endpoint, so the whole
// path runs -- SSE framing, turn recording, abort -- without the real API.
const CHUNKS = ["Candidate ", "[1] ", "fits best."];
let delayMs = 0;
const fakeOpenAI = http.createServer(async (req, res) => {
    for await (const _ of req);
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const content of CHUNKS) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (res.destroyed) return;
        res.write(
            `data: ${JSON.stringify({
                id: "x",
                object: "chat.completion.chunk",
                created: 0,
                model: "test",
                choices: [{ index: 0, delta: { content }, finish_reason: null }],
            })}\n\n`
        );
    }
    // Asked for with stream_options.include_usage: counts, and no choices.
    res.write(
        `data: ${JSON.stringify({
            id: "x",
            object: "chat.completion.chunk",
            created: 0,
            model: "test",
            choices: [],
            usage: { prompt_tokens: 120, completion_tokens: 5, total_tokens: 125 },
        })}\n\n`
    );
    res.end("data: [DONE]\n\n");
});
fakeOpenAI.listen(0);
await once(fakeOpenAI, "listening");

applyTestEnv({ OPENAI_BASE_URL: `http://127.0.0.1:${fakeOpenAI.address().port}/v1` });

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { createConversation, getConversation } = await import("../src/services/conversation.service.js");
const { default: logger } = await import("../src/utils/logger.js");

const userId = "d".repeat(24);
User.findById = async () => ({ _id: new mongoose.Types.ObjectId(userId), role: "recruiter", active: true });
const token = jwt.sign({ _id: userId }, process.env.ACCESS_TOKEN_SECRET);

const conversation = () =>
    createConversation({
        userId,
        question: "node developer",
        context: "<profiles></profiles>",
        sources: [{ id: "p1", fileName: "a.pdf", resumeUrl: "https://files/a.pdf" }],
        limit: 5,
        charsPerDocument: 4000,
    });

const events = (text) =>
    text
        .split("\n\n")
        .filter((block) => block.startsWith("event:"))
        .map((block) => {
            const [event, data] = block.split("\n");
            return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
        });

let server;
before(async () => (server = await serve(app)));
after(async () => {
    await server.close();
    fakeOpenAI.closeAllConnections();
    fakeOpenAI.close();
});

const post = (body, signal) =>
    fetch(`${server.base}/search/ask/stream`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
    });

describe("POST /search/ask/stream on a pinned conversation", () => {
    it("streams meta, tokens and done, and records the turn", async () => {
        const pinned = await conversation();
        const response = await post({ question: "who fits best", conversationId: pinned.id });

        assert.equal(response.status, 200);
        assert.ok(response.headers.get("content-type").startsWith("text/event-stream"));

        const received = events(await response.text());
        assert.deepEqual(received.map((e) => e.event), ["meta", "token", "token", "token", "done"]);
        assert.equal(received[0].data.conversationId, pinned.id);
        assert.equal(received.at(-1).data.answer, CHUNKS.join(""));

        const stored = await getConversation({ conversationId: pinned.id, userId });
        assert.equal(stored.turns, 1);
        assert.equal(stored.busy, false);
    });

    it("logs the model's token counts and the stream's size, not its text", async () => {
        // Each request logs through a child logger; this one records.
        const lines = [];
        const child = logger.child;
        logger.child = (bindings) => ({ info: (fields) => lines.push({ ...bindings, ...fields }) });
        try {
            const pinned = await conversation();
            const response = await post({ question: "who fits best", conversationId: pinned.id });
            await response.text();
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            logger.child = child;
        }

        const line = lines.find((l) => l.path === "/api/v1/search/ask/stream");
        assert.equal(line.llm.outcome, "ok");
        assert.equal(line.llm.inputTokens, 120);
        assert.equal(line.llm.outputTokens, 5);
        assert.equal(line.llm.historyMessages, 0);
        assert.equal(line.stream.events, 5);
        assert.ok(line.stream.bytes > 0);
        assert.equal(JSON.stringify(line).includes("fits best"), false);
    });

    it("records nothing when the client stops reading", async () => {
        delayMs = 150;
        try {
            const pinned = await conversation();
            const controller = new AbortController();
            const response = await post({ question: "who fits best", conversationId: pinned.id }, controller.signal);
            const reader = response.body.getReader();
            await reader.read();
            controller.abort();

            // Give the server a moment to see the close and unwind.
            await new Promise((resolve) => setTimeout(resolve, 600));
            const stored = await getConversation({ conversationId: pinned.id, userId });
            assert.equal(stored.turns, 0);
            assert.equal(stored.busy, false);
        } finally {
            delayMs = 0;
        }
    });
});
