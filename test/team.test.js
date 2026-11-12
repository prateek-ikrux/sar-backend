// Team overview, flags and the weekly summary email, against a real mongod.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv, serve } from "./support/helpers.js";

applyTestEnv({ APP_URL: "https://sar.example.com" });

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: ActivityEvent } = await import("../src/models/activity.model.js");
const { default: UsageSession } = await import("../src/models/usageSession.model.js");
const { default: WeeklySummarySettings } = await import("../src/models/weeklySummarySettings.model.js");
const { getProfilesCollection } = await import("../src/db/index.js");
const { runWeeklySummary, dueWeek } = await import("../src/services/weeklySummary.service.js");
const { default: weeklySummaryTemplate } = await import("../src/templates/weeklySummary.template.js");
const { ACTIVITY } = await import("../src/constants.js");

let mongod;
let http;
let admin;
let ann;
let bob;
let cat;
const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()].map(String);

const as = (user) => ({ token: jwt.sign({ _id: user._id }, process.env.ACCESS_TOKEN_SECRET) });
const get = (path, user = admin) => http.request("GET", path, as(user));
const event = (user, type, at, fields = {}) => ({ user_id: user._id, type, at, ...fields });
const HOUR = 60 * 60 * 1000;
const startOfHour = (ago) => new Date(Math.floor(Date.now() / HOUR) * HOUR - ago * HOUR);
const CHROME = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0";

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await Promise.all([User.init(), ActivityEvent.init(), UsageSession.init(), WeeklySummarySettings.init()]);
    admin = await User.create({ email: "admin@ikrux.com", name: "Admin", role: "admin" });
    ann = await User.create({ email: "ann@ikrux.com", name: "Ann" });
    bob = await User.create({ email: "bob@ikrux.com", name: "Bob" });
    cat = await User.create({ email: "cat@ikrux.com", name: "Cat" });
    http = await serve(app);
});

after(async () => {
    await http.close();
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    await Promise.all([
        ActivityEvent.deleteMany({}),
        UsageSession.deleteMany({}),
        WeeklySummarySettings.deleteMany({}),
        getProfilesCollection().deleteMany({}),
    ]);
});

const flagsOf = async (query = "") =>
    (await get(`/team/flags?days=7&tz=UTC${query}`)).body.data.flags;

describe("flags", () => {
    it("flags a burst of resume opens in one hour, and not one short of it", async () => {
        const base = startOfHour(2).getTime();
        await ActivityEvent.insertMany([
            ...Array.from({ length: 30 }, (_, i) =>
                event(ann, ACTIVITY.RESUME_VIEW, new Date(base + i * 1000), { profile_ids: [ids[0]] })
            ),
            ...Array.from({ length: 29 }, (_, i) =>
                event(bob, ACTIVITY.RESUME_DOWNLOAD, new Date(base + i * 1000), { profile_ids: [ids[0]] })
            ),
        ]);

        // Night flags depend on when the test runs, so only bursts are checked.
        const flags = (await flagsOf()).filter((flag) => flag.kind === "bulk_resumes");
        assert.equal(flags.length, 1);
        assert.deepEqual([flags[0].name, flags[0].count], ["Ann", 30]);
    });

    it("flags work at night in the chosen time zone, and big exports and failed sign-ins in a day", async () => {
        const midnight = new Date(Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR);
        await ActivityEvent.insertMany([
            // 23:00-01:00 UTC: one night, counted together.
            ...[-60, -30, 0, 30, 59].map((minutes) =>
                event(ann, ACTIVITY.CONTACT_VIEW, new Date(midnight.getTime() - 24 * HOUR + minutes * 60 * 1000), {
                    profile_ids: [ids[0]],
                })
            ),
            event(bob, ACTIVITY.EXPORT, startOfHour(30), { profile_ids: [ids[0]], meta: { count: 150 } }),
            ...Array.from({ length: 5 }, (_, i) =>
                event(cat, ACTIVITY.LOGIN_FAILED, new Date(startOfHour(30).getTime() + i * 1000), {
                    meta: { reason: "wrong_code" },
                })
            ),
        ]);

        const kinds = (await flagsOf()).map((flag) => `${flag.name}:${flag.kind}`).sort();
        assert.deepEqual(kinds, ["Ann:night_activity", "Bob:bulk_export", "Cat:failed_logins"]);

        // The same hours aren't night five and a half hours east.
        const india = (await get("/team/flags?days=7&tz=Asia/Kolkata")).body.data.flags;
        assert.equal(india.some((flag) => flag.kind === "night_activity"), false);
    });

    it("flags a sign-in from a new IP, but not a first-ever sign-in or a familiar one", async () => {
        const login = (at, ip, userAgent = CHROME) => event(ann, ACTIVITY.LOGIN, at, { meta: { ip, userAgent } });
        await ActivityEvent.insertMany([
            login(new Date(Date.now() - 20 * 24 * HOUR), "10.0.0.1"),
            login(startOfHour(5), "10.0.0.1"),
            login(startOfHour(3), "203.0.113.9"),
            // Bob's first sign-in ever.
            event(bob, ACTIVITY.LOGIN, startOfHour(3), { meta: { ip: "198.51.100.7", userAgent: CHROME } }),
        ]);

        const flags = await flagsOf();
        assert.deepEqual(
            flags.map(({ kind, name, ip }) => ({ kind, name, ip })),
            [{ kind: "new_ip", name: "Ann", ip: "203.0.113.9" }]
        );
    });

    it("narrows to one user", async () => {
        const base = startOfHour(2).getTime();
        await ActivityEvent.insertMany(
            Array.from({ length: 30 }, (_, i) =>
                event(ann, ACTIVITY.CONTACT_VIEW, new Date(base + i * 1000), { profile_ids: [ids[0]] })
            )
        );
        const bursts = async (user) =>
            (await flagsOf(`&userId=${user._id}`)).filter((flag) => flag.kind === "bulk_contacts").length;
        assert.equal(await bursts(bob), 0);
        assert.equal(await bursts(ann), 1);
    });
});

describe("team summary", () => {
    beforeEach(async () => {
        await getProfilesCollection().insertOne({ _id: new mongoose.Types.ObjectId(ids[0]), file_name: "priya.pdf" });
        const now = Date.now();
        await ActivityEvent.insertMany([
            event(ann, ACTIVITY.SEARCH_RESULTS, new Date(now - 3 * HOUR), { profile_ids: ids, meta: { count: 2 } }),
            event(ann, ACTIVITY.RESUME_VIEW, new Date(now - 2 * HOUR), { profile_ids: [ids[0]] }),
            event(ann, ACTIVITY.CONTACT_VIEW, new Date(now - 2 * HOUR), { profile_ids: [ids[1]] }),
            event(bob, ACTIVITY.SHORTLIST_ADD, new Date(now - HOUR), { profile_ids: [ids[0]] }),
            event(bob, ACTIVITY.QUESTION, new Date(now - HOUR), {
                meta: { inputTokens: 1000, cachedTokens: 0, outputTokens: 100 },
            }),
        ]);
        await UsageSession.create({
            user_id: bob._id,
            started_at: new Date(now - HOUR),
            last_seen_at: new Date(now - HOUR / 2),
            active_seconds: 1800,
        });
    });

    it("ranks recruiters by candidates worked on, and lists the ones who did nothing", async () => {
        const res = await get("/team/summary?days=7&tz=UTC");
        assert.equal(res.status, 200);
        const { ranking, inactive, totals } = res.body.data;

        assert.deepEqual(
            ranking.map((row) => [row.user.name, row.candidatesWorked]),
            [
                ["Ann", 2],
                ["Bob", 1],
                ["Cat", 0],
            ]
        );
        const bobRow = ranking[1];
        assert.equal(bobRow.activeSeconds, 1800);
        assert.equal(bobRow.questions, 1);
        assert.deepEqual(inactive.map((user) => user.name), ["Cat"]);
        assert.equal(totals.activeUsers, 2);
        assert.equal(totals.candidatesWorked, 2);
    });

    it("measures duplicate effort: candidates more than one recruiter worked on", async () => {
        const { duplicateEffort } = (await get("/team/summary?days=7&tz=UTC")).body.data;
        assert.equal(duplicateEffort.candidates, 2);
        assert.equal(duplicateEffort.shared, 1);
        assert.equal(duplicateEffort.rate, 0.5);
        assert.deepEqual(duplicateEffort.top.map(({ label, recruiters }) => ({ label, recruiters })), [
            { label: "priya", recruiters: ["Ann", "Bob"] },
        ]);
    });

    it("is for admins only", async () => {
        assert.equal((await get("/team/summary", ann)).status, 403);
        assert.equal((await get("/team/weekly-email", ann)).status, 403);
    });
});

describe("weekly summary settings", () => {
    const put = (body) => http.request("PUT", "/team/weekly-email", { ...as(admin), body });

    it("is off by default, and only admins can be chosen", async () => {
        const res = await get("/team/weekly-email");
        assert.equal(res.status, 200);
        assert.equal(res.body.data.enabled, false);
        assert.deepEqual(res.body.data.recipients, []);
        assert.deepEqual(res.body.data.eligible.map((person) => person.name), ["Admin"]);
    });

    it("refuses a recruiter as a recipient, and turning it on with nobody to send to", async () => {
        assert.equal((await put({ enabled: true, recipientIds: [String(ann._id)], timeZone: "UTC" })).status, 422);
        assert.equal((await put({ enabled: true, recipientIds: [], timeZone: "UTC" })).status, 422);
    });

    it("saves who gets it and when", async () => {
        const res = await put({ enabled: true, recipientIds: [String(admin._id)], timeZone: "Asia/Kolkata" });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.enabled, true);
        assert.equal(res.body.data.timeZone, "Asia/Kolkata");
        assert.deepEqual(res.body.data.recipients.map((person) => person.email), ["admin@ikrux.com"]);
    });
});

describe("weekly summary sending", () => {
    // Monday 9 November 2026, 09:30 in India.
    const monday = new Date("2026-11-09T04:00:00Z");

    it("is due on Monday from 9 in the chosen time zone, once a week", () => {
        assert.equal(dueWeek(monday, "Asia/Kolkata", null), "2026-11-09");
        assert.equal(dueWeek(new Date("2026-11-09T02:00:00Z"), "Asia/Kolkata", null), null); // 07:30
        assert.equal(dueWeek(new Date("2026-11-10T04:00:00Z"), "Asia/Kolkata", null), null); // Tuesday
        assert.equal(dueWeek(monday, "Asia/Kolkata", "2026-11-09"), null);
        // Still Sunday evening in New York.
        assert.equal(dueWeek(monday, "America/New_York", null), null);
    });

    it("sends nothing while it's off", async () => {
        const sent = [];
        const result = await runWeeklySummary({ now: monday, send: async (mail) => sent.push(mail) });
        assert.equal(result.sent, false);
        assert.equal(sent.length, 0);
    });

    it("sends once to the chosen admins, and tries again after a failure", async () => {
        await WeeklySummarySettings.create({ enabled: true, recipient_ids: [admin._id], time_zone: "Asia/Kolkata" });

        const failing = await runWeeklySummary({ now: monday, send: async () => Promise.reject(new Error("Graph down")) });
        assert.equal(failing.reason, "failed");
        assert.equal((await WeeklySummarySettings.findOne().lean()).last_error, "Graph down");

        const sent = [];
        const send = async (mail) => sent.push(mail);
        assert.equal((await runWeeklySummary({ now: monday, send })).sent, true);
        assert.equal((await runWeeklySummary({ now: new Date(monday.getTime() + HOUR), send })).sent, false);

        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0].to, ["admin@ikrux.com"]);
        assert.match(sent[0].subject, /your team's week/);
        assert.match(sent[0].html, /https:\/\/sar\.example\.com\/team/);
        assert.equal((await WeeklySummarySettings.findOne().lean()).last_error, null);
    });
});

describe("weekly summary email", () => {
    it("escapes names and says who did nothing", () => {
        const { html, text } = weeklySummaryTemplate({
            appUrl: null,
            summary: {
                totals: { activeUsers: 1, searches: 4, candidatesWorked: 3, activeSeconds: 3600 },
                ranking: [
                    {
                        user: { name: "<b>Eve</b>" },
                        activeDays: 1,
                        activeSeconds: 3600,
                        candidatesWorked: 3,
                        searches: 4,
                    },
                ],
                duplicateEffort: { candidates: 3, shared: 1, rate: 1 / 3 },
                flags: [{ kind: "bulk_resumes", name: "<b>Eve</b>", count: 40 }],
                inactive: [{ name: "Cat" }],
            },
        });
        assert.equal(html.includes("<b>Eve</b>"), false);
        assert.ok(html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
        assert.match(text, /No activity: Cat/);
        assert.match(text, /33% of candidates/);
        // No AI cost in the email.
        assert.equal(/AI|\$/.test(text), false);
    });
});
