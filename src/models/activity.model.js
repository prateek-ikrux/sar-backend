import { Schema, model } from "mongoose";
import { ACTIVITY, ACTIVITY_RETENTION_DAYS } from "../constants.js";

// One thing a recruiter did. Candidates are referenced by id only: their
// details stay in the profiles collection. `query` holds what was typed (a
// search or a question) and is removed after ACTIVITY_TEXT_RETENTION_DAYS;
// the event itself goes after ACTIVITY_RETENTION_DAYS.
const activitySchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        type: {
            type: String,
            enum: Object.values(ACTIVITY),
            required: true,
        },
        at: {
            type: Date,
            default: Date.now,
        },
        // Profile ids as the search results give them (strings). One for most
        // actions; every result for a search, so one search is one event.
        profile_ids: { type: [String], default: undefined },
        query: { type: String, default: undefined },
        // Small, type-specific facts: result count, the tag set, where an
        // export came from.
        meta: { type: Schema.Types.Mixed, default: undefined },
    },
    {
        collection: "activity_events",
        versionKey: false,
    }
);

activitySchema.index(
    { at: 1 },
    { name: "ttl_at", expireAfterSeconds: ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 }
);
// "What has the team done with these candidates lately", asked on every search.
activitySchema.index({ profile_ids: 1, at: -1 }, { name: "profile_recent" });
// One recruiter's activity, for the admin pages.
activitySchema.index({ user_id: 1, at: -1 }, { name: "user_recent" });

const ActivityEvent = model("ActivityEvent", activitySchema);

export default ActivityEvent;
