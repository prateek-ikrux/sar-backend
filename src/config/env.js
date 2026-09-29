import { z } from "zod";

const required = z.string({ error: "is required" }).trim().min(1, { error: "is required" });

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"], {
        error: "must be development, production or test",
    }).optional(),
    PORT: z.string().regex(/^\d{1,5}$/, { error: "must be a port number" }).optional(),
    TRUST_PROXY: z.string().optional(),
    HEALTHCHECK_TIMEOUT_MS: z.string().regex(/^\d+$/, { error: "must be a whole number of ms" }).optional(),

    MONGODB_URI: required.regex(/^mongodb(\+srv)?:\/\//, {
        error: "must start with mongodb:// or mongodb+srv://",
    }),
    SEARCH_AND_RETRIEVAL_DB_NAME: required,
    ATS_DB_NAME: required,
    PROFILES_COLLECTION: required,

    CORS_ORIGIN: required.refine(
        (value) =>
            value
                .split(",")
                .map((origin) => origin.trim().replace(/\/+$/, ""))
                .filter(Boolean)
                .every((origin) => origin === "*" || /^https?:\/\/[^/\s]+$/.test(origin)),
        { error: 'must be "*" or comma-separated origins like http://localhost:5173' }
    ),

    ACCESS_TOKEN_SECRET: required.min(32, { error: "must be at least 32 characters" }),
    // Seconds ("3600") or a timespan jsonwebtoken understands ("1d", "12h").
    ACCESS_TOKEN_EXPIRY: required.regex(/^\d+(\.\d+)?\s*[a-z]*$/i, {
        error: 'must be seconds or a timespan like "1d"',
    }),

    MINIO_ENDPOINT: required,
    MINIO_ACCESS_KEY: required,
    MINIO_SECRET_KEY: required,
    MINIO_BUCKET: required,
    MINIO_PREFIX: required,
    MINIO_USE_SSL: z.enum(["true", "false"], { error: "must be true or false" }).optional(),

    GRAPH_TENANT_ID: required,
    GRAPH_CLIENT_ID: required,
    GRAPH_CLIENT_SECRET: required,
    GRAPH_SENDER: required.pipe(z.email({ error: "must be an email address" })),

    // Where the frontend lives, for the sign-in links in emails. Emails go out
    // without a link when it is unset.
    APP_URL: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),

    OPENAI_API_KEY: required,
    OPENAI_MODEL: required,
});

// Fails fast at boot with every problem listed, instead of surfacing a missing
// key as a 500 on whichever request first needs it. Values are never printed,
// since most of them are secrets.
// One "KEY: problem" line per issue; empty when the environment is usable.
const findEnvProblems = (source = process.env) => {
    // `KEY=` in an env file arrives as "", which should read as unset.
    const env = Object.fromEntries(
        Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value])
    );

    const result = envSchema.safeParse(env);

    return result.success
        ? []
        : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

const validateEnv = () => {
    const problems = findEnvProblems();

    if (problems.length) {
        console.error(`Invalid environment configuration:\n${problems.map((p) => `  ${p}`).join("\n")}`);
        process.exit(1);
    }
};

export { findEnvProblems, validateEnv };
