import ApiError from "../utils/apiError.js";
import logger from "../utils/logger.js";

// Opt-in rather than opt-out: a server started without NODE_ENV (plain
// `npm start`) must not leak internals.
const isDevelopment = () => process.env.NODE_ENV === "development";

const notFound = (req, res, next) => {
    next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

const errorHandler = (err, req, res, next) => {
    let statusCode;
    let message;
    let errors = [];

    if (err instanceof ApiError) {
        statusCode = err.statusCode;
        message = err.message;
        errors = err.errors ?? [];
    } else if (err?.status >= 400 && err.status < 500) {
        statusCode = err.status;
        message = err.message;
    } else {
        statusCode = 500;
        message = "Internal Server Error";
    }

    if (statusCode >= 500) {
        (req.log ?? logger).error({ err, method: req.method, path: req.path }, "request failed");
        // A 5xx's detail comes from upstream services (Graph's error
        // descriptions, for one) and is for the logs above, not the client.
        // The message still says what failed.
        if (!isDevelopment()) errors = [];
    }

    return res.status(statusCode).json({
        statusCode,
        message,
        data: null,
        success: false,
        errors,
        ...(isDevelopment() ? { stack: err?.stack } : {}),
    });
};

export { notFound, errorHandler };
