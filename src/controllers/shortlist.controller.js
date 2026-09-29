import mongoose from "mongoose";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import ShortlistItem from "../models/shortlist.model.js";
import { getProfilesCollection } from "../db/index.js";
import { getResumeUrl } from "../utils/minio.js";
import { findCandidateName } from "../services/candidateName.js";
import { EXISTENCE_BATCH, SHORTLIST_MAX_ITEMS } from "../constants.js";

// Search results stringify profile ids, so a saved id is matched in both
// forms: as an ObjectId (what the ATS stores in practice) and as given.
const idForms = (id) =>
    /^[0-9a-f]{24}$/i.test(id) ? [new mongoose.Types.ObjectId(id), id] : [id];

const CONTACT = { file_name: 1, email: 1, phone: 1 };

// Live contact details win over the saved snapshot; `missing` says the
// profile has left the library and only the snapshot is left.
const toClient = (item, live, resumeUrl) => ({
    profileId: item.profile_id,
    fileName: live?.file_name ?? item.file_name,
    email: live?.email ?? item.email,
    phone: live?.phone ?? item.phone,
    summary: { name: item.name ?? null },
    query: item.query,
    note: item.note,
    savedAt: item.created_at,
    resumeUrl,
    missing: !live,
});

const listShortlist = asyncHandler(async (req, res) => {
    const items = await ShortlistItem.find({ user_id: req.user._id })
        .sort({ created_at: -1, _id: -1 })
        .lean();

    const ids = items.flatMap((item) => idForms(item.profile_id));
    const live = ids.length
        ? await getProfilesCollection().find({ _id: { $in: ids } }, { projection: CONTACT }).toArray()
        : [];
    const byId = new Map(live.map((profile) => [profile._id.toString(), profile]));

    // Resume links are signed fresh on every load, so none on the list has
    // expired. Batched, like the existence checks in search.
    const result = [];
    for (let start = 0; start < items.length; start += EXISTENCE_BATCH) {
        const batch = items.slice(start, start + EXISTENCE_BATCH);
        result.push(
            ...(await Promise.all(
                batch.map(async (item) => {
                    const profile = byId.get(item.profile_id);
                    return toClient(item, profile, profile ? await getResumeUrl(profile.file_name) : null);
                })
            ))
        );
    }

    return res.status(200).json(new ApiResponse(200, "Shortlist fetched", { items: result }));
});

const addToShortlist = asyncHandler(async (req, res) => {
    const { profileId, query = "", note = "" } = req.validated.body;
    const userId = req.user._id;

    const profile = await getProfilesCollection().findOne(
        { _id: { $in: idForms(profileId) } },
        { projection: { ...CONTACT, document: 1 } }
    );

    if (!profile) {
        throw new ApiError(404, "Candidate not found", ["They may have been removed from the library"]);
    }

    // Saving again is not an error: the button may simply have been pressed twice.
    let item = await ShortlistItem.findOne({ user_id: userId, profile_id: profileId }).lean();

    if (!item) {
        if ((await ShortlistItem.countDocuments({ user_id: userId })) >= SHORTLIST_MAX_ITEMS) {
            throw new ApiError(409, "Your shortlist is full", [
                `It holds up to ${SHORTLIST_MAX_ITEMS} candidates. Remove some to save more.`,
            ]);
        }

        try {
            item = (
                await ShortlistItem.create({
                    user_id: userId,
                    profile_id: profileId,
                    file_name: profile.file_name ?? null,
                    email: profile.email ?? null,
                    phone: profile.phone ?? null,
                    name: findCandidateName(profile.document, profile.email),
                    query,
                    note,
                })
            ).toObject();
        } catch (error) {
            // Two saves raced; the other one won, which is the same outcome.
            if (error.code !== 11000) throw error;
            item = await ShortlistItem.findOne({ user_id: userId, profile_id: profileId }).lean();
        }
    }

    return res
        .status(201)
        .json(new ApiResponse(201, "Saved to shortlist", toClient(item, profile, await getResumeUrl(profile.file_name))));
});

const updateShortlistNote = asyncHandler(async (req, res) => {
    const item = await ShortlistItem.findOneAndUpdate(
        { user_id: req.user._id, profile_id: req.validated.params.profileId },
        { note: req.validated.body.note },
        { returnDocument: "after" }
    ).lean();

    if (!item) {
        throw new ApiError(404, "Not on your shortlist");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, "Note saved", { profileId: item.profile_id, note: item.note }));
});

const removeFromShortlist = asyncHandler(async (req, res) => {
    const { profileId } = req.validated.params;
    const { deletedCount } = await ShortlistItem.deleteOne({ user_id: req.user._id, profile_id: profileId });

    if (!deletedCount) {
        throw new ApiError(404, "Not on your shortlist");
    }

    return res.status(200).json(new ApiResponse(200, "Removed from shortlist", { profileId }));
});

export { listShortlist, addToShortlist, updateShortlistNote, removeFromShortlist };
