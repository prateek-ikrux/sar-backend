import { Router } from "express";
import {
    revealContact,
    recordResumeView,
    resumeDownload,
    setTag,
    clearTag,
    exportCandidates,
} from "../controllers/candidate.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { profileIdParamSchema, setTagSchema, exportSchema } from "../validators/candidate.validator.js";

const router = Router();

router.use("/candidates", verifyJWT);

const byId = validate({ params: profileIdParamSchema });

router.route("/candidates/export").post(validate({ body: exportSchema }), exportCandidates);
router.route("/candidates/:profileId/contact").post(byId, revealContact);
router.route("/candidates/:profileId/resume/view").post(byId, recordResumeView);
router.route("/candidates/:profileId/resume/download").post(byId, resumeDownload);
router
    .route("/candidates/:profileId/tag")
    .put(validate({ params: profileIdParamSchema, body: setTagSchema }), setTag)
    .delete(byId, clearTag);

export default router;
