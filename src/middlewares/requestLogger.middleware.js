import { randomUUID } from "node:crypto";
import logger from "../utils/logger.js";
import { runWithStats, msSince } from "../utils/requestStats.js";

// A proxy's request id is kept so its logs and ours line up; anything that
// doesn't look like one is replaced rather than written into the logs.
const REQUEST_ID = /^[\w-]{8,64}$/;

// Probes hit liveness every few seconds; at info they would bury everything else.
const QUIET_PATHS = new Set(["/api/v1/health"]);

/**
 * One line per request, written when the response finishes or the client goes
 * away: who, what, how it ended, how long it took, plus whatever the request
 * tracked on the way (see requestStats). The path is taken before routing and
 * without its query string, which can carry search filters.
 */
const requestLogger = (req, res, next) => {
    const started = process.hrtime.bigint();
    const path = req.path;
    const incoming = req.get("x-request-id");

    req.id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.set("X-Request-Id", req.id);
    // Anything logged while handling this request carries its id.
    req.log = logger.child({ reqId: req.id });

    const stats = {};
    let logged = false;

    const log = () => {
        if (logged) return;
        logged = true;

        const status = res.statusCode;
        const level = QUIET_PATHS.has(path) ? "debug" : status >= 500 ? "error" : status >= 400 ? "warn" : "info";

        req.log[level](
            {
                userId: req.user?._id?.toString(),
                method: req.method,
                path,
                route: req.route?.path,
                status,
                ms: msSince(started),
                responseBytes: Number(res.getHeader("content-length")) || undefined,
                // The client left before the response was complete.
                aborted: res.writableFinished ? undefined : true,
                ...stats,
            },
            "request"
        );
    };

    res.on("finish", log);
    res.on("close", log);

    runWithStats({ stats, log: req.log }, next);
};

export { requestLogger };
