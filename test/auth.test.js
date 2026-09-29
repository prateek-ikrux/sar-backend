// Runs against a real mongod (mongodb-memory-server): the OTP guarantees rest
// on atomic updates and unique indexes, which stubs cannot exercise. The first
// run downloads a MongoDB binary into ~/.cache/mongodb-binaries.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv, serve } from "./support/helpers.js";

applyTestEnv();

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: Otp } = await import("../src/models/otp.model.js");

const CODE = "482915";
const WRONG = "000000";

let mongod;
let http;
let user;

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await Promise.all([User.init(), Otp.init()]);
    user = await User.create({ email: "tester@ikrux.com", name: "Tester" });
    await User.create({ email: "gone@ikrux.com", name: "Gone", active: false });
    http = await serve(app);
});

after(async () => {
    await http.close();
    await mongoose.disconnect();
    await mongod.stop();
});

// A live code for `user`, created directly: request-otp would try to mail it.
const issueCode = async (overrides = {}) => {
    await Otp.updateMany({ email: user.email, consumed_at: null }, { consumed_at: new Date() });
    return Otp.create({
        email: user.email,
        user_id: user._id,
        code_hash: await argon2.hash(CODE, { type: argon2.argon2id }),
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
        ...overrides,
    });
};

const verify = async (code) =>
    (await http.request("POST", "/auth/verify-otp", { body: { email: user.email, code } })).status;

describe("verify-otp", () => {
    let otp;
    beforeEach(async () => (otp = await issueCode()));

    it("signs in after a wrong guess, and only once per code", async () => {
        assert.equal(await verify(WRONG), 401);
        assert.equal(await verify(CODE), 200);
        assert.equal(await verify(CODE), 401);

        const saved = await Otp.findById(otp._id).lean();
        assert.equal(saved.attempts, 2);
        assert.ok(saved.consumed_at instanceof Date);
    });

    it("counts parallel guesses, so a burst cannot beat the attempt limit", async () => {
        const burst = await Promise.all(Array.from({ length: 10 }, () => verify(WRONG)));

        assert.deepEqual([...new Set(burst)], [401]);
        assert.equal((await Otp.findById(otp._id).lean()).attempts, 5);
        assert.equal(await verify(CODE), 401);
    });

    it("lets only one of two simultaneous correct codes through", async () => {
        const results = await Promise.all([verify(CODE), verify(CODE)]);
        assert.deepEqual(results.sort(), [200, 401]);
    });

    it("rejects an expired code without spending an attempt", async () => {
        const expired = await issueCode({ expires_at: new Date(Date.now() - 1000) });
        assert.equal(await verify(CODE), 401);
        assert.equal((await Otp.findById(expired._id).lean()).attempts, 0);
    });
});

describe("request-otp", () => {
    it("answers identically for unknown and deactivated addresses", async () => {
        const unknown = await http.request("POST", "/auth/request-otp", { body: { email: "nobody@ikrux.com" } });
        const inactive = await http.request("POST", "/auth/request-otp", { body: { email: "gone@ikrux.com" } });

        assert.equal(unknown.status, 200);
        assert.equal(inactive.status, 200);
        assert.equal(unknown.body.message, inactive.body.message);
        assert.deepEqual(Object.keys(unknown.body.data).sort(), ["email", "expiresAt"]);
    });

    it("rate limits repeated requests for one address", async () => {
        const statuses = [];
        for (let i = 0; i < 6; i++) {
            statuses.push((await http.request("POST", "/auth/request-otp", { body: { email: "flood@ikrux.com" } })).status);
        }
        assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    });
});

describe("indexes", () => {
    it("builds the same indexes as production", async () => {
        const specs = async (Model) =>
            (await Model.collection.indexes())
                .filter((index) => index.name !== "_id_")
                .map(({ key, name, unique, expireAfterSeconds }) => ({ key, name, unique, expireAfterSeconds }));

        assert.deepEqual(await specs(User), [
            { key: { email: 1 }, name: "uniq_email", unique: true, expireAfterSeconds: undefined },
        ]);
        assert.deepEqual(await specs(Otp), [
            { key: { email: 1, created_at: -1 }, name: "by_email", unique: undefined, expireAfterSeconds: undefined },
            { key: { expires_at: 1 }, name: "ttl_expired_codes", unique: undefined, expireAfterSeconds: 3600 },
        ]);
    });

    it("turns a duplicate email into a 409 through uniq_email", async () => {
        await assert.rejects(User.create({ email: "TESTER@ikrux.com", name: "Twin" }), { code: 11000 });
    });
});
