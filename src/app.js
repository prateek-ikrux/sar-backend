import express from "express";
import cors from "cors";

const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));
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

app.use("/api/v1", userRouter);
app.use("/api/v1", authRouter);
app.use("/api/v1", healthRouter);


export default app;