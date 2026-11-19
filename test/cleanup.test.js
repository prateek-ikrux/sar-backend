// The one-off cleanup of handed-out passwords. Runs against a real mongod
// (mongodb-memory-server): it works on fields the User schema no longer has, so
// it has to go through the raw collection, and only a real server shows that.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv } from "./support/helpers.js";

applyTestEnv();

const { default: User } = await import("../src/models/user.model.js");
const { cleanupHandedOutPasswords } = await import("../scripts/cleanup-handed-out-passwords.js");

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

const raw = () => User.collection;
const find = (email) => raw().findOne({ email });

beforeEach(async () => {
    await raw().deleteMany({});
    await raw().insertMany([
        // Still on a handed-out password: must lose it.
        { email: "handed@ikrux.com", name: "Handed", role: "recruiter", active: true, password_hash: "starting", must_change_password: true },
        // Chose their own already: keeps it, loses only the flag.
        { email: "chose@ikrux.com", name: "Chose", role: "admin", active: true, password_hash: "own", must_change_password: false, password_changed_at: new Date("2026-11-01T00:00:00Z") },
        // Never had the field: untouched.
        { email: "clean@ikrux.com", name: "Clean", role: "recruiter", active: true, password_hash: "mine" },
    ]);
});

describe("cleanupHandedOutPasswords", () => {
    it("reports without writing unless asked to apply", async () => {
        const report = await cleanupHandedOutPasswords();

        assert.deepEqual(report, { applied: false, cleared: ["handed@ikrux.com"], flagOnly: 1 });
        assert.equal((await find("handed@ikrux.com")).password_hash, "starting");
        assert.equal((await find("chose@ikrux.com")).must_change_password, false);
    });

    it("removes handed-out passwords, keeps chosen ones, and drops the flag everywhere", async () => {
        const before = Math.floor(Date.now() / 1000) * 1000;
        const report = await cleanupHandedOutPasswords({ apply: true });

        assert.deepEqual(report, { applied: true, cleared: ["handed@ikrux.com"], flagOnly: 1 });

        const handed = await find("handed@ikrux.com");
        assert.equal("password_hash" in handed, false);
        assert.equal("must_change_password" in handed, false);
        // Ends any session signed in with the handed-out password.
        assert.ok(handed.password_changed_at.getTime() >= before);

        const chose = await find("chose@ikrux.com");
        assert.equal(chose.password_hash, "own");
        assert.equal("must_change_password" in chose, false);
        assert.equal(chose.password_changed_at.toISOString(), "2026-11-01T00:00:00.000Z");

        const clean = await find("clean@ikrux.com");
        assert.equal(clean.password_hash, "mine");
        assert.equal("password_changed_at" in clean, false);
    });

    it("finds nothing to do on a second run", async () => {
        await cleanupHandedOutPasswords({ apply: true });
        assert.deepEqual(await cleanupHandedOutPasswords({ apply: true }), { applied: true, cleared: [], flagOnly: 0 });
    });
});
