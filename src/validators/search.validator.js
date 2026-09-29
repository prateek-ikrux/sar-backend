import { z } from "zod";
import { requiredString } from "./common.validator.js";
import {
    SEARCH_LIMIT_MIN,
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_DEFAULT,
    CHARS_PER_DOCUMENT_MIN,
    CHARS_PER_DOCUMENT_MAX,
    CHARS_PER_DOCUMENT_DEFAULT,
    MAX_CONTEXT_CHARS,
    REQUIRE_RESUME_DEFAULT,
} from "../constants.js";

// Each bound alone allows 40 x 20000; only the product says how much resume
// text the model is sent on every turn.
const checkContextSize = (ctx, limit, charsPerDocument) => {
    if (limit * charsPerDocument <= MAX_CONTEXT_CHARS) return;

    ctx.addIssue({
        code: "custom",
        path: ["charsPerDocument"],
        message: `limit x charsPerDocument must be at most ${MAX_CONTEXT_CHARS} (got ${limit} x ${charsPerDocument}); lower one of them`,
    });
};

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

const searchProfilesSchema = z
    .strictObject({
        query,
        requireResume,
        limit: limitBase.default(SEARCH_LIMIT_DEFAULT),
        charsPerDocument: charsPerDocumentBase.default(CHARS_PER_DOCUMENT_DEFAULT),
    })
    .superRefine((body, ctx) => checkContextSize(ctx, body.limit, body.charsPerDocument));

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
        // Opening a conversation: check the size it will be pinned at, with
        // the same defaults askProfiles resolves omitted fields to.
        if (!body.conversationId) {
            checkContextSize(
                ctx,
                body.limit ?? SEARCH_LIMIT_DEFAULT,
                body.charsPerDocument ?? CHARS_PER_DOCUMENT_DEFAULT
            );
            return;
        }

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
