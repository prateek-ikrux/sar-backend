import { Router } from "express";
import { getUser, createUser, updateUser, deleteUser } from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.route("/users/:id").get(getUser);
router.route("/users").post(createUser);
router.route("/users/:id").put(updateUser);
router.route("/users/:id").delete(deleteUser);

export default router;