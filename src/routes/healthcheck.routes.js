import { Router } from "express";
import { healthcheck, serviceHealthcheck } from "../controllers/healthcheck.controller.js";
import { verifyJWT, requireRole } from "../middlewares/auth.middleware.js";
import { ROLES } from "../constants.js";

const router = Router();

// Liveness stays public for container and load-balancer probes.
router.route("/health").get(healthcheck);
// Readiness calls OpenAI, Graph and MinIO on every hit and names internal
// hosts and accounts, so it is admin-only.
router
    .route("/health/services")
    .get(verifyJWT, requireRole(ROLES.ADMIN), serviceHealthcheck);

export default router;
