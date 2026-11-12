import { Schema, model } from "mongoose";
import { ACTIVITY_RETENTION_DAYS } from "../constants.js";

// One sitting on the platform: a run of check-ins from the page, each within
// SESSION_GAP_MS of the last. active_seconds counts only time the page was
// visible and in use. Kept as long as activity events.
const usageSessionSchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        started_at: { type: Date, required: true },
        last_seen_at: { type: Date, required: true },
        active_seconds: { type: Number, default: 0 },
        heartbeats: { type: Number, default: 1 },
    },
    {
        collection: "usage_sessions",
        versionKey: false,
    }
);

usageSessionSchema.index(
    { last_seen_at: 1 },
    { name: "ttl_last_seen", expireAfterSeconds: ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 }
);
usageSessionSchema.index({ user_id: 1, last_seen_at: -1 }, { name: "user_recent" });

const UsageSession = model("UsageSession", usageSessionSchema);

export default UsageSession;
