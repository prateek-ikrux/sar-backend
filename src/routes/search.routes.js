import { Router } from "express";
import {
    searchProfilesController,
    askProfilesController,
    askStreamController,
    endConversationController,
} from "../controllers/search.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
    searchProfilesSchema,
    askProfilesSchema,
    endConversationSchema,
} from "../validators/search.validator.js";

const router = Router();

router.use("/search", verifyJWT);

router
    .route("/search/profiles")
    .post(validate({ body: searchProfilesSchema }), searchProfilesController);
router.route("/search/ask").post(validate({ body: askProfilesSchema }), askProfilesController);
router.route("/search/ask/stream").post(validate({ body: askProfilesSchema }), askStreamController);
router
    .route("/search/conversations/end")
    .post(validate({ body: endConversationSchema }), endConversationController);

export default router;
