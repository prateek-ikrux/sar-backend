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
            // Unique via uniq_email below, not `unique: true`, which would
            // declare a second index under Mongoose's default name.
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
    }
);

// Mirrors the index already on the collection, name and options included, so
// building it at startup is a no-op there and a fresh database gets it too.
// createUser has no lookup of its own: this index is what turns a duplicate
// email into the 409.
userSchema.index({ email: 1 }, { unique: true, name: "uniq_email" });

userSchema.methods.generateAccessToken = function () {
    return jwt.sign(
        { _id: this._id, email: this.email, role: this.role },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
    );
};

const User = model("User", userSchema);

export default User;
