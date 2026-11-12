// Runs against a real mongod (mongodb-memory-server): the reports are
// aggregations over the activity log.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv, serve } from "./support/helpers.js";

applyTestEnv();

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: ActivityEvent } = await import("../src/models/activity.model.js");
const { getProfilesCollection } = await import("../src/db/index.js");
const { ACTIVITY } = await import("../src/constants.js");

let mongod;
let http;
let admin;
let ann;
let bob;
const ids = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId().toString());

const as = (user) => ({ token: jwt.sign({ _id: user._id }, process.env.ACCESS_TOKEN_SECRET) });
const get = (path, user = admin) => http.request("GET", path, as(user));
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000);
const event = (user, type, minutes, fields = {}) =>
    ActivityEvent.create({ user_id: user._id, type, at: minutesAgo(minutes), ...fields });

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await Promise.all([User.init(), ActivityEvent.init()]);
    admin = await User.create({ email: "admin@ikrux.com", name: "Admin", role: "admin" });
    ann = await User.create({ email: "ann@ikrux.com", name: "Ann" });
    bob = await User.create({ email: "bob@ikrux.com", name: "Bob" });
    http = await serve(app);
});

after(async () => {
    await http.close();
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    await ActivityEvent.deleteMany({});
    await getProfilesCollection().deleteMany({});
    await getProfilesCollection().insertOne({ _id: new mongoose.Types.ObjectId(ids[0]), file_name: "priya_sharma.pdf" });

    // Ann: two searches, the first leading to an open and a save, the
    // second to a contact view; a question; a 10-day-old search.
    await event(ann, ACTIVITY.SEARCH_RESULTS, 60, { query: "java", profile_ids: [ids[0], ids[1]], meta: { count: 2, source: "search" } });
    await event(ann, ACTIVITY.RESUME_VIEW, 55, { profile_ids: [ids[0]] });
    await event(ann, ACTIVITY.RESUME_VIEW, 54, { profile_ids: [ids[0]] });
    await event(ann, ACTIVITY.SHORTLIST_ADD, 50, { profile_ids: [ids[1]] });
    await event(ann, ACTIVITY.SEARCH_RESULTS, 30, { query: "spring", profile_ids: [ids[0], ids[2]], meta: { count: 2, source: "search", hideTeam: true } });
    await event(ann, ACTIVITY.CONTACT_VIEW, 20, { profile_ids: [ids[2]] });
    // Not from that search's results, so not its outcome.
    await event(ann, ACTIVITY.CONTACT_VIEW, 19, { profile_ids: [ids[3]] });
    await event(ann, ACTIVITY.QUESTION, 10, { query: "who knows kafka" });
    await event(ann, ACTIVITY.TAG, 9, { profile_ids: [ids[2]], meta: { tag: "contacted" } });
    await event(ann, ACTIVITY.TAG, 8, { profile_ids: [ids[2]], meta: { tag: null } });
    await event(ann, ACTIVITY.EXPORT, 5, { profile_ids: [ids[0], ids[2]], meta: { source: "search", count: 2 } });
    await event(ann, ACTIVITY.SEARCH_RESULTS, 10 * 24 * 60, { query: "old", profile_ids: [ids[3]], meta: { count: 1 } });
    // Someone else's activity never leaks into Ann's numbers.
    await event(bob, ACTIVITY.RESUME_VIEW, 5, { profile_ids: [ids[0]] });
});

describe("users list", () => {
    it("carries last week's usage and when each user was last active", async () => {
        const res = await get("/users/list?limit=100");
        assert.equal(res.status, 200);
        const byEmail = new Map(res.body.data.users.map((user) => [user.email, user.usage]));

        const usage = byEmail.get("ann@ikrux.com");
        // The 10-day-old search is outside the week.
        assert.equal(usage.searches, 2);
        assert.equal(usage.resumes, 2);
        assert.equal(usage.contacts, 2);
        assert.ok(new Date(usage.lastActiveAt) > minutesAgo(6));

        assert.deepEqual(byEmail.get("admin@ikrux.com"), {
            lastActiveAt: null,
            activeSeconds: 0,
            searches: 0,
            resumes: 0,
            contacts: 0,
        });
    });
});

describe("activity summary", () => {
    it("totals each kind of action over the range", async () => {
        const res = await get(`/users/activity/${ann._id}/summary?days=7&tz=Asia/Kolkata`);
        assert.equal(res.status, 200);
        const { totals, daily, range, user } = res.body.data;

        assert.equal(user.email, "ann@ikrux.com");
        assert.equal(range.tz, "Asia/Kolkata");
        assert.deepEqual(totals, {
            searches: 2,
            questions: 1,
            profilesShown: 4,
            uniqueProfilesShown: 3,
            contactViews: 2,
            resumeViews: 2,
            resumeDownloads: 0,
            shortlisted: 1,
            // Setting a tag counts; clearing it doesn't.
            tagged: 1,
            exports: 1,
            exportedCandidates: 2,
            uniqueCandidatesWorked: 4,
            activeDays: totals.activeDays,
        });
        assert.ok(totals.activeDays >= 1 && totals.activeDays <= 2);

        // One entry per day, 7 days back to today, oldest first.
        assert.ok(daily.length >= 7 && daily.length <= 9);
        const sum = (key) => daily.reduce((n, day) => n + day[key], 0);
        assert.equal(sum("searches"), 2);
        assert.equal(sum("questions"), 1);
        // 2 opens, a save, 2 contact views, 2 tag changes, an export.
        assert.equal(sum("candidateActions"), 8);
    });

    it("reaches back further with a longer range", async () => {
        const res = await get(`/users/activity/${ann._id}/summary?days=30`);
        assert.equal(res.body.data.totals.searches, 3);
    });

    it("refuses an unknown range or time zone", async () => {
        assert.equal((await get(`/users/activity/${ann._id}/summary?days=14`)).status, 422);
        assert.equal((await get(`/users/activity/${ann._id}/summary?tz=Mars/Base`)).status, 422);
    });

    it("is for admins only", async () => {
        assert.equal((await get(`/users/activity/${ann._id}/summary`, ann)).status, 403);
    });

    it("404s for a user who doesn't exist", async () => {
        assert.equal((await get(`/users/activity/${new mongoose.Types.ObjectId()}/summary`)).status, 404);
    });
});

describe("searches", () => {
    it("lists searches newest first with what came of each before the next", async () => {
        const res = await get(`/users/activity/${ann._id}/searches?days=7`);
        assert.equal(res.status, 200);
        const [spring, java] = res.body.data.items;

        assert.equal(res.body.data.total, 2);
        assert.equal(spring.query, "spring");
        assert.deepEqual(spring.filters, { hideMine: false, hideTeam: true });
        // Contacted and tagged ids[2], exported ids[0] and ids[2]; ids[3]
        // wasn't in these results.
        assert.deepEqual(spring.outcome, { opened: 0, contacted: 1, saved: 0, tagged: 1, exported: 2, worked: 2 });

        assert.equal(java.query, "java");
        // Opened ids[0] twice: one candidate.
        assert.deepEqual(java.outcome, { opened: 1, contacted: 0, saved: 1, tagged: 0, exported: 0, worked: 2 });
    });
});

describe("timeline", () => {
    it("pages through activity newest first, naming candidates by file", async () => {
        const first = await get(`/users/activity/${ann._id}/events`);
        assert.equal(first.status, 200);
        const items = first.body.data.items;
        assert.equal(items.length, 12);
        assert.equal(first.body.data.next, null);
        assert.equal(items[0].type, ACTIVITY.EXPORT);

        const view = items.find((item) => item.type === ACTIVITY.RESUME_VIEW);
        assert.deepEqual(view.candidates, [{ id: ids[0], label: "priya_sharma" }]);

        // A search says how many it showed, without listing them.
        const search = items.find((item) => item.type === ACTIVITY.SEARCH_RESULTS);
        assert.deepEqual(search.candidates, []);
        assert.equal(search.count, 2);

        const older = await get(`/users/activity/${ann._id}/events?before=${encodeURIComponent(items[5].at)}`);
        assert.equal(older.body.data.items.length, 6);
    });
});
