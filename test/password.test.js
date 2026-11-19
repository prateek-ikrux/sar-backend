// Password utilities and the User password fields. Runs against a real mongod
// (mongodb-memory-server) because select: false is a query-time behaviour.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv } from "./support/helpers.js";

applyTestEnv();

const { hashPassword, verifyPassword } = await import("../src/utils/password.js");
const { default: User } = await import("../src/models/user.model.js");

let mongod;

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await User.init();
});

after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

describe("verifyPassword", () => {
    it("accepts the right password and rejects a wrong one", async () => {
        const hash = await hashPassword("correct horse battery");
        assert.ok(hash.startsWith("$argon2id$"));
        assert.equal(await verifyPassword(hash, "correct horse battery"), true);
        assert.equal(await verifyPassword(hash, "wrong horse battery"), false);
    });

    it("returns false when there is no hash", async () => {
        assert.equal(await verifyPassword(null, "x"), false);
        assert.equal(await verifyPassword(undefined, "x"), false);
    });
});

describe("User password fields", () => {
    it("keeps password_hash out of toJSON and out of default queries", async () => {
        const doc = await User.create({ email: "pw@ikrux.com", name: "Pw", password_hash: "h" });
        assert.equal("password_hash" in doc.toJSON(), false);

        const plain = await User.findById(doc._id);
        assert.equal(plain.password_hash, undefined);
        assert.equal(plain.password_changed_at, null);

        const withHash = await User.findById(doc._id).select("+password_hash");
        assert.equal(withHash.password_hash, "h");
    });
});
