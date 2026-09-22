import crypto from "node:crypto";
import argon2 from "argon2";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import Otp from "../models/otp.model.js";
import { sendOtpMail } from "../utils/mailer.js";
import {
    OTP_LENGTH,
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
} from "../constants.js";

const generateCode = () =>
    String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

const requestOtp = asyncHandler(async (req, res) => {
    const { email } = req.validated.body;

    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(404, "No account found for this email");
    }
    if (!user.active) {
        throw new ApiError(403, "This account is deactivated");
    }

    await Otp.updateMany(
        { email, consumed_at: null },
        { consumed_at: new Date() }
    );

    const code = generateCode();
    const otp = await Otp.create({
        email,
        user_id: user._id,
        code_hash: await argon2.hash(code, { type: argon2.argon2id }),
        expires_at: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        ip: req.ip,
        user_agent: req.get("user-agent"),
    });

    await sendOtpMail({
        to: user.email,
        code,
        name: user.name,
        expiryMinutes: OTP_EXPIRY_MINUTES,
    });

    otp.delivered = true;
    await otp.save();

    return res.status(200).json(
        new ApiResponse(200, "Verification code sent", {
            email: user.email,
            expiresAt: otp.expires_at,
        })
    );
});

const verifyOtp = asyncHandler(async (req, res) => {
    const { email, code } = req.validated.body;

    const otp = await Otp.findOne({ email, consumed_at: null }).sort({ created_at: -1 });

    const invalid = new ApiError(401, "Invalid or expired code");

    if (!otp || otp.expires_at <= new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) {
        throw invalid;
    }

    if (!(await argon2.verify(otp.code_hash, code))) {
        otp.attempts += 1;
        await otp.save();
        throw invalid;
    }

    const user = await User.findById(otp.user_id);

    if (!user?.active) {
        throw invalid;
    }

    otp.consumed_at = new Date();
    await otp.save();

    user.last_login_at = new Date();
    await user.save();

    return res.status(200).json(
        new ApiResponse(200, "Signed in", {
            accessToken: user.generateAccessToken(),
            user,
        })
    );
});

export { requestOtp, verifyOtp };
