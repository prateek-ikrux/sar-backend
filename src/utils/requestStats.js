import { AsyncLocalStorage } from "node:async_hooks";
import logger from "./logger.js";

// What one request did behind the scenes (searches run, files checked, text
// sent to the model), gathered wherever it happens and written out once on
// that request's log line. Counts and sizes only, never resume text or
// anything a user typed. Outside a request, tracking does nothing.
const storage = new AsyncLocalStorage();

/** Runs `fn` as part of a request, with its stats object and its logger. */
const runWithStats = ({ stats, log }, fn) => storage.run({ stats, log }, fn);

/**
 * Adds to the request's `section`: numbers are summed across calls, anything
 * else is set. track("minio", { statCalls: 1 }) twice leaves statCalls at 2.
 */
const track = (section, fields) => {
    const stats = storage.getStore()?.stats;
    if (!stats) return;

    const target = (stats[section] ??= {});
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        target[key] = typeof value === "number" ? (target[key] ?? 0) + value : value;
    }
};

/** The current request's logger (its lines carry the request id), else the app's. */
const requestLog = () => storage.getStore()?.log ?? logger;

/** Milliseconds since a process.hrtime.bigint() reading, to 0.1ms. */
const msSince = (started) => Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10;

export { runWithStats, track, requestLog, msSince };
