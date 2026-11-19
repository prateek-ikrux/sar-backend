// Runs against a real mongod (mongodb-memory-server): the OTP guarantees rest
// on atomic updates and unique indexes, which stubs cannot exercise. The first
// run downloads a MongoDB binary into ~/.cache/mongodb-binaries.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applyTestEnv, serve, stubMail } from "./support/helpers.js";

// The per-IP limiters are shared by every request in this file, so each request
// below comes from its own address (read from x-forwarded-for).
applyTestEnv({ TRUST_PROXY: "1" });

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/user.model.js");
const { default: Otp } = await import("../src/models/otp.model.js");
const { default: Activity } = await import("../src/models/activity.model.js");
const { hashPassword, verifyPassword } = await import("../src/utils/password.js");

const CODE = "482915";
const WRONG = "000000";
const PASSWORD = "tester password 1";

let nextIp = 1;
const fromNewIp = () => ({ "x-forwarded-for": `10.0.${Math.floor(nextIp / 250)}.${nextIp++ % 250}` });
const requestOtp = (body, headers = fromNewIp()) => http.request("POST", "/auth/request-otp", { body, headers });

let mongod;
let http;
let user;

before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: "sar_test" });
    await Promise.all([User.init(), Otp.init()]);
    user = await User.create({
        email: "tester@ikrux.com",
        name: "Tester",
        password_hash: await hashPassword(PASSWORD),
    });
    await User.create({
        email: "gone@ikrux.com",
        name: "Gone",
        active: false,
        password_hash: await hashPassword(PASSWORD),
    });
    await User.create({ email: "nopass@ikrux.com", name: "No Password" });
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
        purpose: "login",
        code_hash: await argon2.hash(CODE, { type: argon2.argon2id }),
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
        ...overrides,
    });
};

const verify = async (code) =>
    (await http.request("POST", "/auth/verify-otp", { body: { email: user.email, code }, headers: fromNewIp() })).status;

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

describe("verify-otp purposes", () => {
    it("never signs in with a reset code", async () => {
        await issueCode({ purpose: "reset" });
        assert.equal(await verify(CODE), 401);
    });

    it("ignores codes issued before purpose existed", async () => {
        await Otp.updateMany({ email: user.email, consumed_at: null }, { consumed_at: new Date() });
        await Otp.collection.insertOne({
            email: user.email,
            user_id: user._id,
            code_hash: await argon2.hash(CODE, { type: argon2.argon2id }),
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
            attempts: 0,
            consumed_at: null,
            created_at: new Date(),
        });
        assert.equal(await verify(CODE), 401);
    });
});

// The per-email limit (5) counts every request for an address, so each test
// that signs in uses its own account instead of spending tester's allowance.
const account = async (email, password = PASSWORD) =>
    User.create({ email, name: "Account", password_hash: await hashPassword(password) });

describe("request-otp", () => {
    it("rejects wrong password, unknown, deactivated and password-less accounts identically", async () => {
        await account("wrongpw@ikrux.com");
        const before = await Otp.countDocuments({ email: "wrongpw@ikrux.com" });
        const answers = await Promise.all([
            requestOtp({ email: "wrongpw@ikrux.com", password: "not the password" }),
            requestOtp({ email: "nobody@ikrux.com", password: PASSWORD }),
            requestOtp({ email: "gone@ikrux.com", password: PASSWORD }),
            requestOtp({ email: "nopass@ikrux.com", password: PASSWORD }),
        ]);

        for (const answer of answers) {
            assert.equal(answer.status, 401);
            assert.deepEqual(answer.body, answers[0].body);
        }
        assert.equal(answers[0].body.message, "Invalid email or password");
        assert.equal(await Otp.countDocuments({ email: "wrongpw@ikrux.com" }), before);
    });

    it("mails a login code after a correct password", async () => {
        const mail = stubMail();
        try {
            const response = await requestOtp({ email: "tester@ikrux.com", password: PASSWORD });

            assert.equal(response.status, 200);
            assert.deepEqual(Object.keys(response.body.data).sort(), ["email", "expiresAt"]);
            assert.equal(mail.sent.filter((m) => m.to === "tester@ikrux.com").length, 1);
            assert.equal(await verify(mail.codeFor("tester@ikrux.com")), 200);
        } finally {
            mail.restore();
        }
    });

    it("signs the same user in twice, keeping the password", async () => {
        await account("twice@ikrux.com");
        const mail = stubMail();
        try {
            for (let round = 0; round < 2; round++) {
                assert.equal((await requestOtp({ email: "twice@ikrux.com", password: PASSWORD })).status, 200);
                const signedIn = await http.request("POST", "/auth/verify-otp", {
                    body: { email: "twice@ikrux.com", code: mail.codeFor("twice@ikrux.com") },
                    headers: fromNewIp(),
                });
                assert.equal(signedIn.status, 200);
            }
            const saved = await User.findOne({ email: "twice@ikrux.com" }).select("+password_hash");
            assert.equal(await verifyPassword(saved.password_hash, PASSWORD), true);
        } finally {
            mail.restore();
        }
    });

    it("accepts the email in any case", async () => {
        await account("mixedcase@ikrux.com");
        const mail = stubMail();
        try {
            const response = await requestOtp({ email: "MixedCase@IKRUX.com", password: PASSWORD });
            assert.equal(response.status, 200);
        } finally {
            mail.restore();
        }
    });

    it("keeps spaces in passwords", async () => {
        const spaced = "  spaced out pass  ";
        await account("spaces@ikrux.com", spaced);
        const mail = stubMail();
        try {
            assert.equal((await requestOtp({ email: "spaces@ikrux.com", password: "spaced out pass" })).status, 401);
            assert.equal((await requestOtp({ email: "spaces@ikrux.com", password: spaced })).status, 200);
        } finally {
            mail.restore();
        }
    });

    it("records a failed password against the account", async () => {
        const failing = await account("failing@ikrux.com");
        await Activity.deleteMany({ user_id: failing._id });

        assert.equal((await requestOtp({ email: failing.email, password: "not the password" })).status, 401);

        const logged = await Activity.find({ user_id: failing._id, type: "login_failed" }).lean();
        assert.equal(logged.length, 1);
        assert.equal(logged[0].meta.reason, "wrong_password");
    });

    it("rate limits repeated requests for one address", async () => {
        const statuses = [];
        for (let i = 0; i < 6; i++) {
            statuses.push((await requestOtp({ email: "flood@ikrux.com", password: "whatever password" })).status);
        }
        assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
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

describe("change-password", () => {
    const CHANGED = "a brand new passphrase";
    const secret = () => process.env.ACCESS_TOKEN_SECRET;
    const tokenFor = (u) => u.generateAccessToken();
    const change = (token, body) =>
        http.request("POST", "/auth/change-password", { token, body, headers: fromNewIp() });
    const get = (path, token) => http.request("GET", path, { token, headers: fromNewIp() });

    it("changes the password and swaps the session", async () => {
        const changer = await User.create({
            email: "changer@ikrux.com",
            name: "Changer",
            password_hash: await hashPassword(PASSWORD),
        });
        const now = Math.floor(Date.now() / 1000);
        const oldToken = jwt.sign({ _id: changer._id, email: changer.email, role: changer.role, iat: now - 1 }, secret(), {
            expiresIn: "1h",
        });

        const response = await change(oldToken, { currentPassword: PASSWORD, newPassword: CHANGED });

        assert.equal(response.status, 200);
        assert.equal(response.body.message, "Password changed");
        assert.equal(JSON.stringify(response.body).includes("password_hash"), false);
        assert.equal((await get("/shortlist/list", response.body.data.accessToken)).status, 200);
        assert.equal((await get("/shortlist/list", oldToken)).status, 401);

        const saved = await User.findById(changer._id).select("+password_hash");
        assert.equal(saved.password_changed_at.getMilliseconds(), 0);
        assert.equal(await verifyPassword(saved.password_hash, CHANGED), true);
    });

    it("rejects a wrong current password with 400", async () => {
        const holder = await account("wrongcurrent@ikrux.com");

        const response = await change(tokenFor(holder), { currentPassword: "not the password", newPassword: CHANGED });

        assert.equal(response.status, 400);
        assert.equal(response.body.message, "Current password is incorrect");
        const saved = await User.findById(holder._id).select("+password_hash");
        assert.equal(await verifyPassword(saved.password_hash, PASSWORD), true);
    });

    it("rejects a new password that is the email, too short, or unchanged", async () => {
        const holder = await account("badnew@ikrux.com");
        const token = tokenFor(holder);

        const asEmail = await change(token, { currentPassword: PASSWORD, newPassword: "BadNew@ikrux.com" });
        assert.equal(asEmail.status, 422);
        assert.deepEqual(asEmail.body.errors, ["newPassword: must not be your email address"]);

        assert.equal((await change(token, { currentPassword: PASSWORD, newPassword: "short" })).status, 422);

        const same = await change(token, { currentPassword: PASSWORD, newPassword: PASSWORD });
        assert.equal(same.status, 422);
        assert.deepEqual(same.body.errors, ["newPassword: must be different from your current password"]);
    });

    it("never returns the password hash", async () => {
        const admin = await User.create({
            email: "hashadmin@ikrux.com",
            name: "Admin",
            role: "admin",
            password_hash: await hashPassword(PASSWORD),
        });
        const mail = stubMail();
        try {
            const adminToken = tokenFor(admin);
            const bodies = [
                (await get("/auth/me", adminToken)).body,
                (await get("/users/list", adminToken)).body,
                (
                    await http.request("POST", "/users/create", {
                        token: adminToken,
                        body: { email: "invitee@ikrux.com", name: "Invitee", role: "recruiter" },
                        headers: fromNewIp(),
                    })
                ).body,
            ];

            assert.equal((await requestOtp({ email: admin.email, password: PASSWORD })).status, 200);
            const signedIn = await http.request("POST", "/auth/verify-otp", {
                body: { email: admin.email, code: mail.codeFor(admin.email) },
                headers: fromNewIp(),
            });
            assert.equal(signedIn.status, 200);
            bodies.push(signedIn.body);

            for (const body of bodies) {
                assert.ok(body);
                assert.equal(JSON.stringify(body).includes("password_hash"), false);
            }
        } finally {
            mail.restore();
        }
    });

    it("creates users of either role without a password, telling them to set one", async () => {
        const admin = await User.create({ email: "createadmin@ikrux.com", name: "Admin", role: "admin" });
        const mail = stubMail();
        try {
            for (const role of ["recruiter", "admin"]) {
                const email = `nopw-${role}@ikrux.com`;
                const response = await http.request("POST", "/users/create", {
                    token: tokenFor(admin),
                    body: { email, name: "No Pw", role },
                    headers: fromNewIp(),
                });

                assert.equal(response.status, 201);
                assert.equal(response.body.data.invited, true);
                const saved = await User.findOne({ email }).select("+password_hash");
                assert.equal(saved.password_hash ?? null, null);

                const welcome = mail.sent.find((m) => m.to === email);
                assert.match(welcome.text, /Forgot password/);
                assert.doesNotMatch(welcome.text, /temporary password/i);
            }
        } finally {
            mail.restore();
        }
    });

    it("lets a user with no password set one through Forgot password, then sign in", async () => {
        const fresh = await User.create({ email: "firsttime@ikrux.com", name: "First Time" });
        const mail = stubMail();
        try {
            assert.equal((await requestOtp({ email: fresh.email, password: "anything at all" })).status, 401);

            const forgot = await http.request("POST", "/auth/forgot-password", {
                body: { email: fresh.email },
                headers: fromNewIp(),
            });
            assert.equal(forgot.status, 200);
            await mail.waitFor(fresh.email);
            const reset = await http.request("POST", "/auth/reset-password", {
                body: { email: fresh.email, code: mail.codeFor(fresh.email), newPassword: "my very own passphrase" },
                headers: fromNewIp(),
            });
            assert.equal(reset.status, 200);

            assert.equal((await requestOtp({ email: fresh.email, password: "my very own passphrase" })).status, 200);
        } finally {
            mail.restore();
        }
    });
});

describe("forgot / reset password", () => {
    const RESET = "a freshly reset passphrase";
    const forgot = (email) => http.request("POST", "/auth/forgot-password", { body: { email }, headers: fromNewIp() });
    const reset = (body) => http.request("POST", "/auth/reset-password", { body, headers: fromNewIp() });

    it("answers the same for known and unknown addresses", async () => {
        await account("forgotknown@ikrux.com");
        const mail = stubMail();
        try {
            const known = await forgot("forgotknown@ikrux.com");
            const unknown = await forgot("forgotnobody@ikrux.com");
            await mail.waitFor("forgotknown@ikrux.com");

            assert.equal(known.status, 200);
            assert.equal(unknown.status, 200);
            assert.equal(known.body.message, "If this email can sign in, a reset code has been sent");
            assert.equal(unknown.body.message, known.body.message);
            assert.deepEqual(Object.keys(unknown.body.data).sort(), Object.keys(known.body.data).sort());
            assert.deepEqual(mail.sent.map((m) => m.to), ["forgotknown@ikrux.com"]);
        } finally {
            mail.restore();
        }
    });

    it("answers a real address the same even when the mail cannot be sent", async () => {
        await account("forgotfail@ikrux.com");
        const mail = stubMail({ failSend: true });
        try {
            const known = await forgot("forgotfail@ikrux.com");
            const unknown = await forgot("forgotfailnobody@ikrux.com");
            await mail.waitFor("forgotfail@ikrux.com");

            assert.equal(known.status, 200);
            assert.equal(unknown.status, 200);
            assert.equal(known.body.message, unknown.body.message);
            assert.deepEqual(Object.keys(known.body.data).sort(), Object.keys(unknown.body.data).sort());
        } finally {
            mail.restore();
        }
    });

    it("is not blocked by failed sign-ins for the same address", async () => {
        await account("lockedout@ikrux.com");
        for (let i = 0; i < 5; i++) {
            assert.equal((await requestOtp({ email: "lockedout@ikrux.com", password: "not the password" })).status, 401);
        }
        assert.equal((await requestOtp({ email: "lockedout@ikrux.com", password: "not the password" })).status, 429);

        const mail = stubMail();
        try {
            assert.equal((await forgot("lockedout@ikrux.com")).status, 200);
            await mail.waitFor("lockedout@ikrux.com");
        } finally {
            mail.restore();
        }
    });

    it("sends nothing to a deactivated account", async () => {
        const mail = stubMail();
        try {
            assert.equal((await forgot("gone@ikrux.com")).status, 200);
            assert.equal(mail.sent.length, 0);
        } finally {
            mail.restore();
        }
    });

    it("resets with the mailed code, then signs in with the new password", async () => {
        const holder = await account("resetter@ikrux.com");
        const mail = stubMail();
        try {
            assert.equal((await forgot(holder.email)).status, 200);
            await mail.waitFor(holder.email);
            const response = await reset({ email: holder.email, code: mail.codeFor(holder.email), newPassword: RESET });

            assert.equal(response.status, 200);
            assert.equal(response.body.message, "Password reset");
            assert.deepEqual(response.body.data, { email: holder.email });
            assert.equal(JSON.stringify(response.body).includes("password_hash"), false);

            assert.equal((await requestOtp({ email: holder.email, password: PASSWORD })).status, 401);
            assert.equal((await requestOtp({ email: holder.email, password: RESET })).status, 200);
        } finally {
            mail.restore();
        }
    });

    it("lets only one of two simultaneous correct resets through", async () => {
        const holder = await account("resetrace@ikrux.com");
        const mail = stubMail();
        try {
            await forgot(holder.email);
            await mail.waitFor(holder.email);
            const body = { email: holder.email, code: mail.codeFor(holder.email), newPassword: RESET };
            const results = await Promise.all([reset(body), reset(body)]);
            assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
        } finally {
            mail.restore();
        }
    });

    it("ends existing sessions", async () => {
        const holder = await account("resetsession@ikrux.com");
        const now = Math.floor(Date.now() / 1000);
        const oldToken = jwt.sign({ _id: holder._id, email: holder.email, role: holder.role, iat: now - 1 }, process.env.ACCESS_TOKEN_SECRET, {
            expiresIn: "1h",
        });
        const me = () => http.request("GET", "/auth/me", { token: oldToken, headers: fromNewIp() });
        assert.equal((await me()).status, 200);

        const mail = stubMail();
        try {
            await forgot(holder.email);
            await mail.waitFor(holder.email);
            assert.equal(
                (await reset({ email: holder.email, code: mail.codeFor(holder.email), newPassword: RESET })).status,
                200
            );
        } finally {
            mail.restore();
        }

        assert.equal((await me()).status, 401);
    });

    it("never resets with a login code", async () => {
        const holder = await account("resetlogin@ikrux.com");
        await Otp.create({
            email: holder.email,
            user_id: holder._id,
            purpose: "login",
            code_hash: await argon2.hash(CODE, { type: argon2.argon2id }),
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
        });

        const response = await reset({ email: holder.email, code: CODE, newPassword: RESET });

        assert.equal(response.status, 401);
        assert.equal(response.body.message, "Invalid or expired code");
    });

    it("rejects a new password that is the email address or too short", async () => {
        const asEmail = await reset({ email: "someone.long@ikrux.com", code: CODE, newPassword: "Someone.Long@ikrux.com" });
        assert.equal(asEmail.status, 422);
        assert.deepEqual(asEmail.body.errors, ["newPassword: must not be your email address"]);

        assert.equal((await reset({ email: "someone@ikrux.com", code: CODE, newPassword: "short" })).status, 422);
    });

    it("rejects a code that predates deactivation", async () => {
        const holder = await account("resetlate@ikrux.com");
        await Otp.create({
            email: holder.email,
            user_id: holder._id,
            purpose: "reset",
            code_hash: await argon2.hash(CODE, { type: argon2.argon2id }),
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
        });
        await User.updateOne({ _id: holder._id }, { active: false });

        const response = await reset({ email: holder.email, code: CODE, newPassword: RESET });
        assert.equal(response.status, 401);
    });
});
