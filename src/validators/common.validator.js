import { z } from "zod";

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

export { requiredString, email, objectId };
