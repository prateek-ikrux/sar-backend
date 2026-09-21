import { Schema, model } from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

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
        timestamps: true, 
    }
);

otpSchema.methods.isUsable = function () {
    return !this.consumed_at && this.expires_at > new Date();
};

const Otp = model("Otp", otpSchema);

export default Otp;
