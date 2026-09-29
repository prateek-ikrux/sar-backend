import { z } from "zod";
import { requiredString } from "./common.validator.js";
import { SHORTLIST_NOTE_MAX_CHARS } from "../constants.js";

// Profile ids come from the search results, which stringify whatever the ATS
// stores (an ObjectId in practice), so this checks shape rather than type.
const profileId = requiredString()
    .trim()
    .regex(/^[\w-]{1,64}$/, { error: "must be a valid candidate id" });

const note = z
    .string({ error: "must be a string" })
    .trim()
    .max(SHORTLIST_NOTE_MAX_CHARS, { error: `must be at most ${SHORTLIST_NOTE_MAX_CHARS} characters` });

const addToShortlistSchema = z.strictObject({
    profileId,
    // The search it was saved from; also what the saved summary is built for.
    query: z.string({ error: "must be a string" }).trim().max(1000, { error: "must be at most 1000 characters" }).optional(),
    // Lets an undone removal come back with its note.
    note: note.optional(),
});

const shortlistNoteSchema = z.strictObject({ note });

const profileIdParamSchema = z.object({ profileId });

export { addToShortlistSchema, shortlistNoteSchema, profileIdParamSchema };
