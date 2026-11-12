import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import { verifyJWT, requireRole } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { objectId } from "../validators/common.validator.js";
import { activitySummaryQuerySchema, timeZone } from "../validators/user.validator.js";
import { teamSummary, flagsFor } from "../services/teamReport.service.js";
import { describeSettings, saveSettings, sendTestSummary } from "../services/weeklySummary.service.js";
import { ROLES, WEEKLY_SUMMARY_MAX_RECIPIENTS } from "../constants.js";

// The whole team's activity, and the weekly summary email. Admins only.
const router = Router();

router.use("/team", verifyJWT, requireRole(ROLES.ADMIN));

const DAY_MS = 24 * 60 * 60 * 1000;

router.route("/team/summary").get(
    validate({ query: activitySummaryQuerySchema }),
    asyncHandler(async (req, res) => {
        const { days, tz } = req.validated.query;
        return res.status(200).json(new ApiResponse(200, "Team activity", await teamSummary({ days, tz })));
    })
);

const flagsQuerySchema = activitySummaryQuerySchema.extend({ userId: objectId.optional() });

router.route("/team/flags").get(
    validate({ query: flagsQuerySchema }),
    asyncHandler(async (req, res) => {
        const { days, tz, userId } = req.validated.query;
        const flags = await flagsFor({
            from: new Date(Date.now() - days * DAY_MS),
            tz,
            userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
        });
        return res.status(200).json(new ApiResponse(200, "Flags", { flags }));
    })
);

router.route("/team/weekly-email").get(
    asyncHandler(async (req, res) =>
        res.status(200).json(new ApiResponse(200, "Weekly summary settings", await describeSettings()))
    )
);

const weeklyEmailSchema = z.strictObject({
    enabled: z.boolean({ error: "must be true or false" }),
    recipientIds: z
        .array(objectId, { error: "must be a list of user ids" })
        .max(WEEKLY_SUMMARY_MAX_RECIPIENTS, { error: `must hold at most ${WEEKLY_SUMMARY_MAX_RECIPIENTS} people` })
        .transform((ids) => [...new Set(ids)]),
    timeZone,
});

router.route("/team/weekly-email").put(
    validate({ body: weeklyEmailSchema }),
    asyncHandler(async (req, res) => {
        const { enabled, recipientIds, timeZone: tz } = req.validated.body;
        const result = await saveSettings({ enabled, recipientIds, timeZone: tz, updatedBy: req.user._id });
        if (result.error) throw new ApiError(422, "Validation failed", [`recipientIds: ${result.error}`]);
        return res.status(200).json(new ApiResponse(200, "Weekly summary settings saved", result.settings));
    })
);

// To the admin asking, whatever the settings: a preview in their own inbox.
router.route("/team/weekly-email/test").post(
    asyncHandler(async (req, res) => {
        await sendTestSummary({ to: req.user.email });
        return res.status(200).json(new ApiResponse(200, "Test summary sent", { to: req.user.email }));
    })
);

export default router;
