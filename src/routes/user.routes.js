import { Router } from "express";
import { listUsers, getUser, createUser, updateUser, deleteUser } from "../controllers/user.controller.js";
import { activitySummary, activitySearches, activityEvents } from "../controllers/activityReport.controller.js";
import { verifyJWT, requireRole } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
    createUserSchema,
    updateUserSchema,
    userIdParamSchema,
    listUsersQuerySchema,
    activitySummaryQuerySchema,
    activitySearchesQuerySchema,
    activityEventsQuerySchema,
} from "../validators/user.validator.js";
import { ROLES } from "../constants.js";

const router = Router();

router.use("/users", verifyJWT, requireRole(ROLES.ADMIN));

router.route("/users/list").get(validate({ query: listUsersQuerySchema }), listUsers);
router.route("/users/create").post(validate({ body: createUserSchema }), createUser);
router.route("/users/get/:id").get(validate({ params: userIdParamSchema }), getUser);
router
    .route("/users/update/:id")
    .put(validate({ params: userIdParamSchema, body: updateUserSchema }), updateUser);
router.route("/users/delete/:id").delete(validate({ params: userIdParamSchema }), deleteUser);
router
    .route("/users/activity/:id/summary")
    .get(validate({ params: userIdParamSchema, query: activitySummaryQuerySchema }), activitySummary);
router
    .route("/users/activity/:id/searches")
    .get(validate({ params: userIdParamSchema, query: activitySearchesQuerySchema }), activitySearches);
router
    .route("/users/activity/:id/events")
    .get(validate({ params: userIdParamSchema, query: activityEventsQuerySchema }), activityEvents);

export default router;
