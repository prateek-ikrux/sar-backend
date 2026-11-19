import crypto from "node:crypto";
import argon2 from "argon2";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import Otp from "../models/otp.model.js";
import { sendOtpMail, sendPasswordResetMail } from "../utils/mailer.js";
import { verifyPassword, setPassword } from "../utils/password.js";
import { recordActivity } from "../services/activity.service.js";
import { notEmail } from "../validators/common.validator.js";
import {
    ACTIVITY,
    OTP_LENGTH,
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    OTP_PURPOSE,
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

// Which mail carries a code for each purpose.
const MAIL_FOR = {
    [OTP_PURPOSE.LOGIN]: sendOtpMail,
    [OTP_PURPOSE.RESET]: sendPasswordResetMail,
};

// Replaces any live code for this purpose with a fresh one and mails it. Codes
// of other purposes are left alone.
const issueCode = async ({ user, purpose, req }) => {
    const { email } = user;
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await Otp.updateMany(
        { email, purpose, consumed_at: null },
        { consumed_at: new Date() }
    );

    const code = generateCode();
    const otp = await Otp.create({
        email,
        user_id: user._id,
        purpose,
        code_hash: await argon2.hash(code, { type: argon2.argon2id }),
        expires_at: expiresAt,
        ip: req.ip,
        user_agent: req.get("user-agent"),
    });

    await MAIL_FOR[purpose]({
        to: email,
        code,
        name: user.name,
        expiryMinutes: OTP_EXPIRY_MINUTES,
    });

    otp.delivered = true;
    await otp.save();

    return { code, expiresAt };
};

// The attempt is spent atomically before the code is checked. Reading the
// count and saving it after the (slow) hash check would let a burst of
// parallel guesses all see the same count and slip past the limit. Returns
// the matching code, or null; the caller consumes it once it accepts it.
const consumeCode = async ({ email, code, purpose, req }) => {
    const otp = await Otp.findOneAndUpdate(
        {
            email,
            purpose,
            consumed_at: null,
            expires_at: { $gt: new Date() },
            attempts: { $lt: OTP_MAX_ATTEMPTS },
        },
        { $inc: { attempts: 1 } },
        { sort: { created_at: -1 }, returnDocument: "after" }
    );

    if (!otp || !(await argon2.verify(otp.code_hash, code))) {
        await recordFailedLogin(req, { email, userId: otp?.user_id, reason: otp ? "wrong_code" : "no_valid_code" });
        return null;
    }

    return otp;
};

const requestOtp = asyncHandler(async (req, res) => {
    const { email, password } = req.validated.body;

    // Wrong password, unknown address, deactivated account and an account with
    // no password all get this one answer, so the endpoint cannot be used to
    // find out who has an account.
    const rejected = new ApiError(401, "Invalid email or password");

    const user = await User.findOne({ email }).select("+password_hash");

    // With nothing to check against, a dummy hash is verified so the response
    // takes about as long as a real check.
    if (!user?.active || !user.password_hash) {
        await verifyPassword(undefined, password);
        throw rejected;
    }

    if (!(await verifyPassword(user.password_hash, password))) {
        // Not awaited: the answer must not wait on, or fail because of, the log.
        recordFailedLogin(req, { userId: user._id, reason: "wrong_password" }).catch((err) =>
            req.log.warn({ err, userId: user._id.toString() }, "could not record failed login")
        );
        throw rejected;
    }

    const { expiresAt } = await issueCode({ user, purpose: OTP_PURPOSE.LOGIN, req });

    return res.status(200).json(
        new ApiResponse(200, "Verification code sent", { email, expiresAt })
    );
});

const verifyOtp = asyncHandler(async (req, res) => {
    const { email, code } = req.validated.body;

    const invalid = new ApiError(401, "Invalid or expired code");

    const otp = await consumeCode({ email, code, purpose: OTP_PURPOSE.LOGIN, req });
    if (!otp) throw invalid;

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

// The same answer for every address, so this cannot be used to find out who
// has an account. Only an active user is mailed a code, and that happens after
// the answer is sent: waiting for it would make a real address slower than an
// unknown one, and a mail failure would show only for real addresses.
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.validated.body;

    const user = await User.findOne({ email });
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    res.status(200).json(
        new ApiResponse(200, "If this email can sign in, a reset code has been sent", { email, expiresAt })
    );

    if (user?.active) {
        issueCode({ user, purpose: OTP_PURPOSE.RESET, req }).catch((err) =>
            req.log.warn({ err, userId: user._id.toString() }, "reset code mail failed")
        );
    }
});

const resetPassword = asyncHandler(async (req, res) => {
    const { email, code, newPassword } = req.validated.body;

    const invalid = new ApiError(401, "Invalid or expired code");

    const otp = await consumeCode({ email, code, purpose: OTP_PURPOSE.RESET, req });
    if (!otp) throw invalid;

    const user = await User.findById(otp.user_id);

    if (!user?.active) {
        await recordFailedLogin(req, { userId: user?._id, reason: "disabled" });
        throw invalid;
    }

    // Conditional on still being unconsumed, so two concurrent requests with
    // the right code cannot both reset.
    const { modifiedCount } = await Otp.updateOne(
        { _id: otp._id, consumed_at: null },
        { consumed_at: new Date() }
    );

    if (modifiedCount === 0) {
        throw invalid;
    }

    // Ends every earlier session and clears a pending forced change. No token
    // is returned: the user signs in with the new password.
    await setPassword(user, newPassword);

    return res.status(200).json(new ApiResponse(200, "Password reset", { email }));
});

// The signed-in user as the server sees them now. The client holds a snapshot
// from sign-in, so this is how a role or name change made since reaches it.
const me = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, "Current user", req.user));
});

const changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.validated.body;

    // req.user was loaded without the hash.
    const user = await User.findById(req.user._id).select("+password_hash");

    // 400, not 401: the client signs the user out on any 401 to a request that
    // carried a token, and a typo here must not do that.
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
        throw new ApiError(400, "Current password is incorrect");
    }

    if (!notEmail(newPassword, user.email)) {
        throw new ApiError(422, "Validation failed", ["newPassword: must not be your email address"]);
    }
    if (newPassword === currentPassword) {
        throw new ApiError(422, "Validation failed", ["newPassword: must be different from your current password"]);
    }

    await setPassword(user, newPassword);

    // A fresh token, since every earlier one is now older than the change.
    return res.status(200).json(
        new ApiResponse(200, "Password changed", { accessToken: user.generateAccessToken(), user })
    );
});

export { requestOtp, verifyOtp, forgotPassword, resetPassword, me, changePassword };
