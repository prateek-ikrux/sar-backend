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
            unique: true,
        },
        role: {
            type: String,
            enum: ROLES,
            default: ROLES.USER
        },
        active: {
            type: Boolean,
            default: true
        },
    },
    {   
        collection: "users",
        timestamps: true,
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
