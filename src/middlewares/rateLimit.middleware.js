import { rateLimit } from "express-rate-limit";
import ApiError from "../utils/apiError.js";
import {
    RATE_LIMIT_WINDOW_MS,
    OTP_REQUESTS_PER_IP,
    OTP_REQUESTS_PER_EMAIL,
    OTP_VERIFICATIONS_PER_IP,
} from "../constants.js";

// Counters are kept in process memory, which is enough for a single instance.
// Behind a proxy, set TRUST_PROXY so req.ip is the client rather than the proxy.
const limiter = ({ limit, keyGenerator }) =>
    rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit,
        ...(keyGenerator ? { keyGenerator } : {}),
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (req, res, next) =>
            next(
                new ApiError(429, "Too many requests", [
                    `Try again in ${Math.ceil(RATE_LIMIT_WINDOW_MS / 60000)} minutes`,
                ])
            ),
    });

const otpRequestIpLimiter = limiter({ limit: OTP_REQUESTS_PER_IP });

// Keyed on the address being mailed, so rotating IPs cannot flood one inbox or
// mint an unbounded supply of fresh codes to guess against. Runs after
// validate(), which has already normalised the email.
const otpRequestEmailLimiter = limiter({
    limit: OTP_REQUESTS_PER_EMAIL,
    keyGenerator: (req) => `email:${req.validated.body.email}`,
});

const otpVerifyIpLimiter = limiter({ limit: OTP_VERIFICATIONS_PER_IP });

export { otpRequestIpLimiter, otpRequestEmailLimiter, otpVerifyIpLimiter };
