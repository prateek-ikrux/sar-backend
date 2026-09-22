import ApiError from "../utils/apiError.js";

const formatIssue = (issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
};

const validate = (schemas) => (req, res, next) => {
    req.validated = {};

    for (const source of ["body", "params", "query"]) {
        const schema = schemas[source];
        if (!schema) continue;

        const result = schema.safeParse(req[source] ?? {});

        if (!result.success) {
            return next(
                new ApiError(422, "Validation failed", result.error.issues.map(formatIssue))
            );
        }

        req.validated[source] = result.data;
    }

    next();
};

export { validate };
