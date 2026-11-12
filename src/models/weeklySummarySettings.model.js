import { Schema, model } from "mongoose";

// The weekly summary email's settings: one document. Off until an admin turns
// it on and picks who gets it. last_sent_week (the Monday it went out, as
// YYYY-MM-DD in time_zone) is how two servers agree it's been sent.
const weeklySummarySettingsSchema = new Schema(
    {
        key: { type: String, default: "weekly_summary", immutable: true },
        enabled: { type: Boolean, default: false },
        recipient_ids: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
        time_zone: { type: String, default: "Asia/Kolkata" },
        last_sent_week: { type: String, default: null },
        last_sent_at: { type: Date, default: null },
        last_error: { type: String, default: null },
        updated_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    {
        collection: "weekly_summary_settings",
        timestamps: { createdAt: false, updatedAt: "updated_at" },
        versionKey: false,
    }
);

weeklySummarySettingsSchema.index({ key: 1 }, { unique: true, name: "uniq_key" });

const WeeklySummarySettings = model("WeeklySummarySettings", weeklySummarySettingsSchema);

export default WeeklySummarySettings;
