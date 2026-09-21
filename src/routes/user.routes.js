import { Router } from "express";
import { getUser, createUser, updateUser, deleteUser } from "../controllers/user.controller.js";

const router = Router();

router.route("/users/create").post(createUser);
router.route("/users/get/:id").get(getUser);
router.route("/users/update/:id").put(updateUser);
router.route("/users/delete/:id").delete(deleteUser);

export default router;
