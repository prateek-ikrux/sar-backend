import pino from "pino";

// One JSON line per event on stdout, for whatever collects the container's
// logs. Tests are silent unless LOG_LEVEL asks otherwise, so their output
// stays readable.
const logger = pino({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
});

export default logger;
