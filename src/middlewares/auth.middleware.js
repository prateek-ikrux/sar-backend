import jwt from "jsonwebtoken";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import User from "../models/user.model.js";

const verifyJWT = asyncHandler(async (req, res, next) => {
    const [scheme, token, ...rest] = req.headers.authorization?.trim().split(/\s+/) ?? [];

    if (!scheme) {
        throw new ApiError(401, "Unauthorized", ["No token provided"]);
    }
    if (scheme.toLowerCase() !== "bearer" || !token || rest.length > 0) {
        throw new ApiError(401, "Unauthorized", ["Authorization header must be: Bearer <token>"]);
    }

    let decodedToken;
    try {
        // Pinned to the algorithm generateAccessToken signs with, so a token
        // cannot choose how it gets verified.
        decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, { algorithms: ["HS256"] });
    } catch (error) {
        throw new ApiError(401, "Invalid access token", [error.message]);
    }

    const user = await User.findById(decodedToken._id);

    if (!user?.active) {
        throw new ApiError(401, "Unauthorized", ["User not found or deactivated"]);
    }

    req.user = user;
    next();
});

// Runs after verifyJWT. The role comes from the user just loaded, not the
// token, so a demotion takes effect on the next request.
const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
        return next(new ApiError(403, "Forbidden", ["You do not have access to this resource"]));
    }
    next();
};

export { verifyJWT, requireRole };
