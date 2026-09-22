import { z } from "zod";
import { email, requiredString } from "./common.validator.js";
import { OTP_LENGTH } from "../constants.js";

const requestOtpSchema = z.strictObject({ email });

const verifyOtpSchema = z.strictObject({
    email,
    code: requiredString()
        .trim()
        .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), {
            error: `must be ${OTP_LENGTH} digits`,
        }),
});

export { requestOtpSchema, verifyOtpSchema };
