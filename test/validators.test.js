import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { searchProfilesSchema, askProfilesSchema } from "../src/validators/search.validator.js";
import { requestOtpSchema, verifyOtpSchema } from "../src/validators/auth.validator.js";
import { password, notEmail } from "../src/validators/common.validator.js";
import { updateUserSchema, createUserSchema, listUsersQuerySchema } from "../src/validators/user.validator.js";

const passes = (schema, body) => schema.safeParse(body).success;

describe("searchProfilesSchema", () => {
    it("fills defaults", () => {
        const { data } = searchProfilesSchema.safeParse({ query: "node developer" });
        assert.deepEqual(data, {
            query: "node developer",
            requireResume: true,
            hideMine: false,
            hideTeam: false,
            limit: 5,
            charsPerDocument: 4000,
        });
    });

    it("caps limit x charsPerDocument at MAX_CONTEXT_CHARS", () => {
        assert.equal(passes(searchProfilesSchema, { query: "node", limit: 40, charsPerDocument: 5000 }), true);
        assert.equal(passes(searchProfilesSchema, { query: "node", limit: 10, charsPerDocument: 20000 }), true);
        assert.equal(passes(searchProfilesSchema, { query: "node", limit: 40, charsPerDocument: 8000 }), false);
    });

    it("rejects unknown keys and short queries", () => {
        assert.equal(passes(searchProfilesSchema, { query: "node", extra: 1 }), false);
        assert.equal(passes(searchProfilesSchema, { query: "no" }), false);
    });
});

describe("askProfilesSchema", () => {
    it("applies the size cap with defaults when opening a conversation", () => {
        // 5 (default limit) x 20000 is within the cap; 20 x 12000 is not.
        assert.equal(passes(askProfilesSchema, { question: "who fits", charsPerDocument: 20000 }), true);
        assert.equal(passes(askProfilesSchema, { question: "who fits", limit: 20, charsPerDocument: 12000 }), false);
    });

    it("refuses to change pinned options on a follow-up", () => {
        const conversationId = randomUUID();
        assert.equal(passes(askProfilesSchema, { question: "who fits", conversationId }), true);
        for (const field of [
            { limit: 5 },
            { charsPerDocument: 4000 },
            { requireResume: false },
            { hideMine: true },
            { hideTeam: true },
        ]) {
            assert.equal(passes(askProfilesSchema, { question: "who fits", conversationId, ...field }), false);
        }
    });
});

describe("auth and user schemas", () => {
    it("accepts only a 6-digit code", () => {
        assert.equal(passes(verifyOtpSchema, { email: "a@b.com", code: "012345" }), true);
        assert.equal(passes(verifyOtpSchema, { email: "a@b.com", code: "12345" }), false);
        assert.equal(passes(verifyOtpSchema, { email: "a@b.com", code: "12345a" }), false);
    });

    it("requires a password to sign in, and keeps it exactly as typed", () => {
        assert.equal(passes(requestOtpSchema, { email: "a@b.com" }), false);
        assert.equal(passes(requestOtpSchema, { email: "a@b.com", password: "" }), false);
        assert.equal(passes(requestOtpSchema, { email: "a@b.com", password: "x".repeat(129) }), false);

        const { data } = requestOtpSchema.safeParse({ email: "A@B.com", password: "  Short  " });
        assert.deepEqual(data, { email: "a@b.com", password: "  Short  " });
    });

    it("holds a new password to 12-128 characters without trimming it", () => {
        assert.equal(passes(password, "x".repeat(11)), false);
        assert.equal(passes(password, "x".repeat(12)), true);
        assert.equal(passes(password, "x".repeat(128)), true);
        assert.equal(passes(password, "x".repeat(129)), false);
        // Surrounding spaces count toward the length and survive parsing.
        assert.equal(password.safeParse("  " + "x".repeat(10)).success, true);
        assert.equal(password.safeParse("  " + "x".repeat(10)).data, "  " + "x".repeat(10));
    });

    it("recognises a password that is just the email address", () => {
        assert.equal(notEmail("Someone@IKRUX.com", "someone@ikrux.com"), false);
        assert.equal(notEmail("another password", "someone@ikrux.com"), true);
    });

    it("normalises email case", () => {
        const { data } = createUserSchema.safeParse({ email: "  Someone@IKRUX.com ", name: "A" });
        assert.equal(data.email, "someone@ikrux.com");
    });

    it("rejects an empty update", () => {
        assert.equal(passes(updateUserSchema, {}), false);
        assert.equal(passes(updateUserSchema, { active: false }), true);
    });
});

describe("listUsersQuerySchema", () => {
    it("defaults to newest first and accepts filters", () => {
        const { data } = listUsersQuerySchema.safeParse({ q: " ann ", role: "admin", status: "disabled" });
        assert.deepEqual(data, {
            page: 1,
            limit: 20,
            q: "ann",
            role: "admin",
            status: "disabled",
            sort: "created_at",
            order: "desc",
        });
    });

    it("only sorts on known columns", () => {
        assert.equal(passes(listUsersQuerySchema, { sort: "name", order: "asc" }), true);
        assert.equal(passes(listUsersQuerySchema, { sort: "password" }), false);
        assert.equal(passes(listUsersQuerySchema, { status: "deleted" }), false);
    });
});
