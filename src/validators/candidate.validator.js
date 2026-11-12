import { z } from "zod";
import { requiredString } from "./common.validator.js";
import { profileIdParamSchema } from "./shortlist.validator.js";
import { CANDIDATE_TAGS, CANDIDATE_TAG_NOTE_MAX_CHARS, EXPORT_MAX_ROWS } from "../constants.js";

const profileId = profileIdParamSchema.shape.profileId;

const setTagSchema = z.strictObject({
    tag: z.enum(CANDIDATE_TAGS, { error: `must be one of: ${CANDIDATE_TAGS.join(", ")}` }),
    note: z
        .string({ error: "must be a string" })
        .trim()
        .max(CANDIDATE_TAG_NOTE_MAX_CHARS, { error: `must be at most ${CANDIDATE_TAG_NOTE_MAX_CHARS} characters` })
        .default(""),
});

const exportSchema = z.strictObject({
    profileIds: z
        .array(profileId, { error: "must be a list of candidate ids" })
        .min(1, { error: "must not be empty" })
        .max(EXPORT_MAX_ROWS, { error: `must hold at most ${EXPORT_MAX_ROWS} candidates` }),
    source: z.enum(["search", "shortlist"], { error: "must be search or shortlist" }),
    // The search the rows came from, when exporting search results.
    query: requiredString().trim().max(1000, { error: "must be at most 1000 characters" }).optional(),
});

export { profileIdParamSchema, setTagSchema, exportSchema };
