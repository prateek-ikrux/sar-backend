import crypto from "node:crypto";
import argon2 from "argon2";

const hashPassword = (plain) => argon2.hash(plain, { type: argon2.argon2id });

// Checked against when an account has no password, so "no such password" costs
// the same time as "wrong password" and the response timing doesn't tell them
// apart. Started at load so the first such check is not twice as slow; the
// no-op catch keeps a failed start from being an unhandled rejection (the
// awaiting call below still sees the failure).
const dummyHash = hashPassword(crypto.randomBytes(16).toString("hex"));
dummyHash.catch(() => {});

const verifyPassword = async (hash, plain) => {
    if (!hash) {
        await argon2.verify(await dummyHash, plain).catch(() => false);
        return false;
    }
    // A malformed stored hash makes verify throw; that is a failed check.
    return argon2.verify(hash, plain).catch(() => false);
};

// The one place a new password is written, so a changed and a reset password
// follow the same rules. password_changed_at is cut to the second because a
// token's iat has only second resolution: a token issued in the same second
// must still pass the "issued before the change" check.
const setPassword = async (user, plain) => {
    user.password_hash = await hashPassword(plain);
    user.password_changed_at = new Date(Math.floor(Date.now() / 1000) * 1000);
    await user.save();
    return user;
};

export { hashPassword, verifyPassword, setPassword };
