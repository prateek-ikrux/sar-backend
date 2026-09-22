import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import { ROLES } from "../constants.js";


const requireValidId = (id) => {
    if (!mongoose.isValidObjectId(id)) {
        throw new ApiError(400, "Invalid user id");
    }
    return id;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Capped rather than optional: an uncapped find() over a collection that keeps
// growing would eventually serve every user in one response.
const listUsers = asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));

    const [users, total] = await Promise.all([
        User.find()
            .sort({ created_at: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        User.countDocuments(),
    ]);

    return res.status(200).json(
        new ApiResponse(200, "Users fetched", {
            users,
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        })
    );
});

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

export { listUsers, getUser, createUser, updateUser, deleteUser };
