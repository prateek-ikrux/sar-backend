import jwt from "jsonwebtoken";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import User from "../models/user.model.js";

const verifyJWT = asyncHandler(async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        throw new ApiError(401, "Unauthorized", ["No token provided"]);
    }

    let decodedToken;
    try {
        decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
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

export { verifyJWT };
