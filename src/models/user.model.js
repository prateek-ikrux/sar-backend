import { Schema, model } from "mongoose";
import jwt from "jsonwebtoken";
import { ROLES } from "../constants.js";

const userSchema = new Schema(
    {
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            unique: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        role: {
            type: String,
            enum: Object.values(ROLES),
            default: ROLES.RECRUITER,
        },
        active: {
            type: Boolean,
            default: true,
        },
        last_login_at: {
            type: Date,
            default: null,
        },
    },
    {
        collection: "users",
        // The collection stores created_at, not createdAt.
        timestamps: { createdAt: "created_at", updatedAt: false },
        versionKey: false,
        // uniq_email already exists on the collection; letting Mongoose build
        // its own index from `unique: true` would create a duplicate.
        autoIndex: false,
    }
);

userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        { _id: this._id, email: this.email, role: this.role },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
    );
};

const User = model("User", userSchema);

export default User;
