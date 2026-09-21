import { Router } from "express";
import { healthcheck, serviceHealthcheck } from "../controllers/healthcheck.controller.js";

const router = Router();

router.route("/health").get(healthcheck);
router.route("/health/services").get(serviceHealthcheck);

export default router;
