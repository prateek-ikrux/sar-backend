import crypto from "node:crypto";
import argon2 from "argon2";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import Otp from "../models/otp.model.js";
import { sendOtpMail } from "../utils/mailer.js";
import { recordActivity } from "../services/activity.service.js";
import {
    ACTIVITY,
    OTP_LENGTH,
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    USER_AGENT_MAX_CHARS,
} from "../constants.js";

// Where a sign-in came from, for the admin's login history.
const clientOf = (req) => ({
    ip: req.ip,
    userAgent: req.get("user-agent")?.slice(0, USER_AGENT_MAX_CHARS),
});

// Only attempts on a real account are kept, against that account. A wrong
// address has no one to attribute it to, and the rate limits already cover it.
const recordFailedLogin = async (req, { email, userId, reason }) => {
    const id = userId ?? (email ? (await User.findOne({ email }, { _id: 1 }).lean())?._id : undefined);
    if (!id) return;
    await recordActivity({ userId: id, type: ACTIVITY.LOGIN_FAILED, meta: { ...clientOf(req), reason } });
};

const generateCode = () =>
    String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

const requestOtp = asyncHandler(async (req, res) => {
    const { email } = req.validated.body;
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Unknown, deactivated and valid addresses all get this same answer, so
    // the endpoint cannot be used to find out who has an account. The one
    // difference left is timing: only a real account waits on the mail send.
    const sent = () =>
        res.status(200).json(
            new ApiResponse(200, "If this email can sign in, a verification code has been sent", {
                email,
                expiresAt,
            })
        );

    const user = await User.findOne({ email });

    if (!user?.active) {
        return sent();
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
        expires_at: expiresAt,
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

    return sent();
});

const verifyOtp = asyncHandler(async (req, res) => {
    const { email, code } = req.validated.body;

    const invalid = new ApiError(401, "Invalid or expired code");

    // The attempt is spent atomically before the code is checked. Reading the
    // count and saving it after the (slow) hash check would let a burst of
    // parallel guesses all see the same count and slip past the limit.
    const otp = await Otp.findOneAndUpdate(
        {
            email,
            consumed_at: null,
            expires_at: { $gt: new Date() },
            attempts: { $lt: OTP_MAX_ATTEMPTS },
        },
        { $inc: { attempts: 1 } },
        { sort: { created_at: -1 }, returnDocument: "after" }
    );

    if (!otp || !(await argon2.verify(otp.code_hash, code))) {
        await recordFailedLogin(req, { email, userId: otp?.user_id, reason: otp ? "wrong_code" : "no_valid_code" });
        throw invalid;
    }

    const user = await User.findById(otp.user_id);

    if (!user?.active) {
        await recordFailedLogin(req, { userId: user?._id, reason: "disabled" });
        throw invalid;
    }

    // Conditional on still being unconsumed, so two concurrent requests with
    // the right code cannot both sign in.
    const { modifiedCount } = await Otp.updateOne(
        { _id: otp._id, consumed_at: null },
        { consumed_at: new Date() }
    );

    if (modifiedCount === 0) {
        throw invalid;
    }

    user.last_login_at = new Date();
    await user.save();
    await recordActivity({ userId: user._id, type: ACTIVITY.LOGIN, meta: clientOf(req) });

    return res.status(200).json(
        new ApiResponse(200, "Signed in", {
            accessToken: user.generateAccessToken(),
            user,
        })
    );
});

// The signed-in user as the server sees them now. The client holds a snapshot
// from sign-in, so this is how a role or name change made since reaches it.
const me = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, "Current user", req.user));
});

export { requestOtp, verifyOtp, me };
