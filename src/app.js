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

import userRouter from "./routes/user.controller.js";
import healthRouter from "./routes/health.controller.js";

app.use("/api/v1", userRouter);
app.use("/api/v1", healthRouter);

export default app;