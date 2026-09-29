import { Schema, model } from "mongoose";

// One saved candidate on one user's shortlist. Contact details and the name
// are a snapshot from when it was saved: the list refreshes contact details
// from the profiles collection, and falls back to this copy if the profile is gone.
const shortlistItemSchema = new Schema(
    {
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        // The profile's id as the search results give it, which is a string
        // there whatever type the ATS stores.
        profile_id: {
            type: String,
            required: true,
        },
        file_name: { type: String, default: null },
        email: { type: String, default: null },
        phone: { type: String, default: null },
        // As found in the resume; null when it wasn't clear.
        name: { type: String, default: null },
        // The search it was saved from, so the list can say why it's there.
        query: { type: String, default: "" },
        note: { type: String, default: "" },
    },
    {
        collection: "shortlist_items",
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
        versionKey: false,
    }
);

// A candidate is on a user's list at most once; saving again is a no-op.
shortlistItemSchema.index({ user_id: 1, profile_id: 1 }, { unique: true, name: "uniq_user_profile" });
shortlistItemSchema.index({ user_id: 1, created_at: -1 }, { name: "user_recent" });

const ShortlistItem = model("ShortlistItem", shortlistItemSchema);

export default ShortlistItem;
