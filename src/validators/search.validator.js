import { z } from "zod";
import { requiredString } from "./common.validator.js";
import {
    SEARCH_LIMIT_MIN,
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_DEFAULT,
    CHARS_PER_DOCUMENT_MIN,
    CHARS_PER_DOCUMENT_MAX,
    CHARS_PER_DOCUMENT_DEFAULT,
    REQUIRE_RESUME_DEFAULT,
} from "../constants.js";

const query = requiredString()
    .trim()
    .min(3, { error: "must be at least 3 characters" })
    .max(1000, { error: "must be at most 1000 characters" });

const limitBase = z.coerce
    .number({ error: "must be a number" })
    .int({ error: "must be a whole number" })
    .min(SEARCH_LIMIT_MIN, { error: `must be at least ${SEARCH_LIMIT_MIN}` })
    .max(SEARCH_LIMIT_MAX, { error: `must be at most ${SEARCH_LIMIT_MAX}` });

const charsPerDocumentBase = z.coerce
    .number({ error: "must be a number" })
    .int({ error: "must be a whole number" })
    .min(CHARS_PER_DOCUMENT_MIN, { error: `must be at least ${CHARS_PER_DOCUMENT_MIN}` })
    .max(CHARS_PER_DOCUMENT_MAX, { error: `must be at most ${CHARS_PER_DOCUMENT_MAX}` });

const conversationId = requiredString()
    .trim()
    .pipe(z.uuid({ error: "must be a valid conversation id" }));

const requireResume = z.boolean({ error: "must be true or false" }).default(REQUIRE_RESUME_DEFAULT);

const searchProfilesSchema = z.strictObject({
    query,
    requireResume,
    limit: limitBase.default(SEARCH_LIMIT_DEFAULT),
    charsPerDocument: charsPerDocumentBase.default(CHARS_PER_DOCUMENT_DEFAULT),
});

// limit and charsPerDocument stay optional rather than defaulted: a default
// would make them indistinguishable from values the caller actually sent, and
// the refinement below has to reject only the ones that were sent.
const askProfilesSchema = z
    .strictObject({
        question: query,
        conversationId: conversationId.optional(),
        requireResume: z.boolean({ error: "must be true or false" }).optional(),
        limit: limitBase.optional(),
        charsPerDocument: charsPerDocumentBase.optional(),
    })
    .superRefine((body, ctx) => {
        if (!body.conversationId) return;

        for (const field of ["limit", "charsPerDocument", "requireResume"]) {
            if (body[field] !== undefined) {
                ctx.addIssue({
                    code: "custom",
                    path: [field],
                    message: "cannot be changed on a follow-up question",
                });
            }
        }
    });

const endConversationSchema = z.strictObject({ conversationId });

export { searchProfilesSchema, askProfilesSchema, endConversationSchema };
