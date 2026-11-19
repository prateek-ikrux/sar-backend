import { z } from "zod";
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "../constants.js";

const requiredString = () =>
    z.string({
        error: (issue) => (issue.input === undefined ? "is required" : "must be a string"),
    });

const email = requiredString()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "must be a valid email address" }));

const objectId = requiredString().regex(/^[0-9a-fA-F]{24}$/, {
    error: "must be a valid user id",
});

// A new password, exactly as typed: never trimmed or lowercased, since spaces
// and case are part of what the person chose.
const password = requiredString()
    .min(PASSWORD_MIN_LENGTH, { error: `must be at least ${PASSWORD_MIN_LENGTH} characters` })
    .max(PASSWORD_MAX_LENGTH, { error: `must be at most ${PASSWORD_MAX_LENGTH} characters` });

// For a refinement on an object holding both: true when the password is not
// just the email address (compared case-insensitively).
const notEmail = (value, address) => value.toLowerCase() !== String(address).trim().toLowerCase();

export { requiredString, email, objectId, password, notEmail };
