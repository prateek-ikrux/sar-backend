import { Router } from "express";
import { requestOtp, verifyOtp } from "../controllers/auth.controller.js";

const router = Router();

router.route("/auth/request-otp").post(requestOtp);
router.route("/auth/verify-otp").post(verifyOtp);

export default router;
