import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import { summaryFor, searchesFor, eventsFor } from "../services/activityReport.service.js";

// Admin-only (see user.routes): how one recruiter uses the platform.

const SEARCHES_PER_PAGE = 20;
const EVENTS_PER_PAGE = 50;

// A removed user's activity stays until it expires, but there is no page for
// them: the Users table is the way in.
const findUser = async (id) => {
    const user = await User.findById(id);
    if (!user) throw new ApiError(404, "User not found");
    return user;
};

const activitySummary = asyncHandler(async (req, res) => {
    const { id } = req.validated.params;
    const { days, tz } = req.validated.query;
    const user = await findUser(id);

    return res
        .status(200)
        .json(new ApiResponse(200, "Activity summary", { user, ...(await summaryFor({ userId: id, days, tz })) }));
});

const activitySearches = asyncHandler(async (req, res) => {
    const { id } = req.validated.params;
    const { days, page } = req.validated.query;
    await findUser(id);

    return res
        .status(200)
        .json(
            new ApiResponse(200, "Searches", await searchesFor({ userId: id, days, page, limit: SEARCHES_PER_PAGE }))
        );
});

const activityEvents = asyncHandler(async (req, res) => {
    const { id } = req.validated.params;
    const { before } = req.validated.query;
    await findUser(id);

    return res
        .status(200)
        .json(new ApiResponse(200, "Activity", await eventsFor({ userId: id, before, limit: EVENTS_PER_PAGE })));
});

export { activitySummary, activitySearches, activityEvents };
