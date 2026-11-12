import mongoose from "mongoose";
import ActivityEvent from "../models/activity.model.js";
import CandidateTag from "../models/candidateTag.model.js";
import User from "../models/user.model.js";
import logger from "../utils/logger.js";
import { requestLog, track } from "../utils/requestStats.js";
import {
    ACTIVITY,
    ENGAGED_ACTIVITY,
    ACTIVITY_TEXT_RETENTION_DAYS,
    ACTIVITY_TEXT_PURGE_INTERVAL_MS,
    TEAM_ACTIVITY_WINDOW_DAYS,
    TEAM_ACTIVITY_NAMES_MAX,
} from "../constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

const asObjectId = (id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));

// Shown for activity by someone whose account has since been removed.
const FORMER_USER = "A former recruiter";

// Mongoose would queue a query until the database came back, holding the
// request for up to 10 seconds. Activity is never worth that wait.
const connected = () => mongoose.connection.readyState === 1;

/**
 * Records one thing a recruiter did. Never throws: losing an event is better
 * than failing the search or download it describes.
 */
const recordActivity = async ({ userId, type, profileIds, query, meta }) => {
    if (!connected()) {
        track("activity", { skipped: 1 });
        return;
    }
    try {
        await ActivityEvent.create({
            user_id: asObjectId(userId),
            type,
            profile_ids: profileIds?.length ? profileIds.map(String) : undefined,
            query: query || undefined,
            meta,
        });
        track("activity", { recorded: 1 });
    } catch (error) {
        requestLog().warn({ err: error, type }, "activity not recorded");
    }
};

const namesOf = async (userIds) => {
    const unique = [...new Set(userIds.map(String))];
    if (!unique.length) return new Map();
    const users = await User.find({ _id: { $in: unique.map(asObjectId) } }, { name: 1 }).lean();
    return new Map(users.map((user) => [user._id.toString(), user.name]));
};

const toTag = (tag, me, names) => ({
    tag: tag.tag,
    note: tag.note,
    name: names.get(tag.user_id.toString()) ?? FORMER_USER,
    mine: tag.user_id.toString() === me,
    at: tag.updated_at,
});

/** Every recruiter's current tag on one candidate, newest first. */
const tagsFor = async ({ userId, profileId }) => {
    const tags = await CandidateTag.find({ profile_id: profileId }).sort({ updated_at: -1 }).lean();
    const names = await namesOf(tags.map((tag) => tag.user_id));
    return tags.map((tag) => toTag(tag, String(userId), names));
};

const emptyTeam = () => ({ others: [], otherCount: 0, seenBy: 0, mine: null, tags: [] });

/**
 * What recruiters have done with each of these candidates, for the search
 * cards: per other recruiter, their latest engaged action in the window;
 * how many others only saw the candidate in their results; the caller's own
 * latest action; and everyone's current tag. A Map of profile id to summary.
 */
const teamActivityFor = async ({ userId, profileIds }) => {
    const ids = [...new Set(profileIds.map(String))];
    const result = new Map(ids.map((id) => [id, emptyTeam()]));
    if (!ids.length || !connected()) return result;

    const me = String(userId);
    const [rows, tags] = await Promise.all([
        ActivityEvent.aggregate([
            {
                $match: {
                    profile_ids: { $in: ids },
                    at: { $gte: daysAgo(TEAM_ACTIVITY_WINDOW_DAYS) },
                    type: { $in: [ACTIVITY.SEARCH_RESULTS, ...ENGAGED_ACTIVITY] },
                },
            },
            { $project: { user_id: 1, type: 1, at: 1, profile_ids: 1 } },
            { $unwind: "$profile_ids" },
            { $match: { profile_ids: { $in: ids } } },
            { $sort: { at: -1 } },
            {
                $group: {
                    _id: {
                        profile: "$profile_ids",
                        user: "$user_id",
                        engaged: { $ne: ["$type", ACTIVITY.SEARCH_RESULTS] },
                    },
                    type: { $first: "$type" },
                    at: { $first: "$at" },
                },
            },
        ]),
        CandidateTag.find({ profile_id: { $in: ids } }).sort({ updated_at: -1 }).lean(),
    ]);

    const names = await namesOf([...rows.map((row) => row._id.user), ...tags.map((tag) => tag.user_id)]);

    const engagedOthers = new Map();
    const seenOthers = new Map();

    for (const row of rows) {
        const profile = row._id.profile;
        const user = row._id.user.toString();
        const summary = result.get(profile);
        if (!summary) continue;

        if (user === me) {
            if (row._id.engaged) summary.mine = { action: row.type, at: row.at };
            continue;
        }

        const bucket = row._id.engaged ? engagedOthers : seenOthers;
        if (!bucket.has(profile)) bucket.set(profile, []);
        bucket.get(profile).push({ user, action: row.type, at: row.at });
    }

    for (const [profile, entries] of engagedOthers) {
        const summary = result.get(profile);
        entries.sort((a, b) => b.at - a.at);
        summary.otherCount = entries.length;
        summary.others = entries.slice(0, TEAM_ACTIVITY_NAMES_MAX).map((entry) => ({
            name: names.get(entry.user) ?? FORMER_USER,
            action: entry.action,
            at: entry.at,
        }));
    }

    for (const [profile, entries] of seenOthers) {
        result.get(profile).seenBy = entries.length;
    }

    for (const tag of tags) {
        result.get(tag.profile_id)?.tags.push(toTag(tag, me, names));
    }

    return result;
};

/**
 * The candidates a search should leave out: those the caller worked on
 * (hideMine), those other recruiters worked on (hideTeam), within the window.
 * Null when neither is asked for.
 */
const excludedProfileIds = async ({ userId, hideMine, hideTeam }) => {
    if ((!hideMine && !hideTeam) || !connected()) return null;

    const me = asObjectId(userId);
    const who = hideMine && hideTeam ? {} : hideMine ? { user_id: me } : { user_id: { $ne: me } };

    const ids = await ActivityEvent.distinct("profile_ids", {
        ...who,
        type: { $in: ENGAGED_ACTIVITY },
        at: { $gte: daysAgo(TEAM_ACTIVITY_WINDOW_DAYS) },
    });

    return new Set(ids.map(String));
};

/** Drops typed text from events older than the text retention period. */
const purgeOldActivityText = async () => {
    const { modifiedCount } = await ActivityEvent.updateMany(
        { at: { $lt: daysAgo(ACTIVITY_TEXT_RETENTION_DAYS) }, query: { $exists: true } },
        { $unset: { query: "" } }
    );
    if (modifiedCount) logger.info({ events: modifiedCount }, "old activity text removed");
    return modifiedCount;
};

/**
 * Runs the text purge now and every few hours. Whole events expire through
 * the TTL index on `at`; MongoDB has no TTL for a single field.
 */
const startActivityRetention = () => {
    const run = () =>
        purgeOldActivityText().catch((error) => logger.error({ err: error }, "activity text purge failed"));
    void run();
    setInterval(run, ACTIVITY_TEXT_PURGE_INTERVAL_MS).unref();
};

export {
    recordActivity,
    teamActivityFor,
    tagsFor,
    excludedProfileIds,
    purgeOldActivityText,
    startActivityRetention,
};
