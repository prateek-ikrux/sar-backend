import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";


const listUsers = asyncHandler(async (req, res) => {
    const { page, limit } = req.validated.query;

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
    const user = await User.findById(req.validated.params.id);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, "User fetched", user));
});

const createUser = asyncHandler(async (req, res) => {
    const { email, name, role } = req.validated.body;

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
    const updates = req.validated.body;

    let user;
    try {
        user = await User.findByIdAndUpdate(req.validated.params.id, updates, {
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
    const user = await User.findByIdAndDelete(req.validated.params.id);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, "User deleted", { _id: user._id }));
});

export { listUsers, getUser, createUser, updateUser, deleteUser };
