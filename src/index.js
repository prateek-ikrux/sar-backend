import dotenv from "dotenv";
import connectDB from "./db/index.js";
import app from "./app.js"; 

dotenv.config({
    path: "./.env"
});

connectDB()
.then(() => {
    app.on("error", (err) => {
        console.error("Error starting the server:", err);
        throw err;
    });

    app.listen(process.env.PORT || 8000, () => {
        console.log(`Server is running on port ${process.env.PORT}`);
    });
})
.catch((err) => {
    console.error("Error connecting to the database:", err);
    throw err;
});