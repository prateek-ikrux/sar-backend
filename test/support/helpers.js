import { once } from "node:events";

// A complete, valid environment. Nothing here reaches a real service: tests
// that need MongoDB start their own, and nothing calls MinIO, Graph or OpenAI.
const TEST_ENV = {
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://127.0.0.1:1/unused",
    SEARCH_AND_RETRIEVAL_DB_NAME: "sar_test",
    ATS_DB_NAME: "ats_test",
    PROFILES_COLLECTION: "profiles",
    CORS_ORIGIN: "http://localhost:5173,http://localhost:3000",
    ACCESS_TOKEN_SECRET: "test-secret-that-is-at-least-32-characters-long",
    ACCESS_TOKEN_EXPIRY: "1h",
    MINIO_ENDPOINT: "127.0.0.1",
    MINIO_ACCESS_KEY: "test",
    MINIO_SECRET_KEY: "test",
    MINIO_BUCKET: "resumes",
    MINIO_PREFIX: "resumes",
    GRAPH_TENANT_ID: "test",
    GRAPH_CLIENT_ID: "test",
    GRAPH_CLIENT_SECRET: "test",
    GRAPH_SENDER: "noreply@ikrux.com",
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "test",
};

// Call before importing app code: some modules read env when they load.
const applyTestEnv = (overrides = {}) => Object.assign(process.env, TEST_ENV, overrides);

// Serves the app on a free port for fetch-based tests.
const serve = async (app) => {
    const server = app.listen(0);
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;

    const request = async (method, path, { token, body, headers = {} } = {}) => {
        const response = await fetch(base + path, {
            method,
            headers: {
                ...(body ? { "content-type": "application/json" } : {}),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        return {
            status: response.status,
            headers: response.headers,
            body: await response.json().catch(() => null),
        };
    };

    const close = () => new Promise((resolve) => server.close(resolve));

    return { base, request, close };
};

export { TEST_ENV, applyTestEnv, serve };
