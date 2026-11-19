// One-off cleanup after dropping handed-out passwords. Users used to get a
// starting password (Firstname@ikrux) or a generated one, with
// must_change_password forcing them to replace it. Both are gone: everyone now
// sets their own password through Forgot password, and nothing reads the flag.
//
// - must_change_password: true -> still on a password they didn't choose, and
//   with no forced change that password would simply work. Its hash is removed
//   (they set their own through Forgot password), and password_changed_at is set
//   to now, which ends any session signed in with it.
// - must_change_password present but not true -> they chose their own password.
//   Only the leftover flag is removed.
//
// Reports only, unless run with --apply. Goes through the raw collection
// because must_change_password is no longer in the schema, and Mongoose would
// strip it from the update. See "Cleaning up handed-out passwords" in the README.
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import User from "../src/models/user.model.js";

const STILL_HANDED_OUT = { must_change_password: true };
const FLAG_ONLY = { must_change_password: { $exists: true, $ne: true } };

export const cleanupHandedOutPasswords = async ({ apply = false } = {}) => {
    const users = User.collection;
    const cleared = (await users.find(STILL_HANDED_OUT, { projection: { email: 1 } }).toArray()).map((u) => u.email);

    if (!apply) {
        return { applied: false, cleared, flagOnly: await users.countDocuments(FLAG_ONLY) };
    }

    // Cut to the second like every password change, since a token's iat has
    // second resolution.
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    await users.updateMany(STILL_HANDED_OUT, {
        $unset: { password_hash: "", must_change_password: "" },
        $set: { password_changed_at: now },
    });
    const { modifiedCount: flagOnly } = await users.updateMany(FLAG_ONLY, { $unset: { must_change_password: "" } });

    return { applied: true, cleared, flagOnly };
};

const main = async () => {
    const missing = ["MONGODB_URI", "SEARCH_AND_RETRIEVAL_DB_NAME"].filter((name) => !process.env[name]);
    if (missing.length) {
        throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
    }
    const apply = process.argv.includes("--apply");

    await mongoose.connect(process.env.MONGODB_URI, {
        dbName: process.env.SEARCH_AND_RETRIEVAL_DB_NAME,
    });
    try {
        const { cleared, flagOnly } = await cleanupHandedOutPasswords({ apply });
        const verb = apply ? "" : "would be ";
        console.log(`${apply ? "Applied" : "Dry run, nothing changed"} (database: ${process.env.SEARCH_AND_RETRIEVAL_DB_NAME})`);
        console.log(`${cleared.length} user(s) ${verb}cleared of a handed-out password; they set their own with Forgot password:`);
        for (const email of cleared) console.log(`  ${email}`);
        console.log(`${flagOnly} user(s) who chose their own password ${verb}stripped of the leftover flag only.`);
        if (!apply) console.log("Run again with --apply to make these changes.");
    } finally {
        await mongoose.disconnect();
    }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
