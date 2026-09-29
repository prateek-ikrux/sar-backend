import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { applyTestEnv, serve } from "./support/helpers.js";

applyTestEnv();

const { default: app } = await import("../src/app.js");
const { default: logger } = await import("../src/utils/logger.js");
const { runWithStats, track, requestLog } = await import("../src/utils/requestStats.js");

// The logger is silent in tests. Each request logs through a child of it, so
// child() is swapped for one that records what it's given.
const lines = [];
const child = logger.child;
const capture = () => {
    logger.child = (bindings) => {
        const record = (level) => (fields) => lines.push({ level, ...bindings, ...fields });
        return { info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") };
    };
};

let http;
before(async () => (http = await serve(app)));
after(() => http.close());
afterEach(() => {
    logger.child = child;
    lines.length = 0;
});

describe("track", () => {
    it("sums numbers and sets everything else, per request", () => {
        const stats = {};
        runWithStats({ stats }, () => {
            track("minio", { statCalls: 1, statMs: 2.5 });
            track("minio", { statCalls: 1, statMs: 1.5, cacheHits: undefined });
            track("llm", { model: "a", calls: 1 });
            track("llm", { model: "b" });
        });
        assert.deepEqual(stats, { minio: { statCalls: 2, statMs: 4 }, llm: { model: "b", calls: 1 } });
    });

    it("does nothing outside a request", () => {
        assert.doesNotThrow(() => track("minio", { statCalls: 1 }));
    });
});

describe("requestLog", () => {
    it("is the request's logger inside a request and the app's outside", () => {
        const log = logger.child({ reqId: "r1" });
        runWithStats({ stats: {}, log }, () => assert.equal(requestLog(), log));
        assert.equal(requestLog(), logger);
    });
});

describe("request logging", () => {
    it("gives every response a request id, keeping a well-formed incoming one", async () => {
        const fresh = await http.request("GET", "/health");
        assert.match(fresh.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);

        const kept = await http.request("GET", "/health", { headers: { "x-request-id": "proxy-id-1234" } });
        assert.equal(kept.headers.get("x-request-id"), "proxy-id-1234");

        const replaced = await http.request("GET", "/health", { headers: { "x-request-id": "not an id; drop table" } });
        assert.match(replaced.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
    });

    it("writes one line per request, without the query string", async () => {
        capture();
        const response = await http.request("GET", "/no-such-route?email=someone@example.com");
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(lines.length, 1);
        const [line] = lines;
        assert.equal(line.level, "warn");
        assert.equal(line.reqId, response.headers.get("x-request-id"));
        assert.equal(line.status, 404);
        assert.equal(line.path, "/api/v1/no-such-route");
        assert.equal(JSON.stringify(line).includes("someone@example.com"), false);
        assert.ok(line.responseBytes > 0);
    });
});
