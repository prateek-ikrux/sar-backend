import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import CandidateTag from "../models/candidateTag.model.js";
import { getProfilesCollection } from "../db/index.js";
import { getDownloadUrl, objectExists } from "../utils/minio.js";
import { idForms } from "../utils/profileId.js";
import { recordActivity, tagsFor } from "../services/activity.service.js";
import { ACTIVITY, RESUME_DOWNLOAD_URL_EXPIRY_SECONDS } from "../constants.js";

// Everything here acts on one candidate from the library, and each action is
// recorded so other recruiters can see the candidate is being worked on.

const candidateNotFound = () =>
    new ApiError(404, "Candidate not found", ["They may have been removed from the library"]);

const findProfile = async (profileId, projection) => {
    const profile = await getProfilesCollection().findOne({ _id: { $in: idForms(profileId) } }, { projection });
    if (!profile) throw candidateNotFound();
    return profile;
};

/** Search results carry no contact details; this hands over one candidate's. */
const revealContact = asyncHandler(async (req, res) => {
    const { profileId } = req.validated.params;
    const profile = await findProfile(profileId, { email: 1, phone: 1 });

    await recordActivity({ userId: req.user._id, type: ACTIVITY.CONTACT_VIEW, profileIds: [profileId] });

    return res.status(200).json(
        new ApiResponse(200, "Contact details", {
            profileId,
            email: profile.email ?? null,
            phone: profile.phone ?? null,
        })
    );
});

/**
 * The resume opens straight from file storage through the link the search
 * gave, which the server never sees; the page reports the open here.
 */
const recordResumeView = asyncHandler(async (req, res) => {
    const { profileId } = req.validated.params;
    await recordActivity({ userId: req.user._id, type: ACTIVITY.RESUME_VIEW, profileIds: [profileId] });
    return res.status(200).json(new ApiResponse(200, "Recorded", { profileId }));
});

/** A short-lived link that saves the resume rather than opening it. */
const resumeDownload = asyncHandler(async (req, res) => {
    const { profileId } = req.validated.params;
    const profile = await findProfile(profileId, { file_name: 1 });

    if (!profile.file_name || !(await objectExists(profile.file_name))) {
        throw new ApiError(404, "Resume not found", ["There is no resume file for this candidate"]);
    }

    const url = await getDownloadUrl(profile.file_name, RESUME_DOWNLOAD_URL_EXPIRY_SECONDS);
    await recordActivity({ userId: req.user._id, type: ACTIVITY.RESUME_DOWNLOAD, profileIds: [profileId] });

    return res.status(200).json(new ApiResponse(200, "Download link", { profileId, url }));
});

/** Sets the caller's tag on a candidate; answers with everyone's tags. */
const setTag = asyncHandler(async (req, res) => {
    const { profileId } = req.validated.params;
    const { tag, note } = req.validated.body;
    await findProfile(profileId, { _id: 1 });

    await CandidateTag.findOneAndUpdate(
        { profile_id: profileId, user_id: req.user._id },
        { tag, note },
        { upsert: true, setDefaultsOnInsert: true }
    );
    await recordActivity({ userId: req.user._id, type: ACTIVITY.TAG, profileIds: [profileId], meta: { tag } });

    return res
        .status(200)
        .json(new ApiResponse(200, "Tag saved", { profileId, tags: await tagsFor({ userId: req.user._id, profileId }) }));
});

/** Clears the caller's tag. Clearing one that isn't there is not an error. */
const clearTag = asyncHandler(async (req, res) => {
    const { profileId } = req.validated.params;
    const { deletedCount } = await CandidateTag.deleteOne({ profile_id: profileId, user_id: req.user._id });

    if (deletedCount) {
        await recordActivity({
            userId: req.user._id,
            type: ACTIVITY.TAG,
            profileIds: [profileId],
            meta: { tag: null },
        });
    }

    return res
        .status(200)
        .json(new ApiResponse(200, "Tag cleared", { profileId, tags: await tagsFor({ userId: req.user._id, profileId }) }));
});

/**
 * Contact details for a spreadsheet, which takes them off the platform, so
 * the export is recorded against every candidate in it. Rows come back in the
 * order asked for; a candidate gone from the library comes back empty.
 */
const exportCandidates = asyncHandler(async (req, res) => {
    const { profileIds, source, query } = req.validated.body;
    const ids = [...new Set(profileIds)];

    const found = await getProfilesCollection()
        .find({ _id: { $in: ids.flatMap(idForms) } }, { projection: { email: 1, phone: 1 } })
        .toArray();
    const byId = new Map(found.map((profile) => [profile._id.toString(), profile]));

    await recordActivity({
        userId: req.user._id,
        type: ACTIVITY.EXPORT,
        profileIds: ids,
        query,
        meta: { source, count: ids.length },
    });

    return res.status(200).json(
        new ApiResponse(200, "Export ready", {
            rows: ids.map((profileId) => ({
                profileId,
                email: byId.get(profileId)?.email ?? null,
                phone: byId.get(profileId)?.phone ?? null,
            })),
        })
    );
});

export { revealContact, recordResumeView, resumeDownload, setTag, clearTag, exportCandidates };
