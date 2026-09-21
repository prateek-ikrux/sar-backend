import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/apiResponse.js";
import { getClient as getMinioClient } from "../utils/minio.js";

const CHECK_TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS) || 5000;

const MONGO_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

const toMb = (bytes) => Math.round((bytes / 1024 / 1024) * 100) / 100;

const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        throw error.name === "AbortError"
            ? new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)
            : error;
    } finally {
        clearTimeout(timer);
    }
};

// Guards the checks that talk over a driver rather than fetch, so a stalled
// socket can never hold the whole response open.
const withTimeout = (promise) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
            CHECK_TIMEOUT_MS
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const runCheck = async (name, check) => {
    const startedAt = Date.now();
    try {
        const details = await withTimeout(check());
        return { name, status: "ok", latencyMs: Date.now() - startedAt, ...details };
    } catch (error) {
        return { name, status: "error", latencyMs: Date.now() - startedAt, message: error.message };
    }
};

// One ping covers every database on the cluster: useDb() handles share this
// connection's socket pool, so there is nothing separate to check for ats.
const checkMongo = async () => {
    const { connection } = mongoose;
    if (connection.readyState !== 1) {
        throw new Error(`connection is ${MONGO_STATES[connection.readyState] ?? "unknown"}`);
    }
    await connection.db.admin().command({ ping: 1 });
    return { database: connection.name, host: connection.host };
};

const checkMinio = async () => {
    const bucket = process.env.MINIO_BUCKET;
    if (!(await getMinioClient().bucketExists(bucket))) {
        throw new Error(`bucket "${bucket}" not found`);
    }
    return { bucket };
};

const checkOpenAI = async () => {
    const response = await fetchWithTimeout("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    if (!response.ok) {
        throw new Error(`responded ${response.status} ${response.statusText}`);
    }
    return { model: process.env.OPENAI_MODEL };
};

const checkGraph = async () => {
    const response = await fetchWithTimeout(
        `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
        {
            method: "POST",
            body: new URLSearchParams({
                client_id: process.env.GRAPH_CLIENT_ID,
                client_secret: process.env.GRAPH_CLIENT_SECRET,
                scope: "https://graph.microsoft.com/.default",
                grant_type: "client_credentials",
            }),
        }
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
            payload.error_description?.split(/\r?\n/)[0] ?? `responded ${response.status}`
        );
    }
    return { sender: process.env.GRAPH_SENDER };
};

// Liveness: answers "is this process up", touching no dependency, so an
// orchestrator never restarts the server because MinIO had a bad minute.
const healthcheck = asyncHandler(async (req, res) => {
    const { rss, heapUsed, heapTotal } = process.memoryUsage();

    return res.status(200).json(
        new ApiResponse(200, "Server is healthy", {
            status: "ok",
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            pid: process.pid,
            nodeVersion: process.version,
            memoryMb: { rss: toMb(rss), heapUsed: toMb(heapUsed), heapTotal: toMb(heapTotal) },
        })
    );
});

// Readiness: every dependency, probed in parallel. 503 when any is down.
const serviceHealthcheck = asyncHandler(async (req, res) => {
    const checks = await Promise.all([
        runCheck("mongodb", checkMongo),
        runCheck("minio", checkMinio),
        runCheck("openai", checkOpenAI),
        runCheck("microsoftGraph", checkGraph),
    ]);

    const healthy = checks.every((check) => check.status === "ok");
    const statusCode = healthy ? 200 : 503;

    return res.status(statusCode).json(
        new ApiResponse(
            statusCode,
            healthy ? "All services are healthy" : "One or more services are unhealthy",
            { status: healthy ? "ok" : "degraded", checks }
        )
    );
});

export { healthcheck, serviceHealthcheck };
