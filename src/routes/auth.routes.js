import { Router } from "express";
import {
    requestOtp,
    verifyOtp,
    forgotPassword,
    resetPassword,
    me,
    changePassword,
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
    otpRequestIpLimiter,
    otpRequestEmailLimiter,
    forgotPasswordIpLimiter,
    forgotPasswordEmailLimiter,
    otpVerifyIpLimiter,
    passwordChangeIpLimiter,
} from "../middlewares/rateLimit.middleware.js";
import {
    requestOtpSchema,
    verifyOtpSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    changePasswordSchema,
} from "../validators/auth.validator.js";

const router = Router();

router
    .route("/auth/request-otp")
    .post(
        otpRequestIpLimiter,
        validate({ body: requestOtpSchema }),
        otpRequestEmailLimiter,
        requestOtp
    );
router
    .route("/auth/verify-otp")
    .post(otpVerifyIpLimiter, validate({ body: verifyOtpSchema }), verifyOtp);
router
    .route("/auth/forgot-password")
    .post(
        forgotPasswordIpLimiter,
        validate({ body: forgotPasswordSchema }),
        forgotPasswordEmailLimiter,
        forgotPassword
    );
router
    .route("/auth/reset-password")
    .post(otpVerifyIpLimiter, validate({ body: resetPasswordSchema }), resetPassword);
router.route("/auth/me").get(verifyJWT, me);
router
    .route("/auth/change-password")
    .post(passwordChangeIpLimiter, verifyJWT, validate({ body: changePasswordSchema }), changePassword);

export default router;
