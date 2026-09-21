import { Schema, model } from "mongoose";

const otpSchema = new Schema(
    {
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        user_id: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        code_hash: {
            type: String,
            required: true,
        },
        expires_at: {
            type: Date,
            required: true,
        },
        attempts: {
            type: Schema.Types.Int32,
            default: 0,
        },
        consumed_at: {
            type: Date,
            default: null,
        },
        ip: {
            type: String,
            default: null,
        },
        user_agent: {
            type: String,
            default: null,
        },
        delivered: {
            type: Boolean,
            default: false,
        },
    },
    {
        collection: "otp_codes",
        timestamps: { createdAt: "created_at", updatedAt: false },
        versionKey: false,
        // by_email and ttl_expired_codes already exist on the collection.
        autoIndex: false,
    }
);

const Otp = model("Otp", otpSchema);

export default Otp;
