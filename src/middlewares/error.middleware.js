import ApiError from "../utils/apiError.js";

const isProduction = () => process.env.NODE_ENV === "production";

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
        console.error(`${req.method} ${req.originalUrl} failed:`, err);
    }

    return res.status(statusCode).json({
        statusCode,
        message,
        data: null,
        success: false,
        errors,
        ...(isProduction() ? {} : { stack: err?.stack }),
    });
};

export { notFound, errorHandler };
