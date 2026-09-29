import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/user.model.js";
import { sendWelcomeMail } from "../utils/mailer.js";

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listFilter = ({ q, role, status }) => {
    const filter = {};
    if (q) {
        // Escaped: the search box is free text, not a pattern language.
        const pattern = new RegExp(escapeRegExp(q), "i");
        filter.$or = [{ email: pattern }, { name: pattern }];
    }
    if (role) filter.role = role;
    if (status) filter.active = status === "active";
    return filter;
};

const listUsers = asyncHandler(async (req, res) => {
    const { page, limit, sort, order } = req.validated.query;
    const filter = listFilter(req.validated.query);
    const direction = order === "asc" ? 1 : -1;

    const [users, total] = await Promise.all([
        User.find(filter)
            // _id breaks ties so paging never repeats or skips a row.
            .sort({ [sort]: direction, _id: direction })
            // Case-insensitive ordering, so "alice" sorts beside "Alice".
            .collation({ locale: "en", strength: 2 })
            .skip((page - 1) * limit)
            .limit(limit),
        User.countDocuments(filter),
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

    let user;
    try {
        user = await User.create({ email, name, role });
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

    // The account exists either way; a failed welcome mail only means the
    // admin has to tell them, which `invited` lets the client say.
    let invited = false;
    try {
        await sendWelcomeMail({ to: user.email, name: user.name, role: user.role });
        invited = true;
    } catch (error) {
        req.log.warn({ err: error, userId: user._id.toString() }, "welcome mail failed");
    }

    return res.status(201).json(new ApiResponse(201, "User created", { ...user.toJSON(), invited }));
});

// An admin who demotes, disables or deletes themselves can lock everyone out
// if they were the last admin, so those changes have to come from someone else.
const isSelf = (req) => req.validated.params.id === req.user._id.toString();

const updateUser = asyncHandler(async (req, res) => {
    const updates = req.validated.body;

    if (isSelf(req) && (updates.role !== undefined || updates.active !== undefined)) {
        throw new ApiError(403, "You cannot change your own role or status", [
            "Ask another admin to make this change",
        ]);
    }

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
    if (isSelf(req)) {
        throw new ApiError(403, "You cannot delete your own account", [
            "Ask another admin to make this change",
        ]);
    }

    const user = await User.findByIdAndDelete(req.validated.params.id);

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    return res.status(200).json(new ApiResponse(200, "User deleted", { _id: user._id }));
});

export { listUsers, getUser, createUser, updateUser, deleteUser };
