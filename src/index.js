import mongoose from "mongoose";
import { validateEnv } from "./config/env.js";
import { connectDB } from "./db/index.js";
import app from "./app.js";

// Env comes from the process: `node --env-file` in the npm scripts, env_file
// in compose. Checked before anything tries to use it.
validateEnv();

const PORT = Number(process.env.PORT) || 8000;

// Long enough for an in-flight answer to finish on a normal deploy, short
// enough that a hung request cannot keep the container from stopping.
const SHUTDOWN_TIMEOUT_MS = 10 * 1000;

await connectDB();

// Express 5 hands listen failures (EADDRINUSE, EACCES) to this callback rather
// than throwing. Without the check it would log success, and the open Mongo
// connection would keep a process that serves nothing alive.
const server = app.listen(PORT, (error) => {
    if (error) {
        console.error(`Could not start the server on port ${PORT}:`, error);
        process.exit(1);
    }
    console.log(`Server is running on port ${PORT}`);
});

let shuttingDown = false;

const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);

    setTimeout(() => {
        console.error(`Requests still open after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    // Stops accepting connections and waits for in-flight requests; idle
    // keep-alive sockets are closed straight away.
    server.close(() => {
        mongoose
            .disconnect()
            .catch((error) => console.error("Error closing the MongoDB connection:", error))
            .finally(() => process.exit(0));
    });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
