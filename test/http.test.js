import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { applyTestEnv, serve } from "./support/helpers.js";

applyTestEnv();

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: ApiError } = await import("../src/utils/apiError.js");
const { errorHandler } = await import("../src/middlewares/error.middleware.js");

// No database here: user lookups and writes are stubbed on the model.
const ids = { admin: "a".repeat(24), recruiter: "b".repeat(24), disabled: "c".repeat(24) };
const users = {
    [ids.admin]: { role: "admin", active: true },
    [ids.recruiter]: { role: "recruiter", active: true },
    [ids.disabled]: { role: "admin", active: false },
};
User.findById = async (id) => {
    const user = users[String(id)];
    return user ? { _id: new mongoose.Types.ObjectId(String(id)), ...user } : null;
};
User.findByIdAndUpdate = async (id, updates) => ({ _id: id, ...updates });
User.findByIdAndDelete = async (id) => ({ _id: id });

const token = (id) => jwt.sign({ _id: id }, process.env.ACCESS_TOKEN_SECRET);

let http;
before(async () => (http = await serve(app)));
after(() => http.close());

describe("headers", () => {
    it("sets security headers and hides Express", async () => {
        const { headers } = await http.request("GET", "/health");
        assert.equal(headers.get("x-content-type-options"), "nosniff");
        assert.equal(headers.get("x-powered-by"), null);
    });

    it("allows only the configured origins, without credentials", async () => {
        const allowed = await http.request("GET", "/health", { headers: { origin: "http://localhost:3000" } });
        const other = await http.request("GET", "/health", { headers: { origin: "https://evil.example" } });

        assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");
        assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
        assert.equal(other.headers.get("access-control-allow-origin"), null);
    });
});

describe("verifyJWT", () => {
    it("requires the Bearer scheme", async () => {
        const raw = await http.request("GET", "/users/list", { headers: { authorization: token(ids.admin) } });
        const basic = await http.request("GET", "/users/list", { headers: { authorization: "Basic abc" } });
        const none = await http.request("GET", "/users/list");

        for (const response of [raw, basic, none]) assert.equal(response.status, 401);
        assert.deepEqual(none.body.errors, ["No token provided"]);
    });

    it("rejects a token signed with another algorithm or secret", async () => {
        const forged = jwt.sign({ _id: ids.admin }, "some-other-secret");
        const unsigned = jwt.sign({ _id: ids.admin }, null, { algorithm: "none" });

        for (const bad of [forged, unsigned]) {
            assert.equal((await http.request("GET", "/users/list", { token: bad })).status, 401);
        }
    });

    it("rejects a deactivated user's token", async () => {
        assert.equal((await http.request("GET", "/users/list", { token: token(ids.disabled) })).status, 401);
    });
});

describe("admin-only routes", () => {
    it("refuse recruiters", async () => {
        const asRecruiter = { token: token(ids.recruiter) };

        assert.equal((await http.request("GET", "/users/list", asRecruiter)).status, 403);
        assert.equal((await http.request("GET", "/health/services", asRecruiter)).status, 403);
        const promote = await http.request("PUT", `/users/update/${ids.recruiter}`, {
            ...asRecruiter,
            body: { role: "admin" },
        });
        assert.equal(promote.status, 403);
    });

    it("stop an admin from demoting, disabling or deleting themselves", async () => {
        const asAdmin = { token: token(ids.admin) };

        for (const body of [{ role: "recruiter" }, { active: false }]) {
            assert.equal((await http.request("PUT", `/users/update/${ids.admin}`, { ...asAdmin, body })).status, 403);
        }
        assert.equal((await http.request("DELETE", `/users/delete/${ids.admin}`, asAdmin)).status, 403);
        assert.equal(
            (await http.request("PUT", `/users/update/${ids.admin}`, { ...asAdmin, body: { name: "New" } })).status,
            200
        );
    });

    it("let an admin change someone else", async () => {
        const response = await http.request("PUT", `/users/update/${ids.recruiter}`, {
            token: token(ids.admin),
            body: { role: "admin" },
        });
        assert.equal(response.status, 200);
    });
});

describe("GET /auth/me", () => {
    it("returns the user as stored now, for any role", async () => {
        const response = await http.request("GET", "/auth/me", { token: token(ids.recruiter) });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.role, "recruiter");
    });

    it("needs a token", async () => {
        assert.equal((await http.request("GET", "/auth/me")).status, 401);
    });
});

describe("POST /search/ask/stream", () => {
    const asRecruiter = { token: token(ids.recruiter) };

    it("answers bad input with a JSON error before any stream opens", async () => {
        const response = await http.request("POST", "/search/ask/stream", { ...asRecruiter, body: { question: "no" } });
        assert.equal(response.status, 422);
        assert.equal(response.headers.get("content-type")?.startsWith("application/json"), true);
    });

    it("404s a conversation this user does not have", async () => {
        const response = await http.request("POST", "/search/ask/stream", {
            ...asRecruiter,
            body: { question: "who fits best", conversationId: "00000000-0000-4000-8000-000000000000" },
        });
        assert.equal(response.status, 404);
    });
});

describe("errorHandler", () => {
    const run = (err, nodeEnv) => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = nodeEnv;
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        const originalError = console.error;
        console.error = () => {};
        try {
            errorHandler(err, { method: "GET", originalUrl: "/x" }, res, () => {});
        } finally {
            console.error = originalError;
            process.env.NODE_ENV = previous;
        }
        return res;
    };

    it("hides stack and upstream detail outside development", () => {
        const res = run(new ApiError(502, "Microsoft Graph rejected the message", ["AADSTS7000215"]), "production");
        assert.equal(res.code, 502);
        assert.equal(res.body.message, "Microsoft Graph rejected the message");
        assert.deepEqual(res.body.errors, []);
        assert.equal("stack" in res.body, false);
    });

    it("keeps 4xx detail everywhere, and adds stack in development", () => {
        const res = run(new ApiError(422, "Validation failed", ["email: is required"]), "development");
        assert.deepEqual(res.body.errors, ["email: is required"]);
        assert.equal(typeof res.body.stack, "string");
    });

    it("never exposes an unexpected error's message", () => {
        const res = run(new Error("connect ECONNREFUSED mongodb://user:pass@host"), "production");
        assert.equal(res.code, 500);
        assert.equal(res.body.message, "Internal Server Error");
    });
});
