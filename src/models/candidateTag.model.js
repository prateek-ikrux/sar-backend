import { Schema, model } from "mongoose";
import { CANDIDATE_TAGS } from "../constants.js";

// A recruiter's current status on a candidate, which every recruiter sees on
// that candidate's card. One per recruiter per candidate: setting it again
// replaces it, and each change is also an activity event. Kept until cleared,
// since "wrong number" stays true longer than any activity window.
const candidateTagSchema = new Schema(
    {
        profile_id: {
            type: String,
            required: true,
        },
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        tag: {
            type: String,
            enum: CANDIDATE_TAGS,
            required: true,
        },
        note: { type: String, default: "" },
    },
    {
        collection: "candidate_tags",
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
        versionKey: false,
    }
);

candidateTagSchema.index({ profile_id: 1, user_id: 1 }, { unique: true, name: "uniq_profile_user" });

const CandidateTag = model("CandidateTag", candidateTagSchema);

export default CandidateTag;
