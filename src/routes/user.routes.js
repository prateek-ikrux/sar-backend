import { Router } from "express";
import { listUsers, getUser, createUser, updateUser, deleteUser } from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use("/users", verifyJWT);

router.route("/users/list").get(listUsers);
router.route("/users/create").post(createUser);
router.route("/users/get/:id").get(getUser);
router.route("/users/update/:id").put(updateUser);
router.route("/users/delete/:id").delete(deleteUser);

export default router;
