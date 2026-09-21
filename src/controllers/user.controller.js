import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import { ROLES } from "../constants.js";

// findById(undefined) matches the first document in the collection rather
// than nothing, so ids are checked before they reach a query.
const requireValidId = (id) => {
    if (!mongoose.isValidObjectId(id)) {
        throw new ApiError(400, "Invalid user id");
    }
    return id;
};

const getUser = asyncHandler(async (req, res) => {
    const user = await User.findById(requireValidId(req.params.id));

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, "User fetched", user));
});

const createUser = asyncHandler(async (req, res) => {
    const { email, name, role } = req.body ?? {};

    try {
        const user = await User.create({ email, name, role });
        return res.status(201).json(new ApiResponse(201, "User created", user));
    } catch (error) {
        if (error.name === "ValidationError") {
            throw new ApiError(422, "Validation failed", Object.values(error.errors).map((e) => e.message));
        }
        // uniq_email is enforced by the collection, so a duplicate arrives as
        // a write error rather than from a lookup we did first.
        if (error.code === 11000) {
            throw new ApiError(409, "A user with that email already exists");
        }
        throw error;
    }
});

const updateUser = asyncHandler(async (req, res) => {
    const { name, role, active } = req.body ?? {};
    const updates = {};

    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;

    if (!Object.keys(updates).length) {
        throw new ApiError(422, "Validation failed", [`send one of: name, role, active`]);
    }

    let user;
    try {
        user = await User.findByIdAndUpdate(requireValidId(req.params.id), updates, {
            returnDocument: "after",
            runValidators: true,
        });
    } catch (error) {
        if (error.name === "ValidationError") {
            throw new ApiError(422, "Validation failed", Object.values(error.errors).map((e) => e.message));
        }
        throw error;
    }

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, "User updated", user));
});

const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findByIdAndDelete(requireValidId(req.params.id));

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, "User deleted", { _id: user._id }));
});

export { getUser, createUser, updateUser, deleteUser };
