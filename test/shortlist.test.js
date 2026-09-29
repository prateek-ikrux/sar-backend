// Runs against a real mongod (mongodb-memory-server), like auth.test.js: the
// shortlist relies on a unique index and on reading the profiles collection.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv, serve } from "./support/helpers.js";

// MINIO_ENDPOINT points at a port nothing listens on, so resume links come
// back null quickly (logged, hence console.error is muted below).
applyTestEnv();

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: ShortlistItem } = await import("../src/models/shortlist.model.js");
const { getProfilesCollection } = await import("../src/db/index.js");
const { SHORTLIST_MAX_ITEMS } = await import("../src/constants.js");

let mongod;
let http;
let ann;
let bob;
const profileIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];

const as = (user) => ({ token: jwt.sign({ _id: user._id }, process.env.ACCESS_TOKEN_SECRET) });
const add = (user, body) => http.request("POST", "/shortlist/add", { ...as(user), body });
const list = async (user) => (await http.request("GET", "/shortlist/list", as(user))).body.data.items;

const originalError = console.error;
before(async () => {
    console.error = () => {};
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await Promise.all([User.init(), ShortlistItem.init()]);
    ann = await User.create({ email: "ann@ikrux.com", name: "Ann" });
    bob = await User.create({ email: "bob@ikrux.com", name: "Bob" });
    http = await serve(app);
});

after(async () => {
    console.error = originalError;
    await http.close();
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    await ShortlistItem.deleteMany({});
    await getProfilesCollection().deleteMany({});
    await getProfilesCollection().insertMany([
        {
            _id: profileIds[0],
            file_name: "priya.pdf",
            email: "priya@example.com",
            phone: null,
            document: "# Priya Sharma | priya@example.com\n\nBuilt payment services in Node.js and MongoDB.",
        },
        { _id: profileIds[1], file_name: "arjun.pdf", email: "arjun@example.com", phone: "9876543210", document: "Arjun" },
    ]);
});

describe("shortlist", () => {
    it("saves a candidate with a summary for the search it came from, once", async () => {
        const first = await add(ann, { profileId: profileIds[0].toString(), query: "node developer" });
        assert.equal(first.status, 201);
        assert.equal(first.body.data.summary.name, "Priya Sharma");
        assert.deepEqual(first.body.data.summary.terms, ["Node"]);
        assert.equal(first.body.data.query, "node developer");

        await add(ann, { profileId: profileIds[0].toString(), query: "something else" });
        const items = await list(ann);
        assert.equal(items.length, 1);
        assert.equal(items[0].query, "node developer");
    });

    it("keeps each user's list to themselves, newest first", async () => {
        await add(ann, { profileId: profileIds[0].toString() });
        await add(ann, { profileId: profileIds[1].toString() });
        await add(bob, { profileId: profileIds[1].toString() });

        assert.deepEqual((await list(ann)).map((i) => i.fileName), ["arjun.pdf", "priya.pdf"]);
        assert.deepEqual((await list(bob)).map((i) => i.fileName), ["arjun.pdf"]);
    });

    it("refuses a candidate that is not in the library", async () => {
        const response = await add(ann, { profileId: new mongoose.Types.ObjectId().toString() });
        assert.equal(response.status, 404);
    });

    it("shows current contact details, and the saved copy once a profile is gone", async () => {
        await add(ann, { profileId: profileIds[0].toString() });
        await getProfilesCollection().updateOne({ _id: profileIds[0] }, { $set: { email: "new@example.com" } });
        assert.equal((await list(ann))[0].email, "new@example.com");

        await getProfilesCollection().deleteOne({ _id: profileIds[0] });
        const [item] = await list(ann);
        assert.equal(item.missing, true);
        assert.equal(item.email, "priya@example.com");
    });

    it("saves notes and removes items, only on the caller's own list", async () => {
        const id = profileIds[0].toString();
        await add(ann, { profileId: id });

        const bobNote = await http.request("PUT", `/shortlist/note/${id}`, { ...as(bob), body: { note: "x" } });
        assert.equal(bobNote.status, 404);

        const note = await http.request("PUT", `/shortlist/note/${id}`, { ...as(ann), body: { note: " Call Monday " } });
        assert.equal(note.body.data.note, "Call Monday");

        assert.equal((await http.request("DELETE", `/shortlist/remove/${id}`, as(bob))).status, 404);
        assert.equal((await http.request("DELETE", `/shortlist/remove/${id}`, as(ann))).status, 200);
        assert.equal((await list(ann)).length, 0);
    });

    it("stops at the size limit", async () => {
        await ShortlistItem.insertMany(
            Array.from({ length: SHORTLIST_MAX_ITEMS }, (_, i) => ({ user_id: ann._id, profile_id: `filler${i}` }))
        );
        const response = await add(ann, { profileId: profileIds[0].toString() });
        assert.equal(response.status, 409);
        assert.equal(response.body.message, "Your shortlist is full");
    });

    it("needs a signed-in user", async () => {
        assert.equal((await http.request("GET", "/shortlist/list")).status, 401);
    });
});
