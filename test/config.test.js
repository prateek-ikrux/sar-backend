import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findEnvProblems } from "../src/config/env.js";
import { parseCorsOrigins } from "../src/config/cors.js";
import { TEST_ENV } from "./support/helpers.js";

describe("findEnvProblems", () => {
    it("accepts a complete environment", () => {
        assert.deepEqual(findEnvProblems(TEST_ENV), []);
    });

    it("lists every problem, treating empty values as missing", () => {
        const { MONGODB_URI, ...rest } = TEST_ENV;
        const problems = findEnvProblems({
            ...rest,
            OPENAI_MODEL: "",
            ACCESS_TOKEN_SECRET: "too-short",
            GRAPH_SENDER: "not-an-email",
            CORS_ORIGIN: "localhost:5173",
        });
        const keys = problems.map((p) => p.split(":")[0]).sort();

        assert.deepEqual(keys, [
            "ACCESS_TOKEN_SECRET",
            "CORS_ORIGIN",
            "GRAPH_SENDER",
            "MONGODB_URI",
            "OPENAI_MODEL",
        ]);
    });

    it("never echoes a value back", () => {
        const problems = findEnvProblems({ ...TEST_ENV, ACCESS_TOKEN_SECRET: "leaky-secret" });
        assert.equal(problems.join(" ").includes("leaky-secret"), false);
    });
});

describe("parseCorsOrigins", () => {
    it("splits a list and drops trailing slashes", () => {
        assert.deepEqual(parseCorsOrigins(" http://localhost:5173/ , https://sar.ikrux.com "), [
            "http://localhost:5173",
            "https://sar.ikrux.com",
        ]);
    });

    it('collapses to "*" when any entry is "*"', () => {
        assert.equal(parseCorsOrigins("http://localhost:5173,*"), "*");
    });
});
