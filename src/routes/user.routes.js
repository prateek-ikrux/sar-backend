import { Router } from "express";
import { listUsers, getUser, createUser, updateUser, deleteUser } from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
    createUserSchema,
    updateUserSchema,
    userIdParamSchema,
    listUsersQuerySchema,
} from "../validators/user.validator.js";

const router = Router();

router.use("/users", verifyJWT);

router.route("/users/list").get(validate({ query: listUsersQuerySchema }), listUsers);
router.route("/users/create").post(validate({ body: createUserSchema }), createUser);
router.route("/users/get/:id").get(validate({ params: userIdParamSchema }), getUser);
router
    .route("/users/update/:id")
    .put(validate({ params: userIdParamSchema, body: updateUserSchema }), updateUser);
router.route("/users/delete/:id").delete(validate({ params: userIdParamSchema }), deleteUser);

export default router;
