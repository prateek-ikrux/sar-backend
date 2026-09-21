import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessToken = asyncHandler(async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        return accessToken;
    }
    catch (error) {
        throw new ApiError(500, "Something went wrong while generating access token", [error.message], error.stack);
    }
})

const createUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
})

const loginUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
})

const deleteUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
})

const deactivateUser = asyncHandler(async (req, res) => {
    const { userId } = req.params;
})