import { Router } from "express";
import { requestOtp, verifyOtp } from "../controllers/auth.controller.js";
import { validate } from "../middlewares/validate.middleware.js";
import { requestOtpSchema, verifyOtpSchema } from "../validators/auth.validator.js";

const router = Router();

router.route("/auth/request-otp").post(validate({ body: requestOtpSchema }), requestOtp);
router.route("/auth/verify-otp").post(validate({ body: verifyOtpSchema }), verifyOtp);

export default router;
