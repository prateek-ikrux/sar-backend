// Time on the platform, AI usage and sign-in history, against a real mongod.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv, serve } from "./support/helpers.js";

applyTestEnv();

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: Otp } = await import("../src/models/otp.model.js");
const { default: ActivityEvent } = await import("../src/models/activity.model.js");
const { default: UsageSession } = await import("../src/models/usageSession.model.js");
const { recordHeartbeat } = await import("../src/services/session.service.js");
const { ACTIVITY } = await import("../src/constants.js");

let mongod;
let http;
let admin;
let ann;

const as = (user) => ({ token: jwt.sign({ _id: user._id }, process.env.ACCESS_TOKEN_SECRET) });
const summary = async (user = ann) =>
    (await http.request("GET", `/users/activity/${user._id}/summary?days=7`, as(admin))).body.data;
const at = (minutes) => new Date(Date.now() - 60 * 60 * 1000 + minutes * 60 * 1000);

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await Promise.all([User.init(), Otp.init(), ActivityEvent.init(), UsageSession.init()]);
    admin = await User.create({ email: "admin@ikrux.com", name: "Admin", role: "admin" });
    ann = await User.create({ email: "ann@ikrux.com", name: "Ann" });
    http = await serve(app);
});

after(async () => {
    await http.close();
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    await Promise.all([ActivityEvent.deleteMany({}), UsageSession.deleteMany({}), Otp.deleteMany({})]);
});

describe("time on the platform", () => {
    it("joins check-ins into sessions, counting the time between them", async () => {
        // Minute by minute for 3 minutes, a 20-minute break, then 2 more.
        for (const minute of [0, 1, 2, 3, 23, 24, 25]) await recordHeartbeat(ann._id, at(minute));

        const sessions = await UsageSession.find().sort({ started_at: 1 }).lean();
        assert.equal(sessions.length, 2);
        assert.equal(sessions[0].active_seconds, 180);
        assert.equal(sessions[1].active_seconds, 120);

        const { time, totals } = await summary();
        assert.deepEqual(time, { activeSeconds: 300, sessions: 2, longestSessionSeconds: 180 });
        assert.ok(totals.activeDays >= 1);
    });

    it("caps the credit for one check-in, so a stalled page can't inflate the time", async () => {
        await recordHeartbeat(ann._id, at(0));
        await recordHeartbeat(ann._id, at(4)); // inside the 5-minute gap, but 4 minutes later
        const [session] = await UsageSession.find().lean();
        assert.equal(session.active_seconds, 75);
    });

    it("counts a minute once when two tabs check in together", async () => {
        await recordHeartbeat(ann._id, at(0));
        await Promise.all([recordHeartbeat(ann._id, at(1)), recordHeartbeat(ann._id, at(1))]);
        const [session] = await UsageSession.find().lean();
        assert.equal(session.active_seconds, 60);
    });

    it("takes check-ins from the page and shows the week on the users list", async () => {
        const res = await http.request("POST", "/activity/heartbeat", as(ann));
        assert.equal(res.status, 200);
        await UsageSession.updateOne({}, { active_seconds: 600 });

        const list = await http.request("GET", "/users/list?limit=100", as(admin));
        const usage = list.body.data.users.find((user) => user.email === "ann@ikrux.com").usage;
        assert.equal(usage.activeSeconds, 600);
        // Being on the page counts as active even without an action.
        assert.ok(usage.lastActiveAt);
    });

    it("needs a signed-in user", async () => {
        assert.equal((await http.request("POST", "/activity/heartbeat")).status, 401);
    });
});

describe("sign-in history", () => {
    const issue = async (code) =>
        Otp.create({
            email: ann.email,
            user_id: ann._id,
            code_hash: await argon2.hash(code, { type: argon2.argon2id }),
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
        });
    const verify = (code, email = ann.email) =>
        http.request("POST", "/auth/verify-otp", {
            body: { email, code },
            headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" },
        });

    it("records a sign-in, and a wrong code, with where it came from", async () => {
        await issue("123456");
        assert.equal((await verify("654321")).status, 401);
        assert.equal((await verify("123456")).status, 200);

        const { logins } = await summary();
        assert.equal(logins.succeeded, 1);
        assert.equal(logins.failed, 1);
        const [ok, failed] = logins.recent;
        assert.equal(ok.ok, true);
        assert.match(ok.userAgent, /Chrome/);
        assert.ok(ok.ip);
        assert.equal(failed.ok, false);
        assert.equal(failed.reason, "wrong_code");
    });

    it("keeps nothing for an address nobody has", async () => {
        await verify("123456", "nobody@ikrux.com");
        assert.equal(await ActivityEvent.countDocuments(), 0);
    });
});
