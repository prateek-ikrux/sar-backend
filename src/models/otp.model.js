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
    }
);

// Both mirror the indexes already on the collection, names and options
// included, so building them at startup is a no-op there and a fresh database
// gets them too.

// Serves every lookup here: the live code for an address, newest first.
otpSchema.index({ email: 1, created_at: -1 }, { name: "by_email" });

// MongoDB deletes each code an hour after it expires, so the collection (and
// the IPs and user agents it records) never grows past recent sign-ins.
otpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 3600, name: "ttl_expired_codes" });

const Otp = model("Otp", otpSchema);

export default Otp;
