// Runs against a real mongod (mongodb-memory-server), like shortlist.test.js:
// the team summary is an aggregation, and tags rely on a unique index.
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
const { default: CandidateTag } = await import("../src/models/candidateTag.model.js");
const { default: ShortlistItem } = await import("../src/models/shortlist.model.js");
const { getProfilesCollection } = await import("../src/db/index.js");
const { teamActivityFor, excludedProfileIds, purgeOldActivityText, recordActivity } = await import(
    "../src/services/activity.service.js"
);
const { ACTIVITY } = await import("../src/constants.js");

let mongod;
let http;
let ann;
let bob;
let cat;
const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()].map(
    String
);

const as = (user) => ({ token: jwt.sign({ _id: user._id }, process.env.ACCESS_TOKEN_SECRET) });
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const teamFor = async (user, id) => (await teamActivityFor({ userId: user._id, profileIds: [id] })).get(id);

const originalError = console.error;
before(async () => {
    console.error = () => {};
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await Promise.all([User.init(), ActivityEvent.init(), CandidateTag.init(), ShortlistItem.init()]);
    ann = await User.create({ email: "ann@ikrux.com", name: "Ann" });
    bob = await User.create({ email: "bob@ikrux.com", name: "Bob" });
    cat = await User.create({ email: "cat@ikrux.com", name: "Cat" });
    http = await serve(app);
});

after(async () => {
    console.error = originalError;
    await http.close();
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    await Promise.all([ActivityEvent.deleteMany({}), CandidateTag.deleteMany({}), ShortlistItem.deleteMany({})]);
    await getProfilesCollection().deleteMany({});
    await getProfilesCollection().insertMany([
        { _id: new mongoose.Types.ObjectId(ids[0]), file_name: "priya.pdf", email: "priya@example.com", phone: "9876543210", document: "Priya" },
        { _id: new mongoose.Types.ObjectId(ids[1]), file_name: "arjun.pdf", email: "arjun@example.com", phone: null, document: "Arjun" },
    ]);
});

describe("contact details", () => {
    it("are handed over one candidate at a time, and the reveal is recorded", async () => {
        const res = await http.request("POST", `/candidates/${ids[0]}/contact`, as(bob));
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data, { profileId: ids[0], email: "priya@example.com", phone: "9876543210" });

        const events = await ActivityEvent.find({ type: ACTIVITY.CONTACT_VIEW }).lean();
        assert.equal(events.length, 1);
        assert.deepEqual(events[0].profile_ids, [ids[0]]);
        assert.equal(events[0].user_id.toString(), bob._id.toString());
    });

    it("404 for a candidate not in the library, recording nothing", async () => {
        const res = await http.request("POST", `/candidates/${ids[2]}/contact`, as(bob));
        assert.equal(res.status, 404);
        assert.equal(await ActivityEvent.countDocuments(), 0);
    });
});

describe("team activity on a card", () => {
    it("names other recruiters who worked on the candidate, newest first, and the caller's own work apart", async () => {
        await http.request("POST", `/candidates/${ids[0]}/contact`, as(bob));
        await http.request("POST", `/candidates/${ids[0]}/resume/view`, as(cat));
        await http.request("POST", `/candidates/${ids[0]}/resume/view`, as(ann));

        const team = await teamFor(ann, ids[0]);
        assert.deepEqual(
            team.others.map((o) => [o.name, o.action]),
            [
                ["Cat", ACTIVITY.RESUME_VIEW],
                ["Bob", ACTIVITY.CONTACT_VIEW],
            ]
        );
        assert.equal(team.otherCount, 2);
        assert.equal(team.mine.action, ACTIVITY.RESUME_VIEW);
    });

    it("keeps one line per recruiter: their latest action", async () => {
        await http.request("POST", `/candidates/${ids[0]}/resume/view`, as(bob));
        await http.request("POST", `/candidates/${ids[0]}/contact`, as(bob));

        const team = await teamFor(ann, ids[0]);
        assert.equal(team.others.length, 1);
        assert.equal(team.others[0].action, ACTIVITY.CONTACT_VIEW);
    });

    it("counts recruiters who only saw the candidate in results, without naming them", async () => {
        await recordActivity({ userId: bob._id, type: ACTIVITY.SEARCH_RESULTS, profileIds: ids, query: "java" });
        await recordActivity({ userId: cat._id, type: ACTIVITY.SEARCH_RESULTS, profileIds: [ids[0]], query: "java" });

        const team = await teamFor(ann, ids[0]);
        assert.equal(team.seenBy, 2);
        assert.equal(team.others.length, 0);
        assert.equal(team.mine, null);
    });

    it("ignores activity older than the window, and removals from a shortlist", async () => {
        await ActivityEvent.create({ user_id: bob._id, type: ACTIVITY.CONTACT_VIEW, profile_ids: [ids[0]], at: daysAgo(91) });
        await ActivityEvent.create({ user_id: cat._id, type: ACTIVITY.SHORTLIST_REMOVE, profile_ids: [ids[0]] });

        const team = await teamFor(ann, ids[0]);
        assert.equal(team.otherCount, 0);
        assert.equal(team.seenBy, 0);
    });

    it("says so when the recruiter's account is gone", async () => {
        const gone = new mongoose.Types.ObjectId();
        await recordActivity({ userId: gone, type: ACTIVITY.RESUME_DOWNLOAD, profileIds: [ids[0]] });
        assert.equal((await teamFor(ann, ids[0])).others[0].name, "A former recruiter");
    });
});

describe("tags", () => {
    it("are shared: everyone sees each recruiter's current tag, and a new one replaces the old", async () => {
        await http.request("PUT", `/candidates/${ids[0]}/tag`, { ...as(bob), body: { tag: "contacted" } });
        const res = await http.request("PUT", `/candidates/${ids[0]}/tag`, {
            ...as(bob),
            body: { tag: "not_interested", note: "wants remote" },
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.tags.length, 1);

        const team = await teamFor(ann, ids[0]);
        assert.deepEqual(
            team.tags.map(({ tag, note, name, mine }) => ({ tag, note, name, mine })),
            [{ tag: "not_interested", note: "wants remote", name: "Bob", mine: false }]
        );
        // Tagging is working on the candidate.
        assert.equal(team.others[0].action, ACTIVITY.TAG);
    });

    it("can be cleared by the recruiter who set them", async () => {
        await http.request("PUT", `/candidates/${ids[0]}/tag`, { ...as(bob), body: { tag: "placed" } });
        const res = await http.request("DELETE", `/candidates/${ids[0]}/tag`, as(bob));
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data.tags, []);
    });

    it("rejects a tag that isn't on the list", async () => {
        const res = await http.request("PUT", `/candidates/${ids[0]}/tag`, { ...as(bob), body: { tag: "maybe" } });
        assert.equal(res.status, 422);
    });
});

describe("hiding candidates from a search", () => {
    beforeEach(async () => {
        await recordActivity({ userId: ann._id, type: ACTIVITY.RESUME_VIEW, profileIds: [ids[0]] });
        await recordActivity({ userId: bob._id, type: ACTIVITY.CONTACT_VIEW, profileIds: [ids[1]] });
        // Only appearing in results is not working on a candidate.
        await recordActivity({ userId: bob._id, type: ACTIVITY.SEARCH_RESULTS, profileIds: [ids[2]] });
    });

    it("leaves out the caller's own, the team's, or both", async () => {
        const of = async (flags) => [...(await excludedProfileIds({ userId: ann._id, ...flags }))].sort();
        assert.deepEqual(await of({ hideMine: true }), [ids[0]]);
        assert.deepEqual(await of({ hideTeam: true }), [ids[1]]);
        assert.deepEqual(await of({ hideMine: true, hideTeam: true }), [ids[0], ids[1]].sort());
        assert.equal(await excludedProfileIds({ userId: ann._id }), null);
    });
});

describe("export", () => {
    it("returns contact rows in the order asked, and records the export against each candidate", async () => {
        const res = await http.request("POST", "/candidates/export", {
            ...as(ann),
            body: { profileIds: [ids[1], ids[2], ids[0]], source: "search", query: "java" },
        });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data.rows, [
            { profileId: ids[1], email: "arjun@example.com", phone: null },
            { profileId: ids[2], email: null, phone: null },
            { profileId: ids[0], email: "priya@example.com", phone: "9876543210" },
        ]);

        const [event] = await ActivityEvent.find({ type: ACTIVITY.EXPORT }).lean();
        assert.deepEqual(event.profile_ids, [ids[1], ids[2], ids[0]]);
        assert.deepEqual(event.meta, { source: "search", count: 3 });
    });
});

describe("shortlist activity", () => {
    it("records a save once, however many times it's pressed, and a removal", async () => {
        await http.request("POST", "/shortlist/add", { ...as(ann), body: { profileId: ids[0], query: "java" } });
        await http.request("POST", "/shortlist/add", { ...as(ann), body: { profileId: ids[0], query: "java" } });
        await http.request("DELETE", `/shortlist/remove/${ids[0]}`, as(ann));

        const types = (await ActivityEvent.find().sort({ at: 1 }).lean()).map((e) => e.type);
        assert.deepEqual(types, [ACTIVITY.SHORTLIST_ADD, ACTIVITY.SHORTLIST_REMOVE]);
    });
});

describe("retention", () => {
    it("drops typed text from old events and keeps the events", async () => {
        await ActivityEvent.create({ user_id: ann._id, type: ACTIVITY.QUESTION, query: "old", at: daysAgo(100) });
        await ActivityEvent.create({ user_id: ann._id, type: ACTIVITY.QUESTION, query: "recent", at: daysAgo(10) });

        assert.equal(await purgeOldActivityText(), 1);
        const events = await ActivityEvent.find().sort({ at: 1 }).lean();
        assert.equal(events.length, 2);
        assert.equal(events[0].query, undefined);
        assert.equal(events[1].query, "recent");
    });

    it("has a one-year TTL index on the event time", async () => {
        const indexes = await ActivityEvent.collection.indexes();
        const ttl = indexes.find((index) => index.name === "ttl_at");
        assert.equal(ttl.expireAfterSeconds, 365 * 24 * 60 * 60);
    });
});
