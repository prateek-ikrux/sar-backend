import { Router } from "express";
import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/apiResponse.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { recordHeartbeat } from "../services/session.service.js";

const router = Router();

router.use("/activity", verifyJWT);

// The page checks in while it is visible and in use; see session.service.
router.route("/activity/heartbeat").post(
    asyncHandler(async (req, res) => {
        await recordHeartbeat(req.user._id);
        return res.status(200).json(new ApiResponse(200, "Recorded", null));
    })
);

export default router;
