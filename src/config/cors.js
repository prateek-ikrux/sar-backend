// CORS_ORIGIN is a comma-separated list, so dev (Vite on 5173) and the served
// build (3000) can both be allowed, e.g.
//   CORS_ORIGIN=http://localhost:5173,http://localhost:3000
// "*" anywhere in the list allows every origin.
const parseCorsOrigins = (value = "") => {
    const origins = value
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean);

    return origins.includes("*") ? "*" : origins;
};

// No credentials: the frontend authenticates with a bearer header and never
// sends cookies. Allowing them alongside "*" is also something browsers reject.
const corsOptions = () => ({
    origin: parseCorsOrigins(process.env.CORS_ORIGIN),
});

export { parseCorsOrigins, corsOptions };
