import { Router } from "express";
import { requestOtp, verifyOtp, me } from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
    otpRequestIpLimiter,
    otpRequestEmailLimiter,
    otpVerifyIpLimiter,
} from "../middlewares/rateLimit.middleware.js";
import { requestOtpSchema, verifyOtpSchema } from "../validators/auth.validator.js";

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
router.route("/auth/me").get(verifyJWT, me);

export default router;
