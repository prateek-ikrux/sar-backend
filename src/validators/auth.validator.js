import { z } from "zod";
import { email, requiredString, password, notEmail } from "./common.validator.js";
import { OTP_LENGTH, PASSWORD_MAX_LENGTH } from "../constants.js";

// Any non-empty password up to the maximum: the minimum length is not checked
// here, so a failed sign-in does not reveal the password rules. Never trimmed.
const requestOtpSchema = z.strictObject({
    email,
    password: requiredString().min(1, { error: "is required" }).max(PASSWORD_MAX_LENGTH),
});

const code = requiredString()
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), {
        error: `must be ${OTP_LENGTH} digits`,
    });

const verifyOtpSchema = z.strictObject({ email, code });

const forgotPasswordSchema = z.strictObject({ email });

const resetPasswordSchema = z.strictObject({ email, code, newPassword: password }).superRefine((value, ctx) => {
    if (!notEmail(value.newPassword, value.email)) {
        ctx.addIssue({ code: "custom", message: "must not be your email address", path: ["newPassword"] });
    }
});

// The email check needs the signed-in user, so the controller does it.
const changePasswordSchema = z.strictObject({
    currentPassword: requiredString().min(1, { error: "is required" }).max(PASSWORD_MAX_LENGTH),
    newPassword: password,
});

export { requestOtpSchema, verifyOtpSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema };
