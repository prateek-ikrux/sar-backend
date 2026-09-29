import express from "express";
import cors from "cors";
import helmet from "helmet";
import { corsOptions } from "./config/cors.js";
import { requestLogger } from "./middlewares/requestLogger.middleware.js";

const app = express();

// First, so every request gets an id and a log line, including those that
// fail in the middleware below.
app.use(requestLogger);

// Standard security headers (nosniff, no framing, HSTS, no X-Powered-By).
app.use(helmet());

// Only set when a reverse proxy sits in front: a hop count ("1") or an Express
// trust value ("loopback"). Trusting X-Forwarded-For without a proxy would let
// clients pick their own IP and step around the rate limits.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
    app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

app.use(cors(corsOptions()));
app.use(express.json ({
    limit: "16kb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "16kb"
}));

import userRouter from "./routes/user.routes.js";
import authRouter from "./routes/auth.routes.js";
import healthRouter from "./routes/healthcheck.routes.js";
import searchRouter from "./routes/search.routes.js";
import shortlistRouter from "./routes/shortlist.routes.js";

app.use("/api/v1", userRouter);
app.use("/api/v1", authRouter);
app.use("/api/v1", healthRouter);
app.use("/api/v1", searchRouter);
app.use("/api/v1", shortlistRouter);

import { notFound, errorHandler } from "./middlewares/error.middleware.js";

app.use(notFound);
app.use(errorHandler);

export default app;