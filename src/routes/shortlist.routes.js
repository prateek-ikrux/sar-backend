import { Router } from "express";
import {
    listShortlist,
    addToShortlist,
    updateShortlistNote,
    removeFromShortlist,
} from "../controllers/shortlist.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
    addToShortlistSchema,
    shortlistNoteSchema,
    profileIdParamSchema,
} from "../validators/shortlist.validator.js";

const router = Router();

// Every user has their own list; every route acts on the caller's list only.
router.use("/shortlist", verifyJWT);

router.route("/shortlist/list").get(listShortlist);
router.route("/shortlist/add").post(validate({ body: addToShortlistSchema }), addToShortlist);
router
    .route("/shortlist/note/:profileId")
    .put(validate({ params: profileIdParamSchema, body: shortlistNoteSchema }), updateShortlistNote);
router
    .route("/shortlist/remove/:profileId")
    .delete(validate({ params: profileIdParamSchema }), removeFromShortlist);

export default router;
