import ActivityEvent from "../models/activity.model.js";
import UsageSession from "../models/usageSession.model.js";
import User from "../models/user.model.js";
import { getProfilesCollection } from "../db/index.js";
import { idForms } from "../utils/profileId.js";
import { browserOf } from "../utils/userAgent.js";
import { labelOf } from "./activityReport.service.js";
import {
    ACTIVITY,
    ENGAGED_ACTIVITY,
    ROLES,
    FLAG_RESUMES_PER_HOUR,
    FLAG_CONTACTS_PER_HOUR,
    FLAG_EXPORTED_PER_DAY,
    FLAG_FAILED_LOGINS_PER_DAY,
    FLAG_NIGHT_ACTIONS_PER_DAY,
    NIGHT_START_HOUR,
    NIGHT_END_HOUR,
    NEW_LOCATION_LOOKBACK_DAYS,
} from "../constants.js";

// The whole team at once, for admins: who uses the platform and how much,
// where two recruiters worked the same candidate, and anything unusual.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days, from = Date.now()) => new Date(from - days * DAY_MS);

const FORMER_USER = "A former user";

// Candidates more than one recruiter worked on, listed by name on the page.
const SHARED_CANDIDATES_SHOWN = 10;

/** Counts of one action per user per time bucket, kept where they reach `min`. */
const bursts = ({ from, tz, types, unit, min, userId, sumField }) =>
    ActivityEvent.aggregate([
        { $match: { type: { $in: types }, at: { $gte: from }, ...(userId ? { user_id: userId } : {}) } },
        {
            $group: {
                _id: { user: "$user_id", bucket: { $dateTrunc: { date: "$at", unit, timezone: tz } } },
                count: { $sum: sumField ? { $ifNull: [sumField, 0] } : 1 },
            },
        },
        { $match: { count: { $gte: min } } },
        { $sort: { "_id.bucket": -1 } },
    ]);

/**
 * Sign-ins from an IP address or a browser the user hadn't used in the
 * NEW_LOCATION_LOOKBACK_DAYS before. A first-ever sign-in isn't flagged:
 * everything is new then.
 */
const newLocations = async ({ from, userId }) => {
    const logins = await ActivityEvent.find(
        {
            type: ACTIVITY.LOGIN,
            at: { $gte: daysAgo(NEW_LOCATION_LOOKBACK_DAYS, from.getTime()) },
            ...(userId ? { user_id: userId } : {}),
        },
        { user_id: 1, at: 1, meta: 1 }
    )
        .sort({ at: 1 })
        .lean();

    const seen = new Map();
    const flags = [];

    for (const login of logins) {
        const user = login.user_id.toString();
        if (!seen.has(user)) seen.set(user, { ips: new Map(), browsers: new Map() });
        const history = seen.get(user);
        const ip = login.meta?.ip ?? null;
        const browser = browserOf(login.meta?.userAgent);
        const since = daysAgo(NEW_LOCATION_LOOKBACK_DAYS, login.at.getTime());
        const known = (map, key) => map.has(key) && map.get(key) >= since;
        const hasHistory = [...history.ips.values()].some((at) => at >= since);

        if (login.at >= from && hasHistory) {
            if (ip && !known(history.ips, ip)) flags.push({ kind: "new_ip", user, at: login.at, ip, browser });
            if (browser && !known(history.browsers, browser)) {
                flags.push({ kind: "new_browser", user, at: login.at, ip, browser });
            }
        }
        if (ip) history.ips.set(ip, login.at);
        if (browser) history.browsers.set(browser, login.at);
    }

    return flags;
};

/**
 * Unusual activity since `from`, newest first: bursts of resume opens or
 * contact views in an hour, big exports or several failed sign-ins in a day,
 * work at night (local time in `tz`), and sign-ins from somewhere new.
 * `userId` narrows it to one user.
 */
const flagsFor = async ({ from, tz, userId }) => {
    const [resumes, contacts, exports, failed, night, locations] = await Promise.all([
        bursts({
            from,
            tz,
            userId,
            types: [ACTIVITY.RESUME_VIEW, ACTIVITY.RESUME_DOWNLOAD],
            unit: "hour",
            min: FLAG_RESUMES_PER_HOUR,
        }),
        bursts({ from, tz, userId, types: [ACTIVITY.CONTACT_VIEW], unit: "hour", min: FLAG_CONTACTS_PER_HOUR }),
        bursts({
            from,
            tz,
            userId,
            types: [ACTIVITY.EXPORT],
            unit: "day",
            min: FLAG_EXPORTED_PER_DAY,
            sumField: "$meta.count",
        }),
        bursts({ from, tz, userId, types: [ACTIVITY.LOGIN_FAILED], unit: "day", min: FLAG_FAILED_LOGINS_PER_DAY }),
        ActivityEvent.aggregate([
            {
                $match: {
                    type: { $in: ENGAGED_ACTIVITY },
                    at: { $gte: from },
                    ...(userId ? { user_id: userId } : {}),
                },
            },
            { $addFields: { hour: { $hour: { date: "$at", timezone: tz } } } },
            { $match: { $or: [{ hour: { $gte: NIGHT_START_HOUR } }, { hour: { $lt: NIGHT_END_HOUR } }] } },
            {
                $group: {
                    // Night belongs to the day it began: 01:00 counts with the evening before.
                    _id: {
                        user: "$user_id",
                        bucket: {
                            $dateTrunc: {
                                date: { $dateSubtract: { startDate: "$at", unit: "hour", amount: NIGHT_END_HOUR } },
                                unit: "day",
                                timezone: tz,
                            },
                        },
                    },
                    count: { $sum: 1 },
                },
            },
            { $match: { count: { $gte: FLAG_NIGHT_ACTIONS_PER_DAY } } },
        ]),
        newLocations({ from, userId }),
    ]);

    const asFlag = (kind) => (row) => ({ kind, user: row._id.user.toString(), at: row._id.bucket, count: row.count });
    const flags = [
        ...resumes.map(asFlag("bulk_resumes")),
        ...contacts.map(asFlag("bulk_contacts")),
        ...exports.map(asFlag("bulk_export")),
        ...failed.map(asFlag("failed_logins")),
        ...night.map(asFlag("night_activity")),
        ...locations,
    ].sort((a, b) => b.at - a.at);

    const users = await User.find({ _id: { $in: [...new Set(flags.map((f) => f.user))] } }, { name: 1 }).lean();
    const names = new Map(users.map((user) => [user._id.toString(), user.name]));

    return flags.map(({ user, ...flag }) => ({ ...flag, userId: user, name: names.get(user) ?? FORMER_USER }));
};

/**
 * How often two or more recruiters worked on the same candidate since
 * `from`: the share of all candidates worked on, and the ones it happened to
 * most, with who was involved.
 */
const duplicateEffort = async ({ from, names }) => {
    const [result] = await ActivityEvent.aggregate([
        { $match: { type: { $in: ENGAGED_ACTIVITY }, at: { $gte: from } } },
        { $unwind: "$profile_ids" },
        { $group: { _id: "$profile_ids", users: { $addToSet: "$user_id" }, last: { $max: "$at" } } },
        { $addFields: { recruiters: { $size: "$users" } } },
        {
            $facet: {
                total: [{ $count: "n" }],
                shared: [{ $match: { recruiters: { $gte: 2 } } }, { $count: "n" }],
                top: [
                    { $match: { recruiters: { $gte: 2 } } },
                    { $sort: { recruiters: -1, last: -1 } },
                    { $limit: SHARED_CANDIDATES_SHOWN },
                ],
            },
        },
    ]);

    const candidates = result.total[0]?.n ?? 0;
    const shared = result.shared[0]?.n ?? 0;
    const ids = result.top.map((row) => row._id);
    const profiles = ids.length
        ? await getProfilesCollection()
              .find({ _id: { $in: ids.flatMap(idForms) } }, { projection: { file_name: 1 } })
              .toArray()
        : [];
    const labels = new Map(profiles.map((profile) => [profile._id.toString(), labelOf(profile.file_name)]));

    return {
        candidates,
        shared,
        rate: candidates ? shared / candidates : 0,
        top: result.top.map((row) => ({
            profileId: row._id,
            label: labels.get(row._id) ?? null,
            recruiters: row.users.map((id) => names.get(id.toString()) ?? FORMER_USER).sort(),
            lastAt: row.last,
        })),
    };
};

const emptyRow = () => ({
    activeSeconds: 0,
    activeDays: 0,
    searches: 0,
    questions: 0,
    candidatesWorked: 0,
    resumes: 0,
    contacts: 0,
    shortlisted: 0,
    exportedCandidates: 0,
    lastActiveAt: null,
    flags: 0,
});

/**
 * Everyone's use of the platform over the last `days`: one row per user who
 * did anything, plus every active recruiter who didn't (they're the ones to
 * ask about); team totals; duplicate effort; and flags.
 */
const teamSummary = async ({ days, tz }) => {
    const from = daysAgo(days);
    const users = await User.find({}, { name: 1, email: 1, role: 1, active: 1 }).lean();
    const names = new Map(users.map((user) => [user._id.toString(), user.name]));

    const [counts, worked, activeDays, sessions, flags, duplicates] = await Promise.all([
        ActivityEvent.aggregate([
            { $match: { at: { $gte: from } } },
            {
                $group: {
                    _id: { user: "$user_id", type: "$type" },
                    count: { $sum: 1 },
                    items: { $sum: { $ifNull: ["$meta.count", 0] } },
                    last: { $max: "$at" },
                },
            },
        ]),
        ActivityEvent.aggregate([
            { $match: { type: { $in: ENGAGED_ACTIVITY }, at: { $gte: from } } },
            { $unwind: "$profile_ids" },
            { $group: { _id: { user: "$user_id", profile: "$profile_ids" } } },
            { $group: { _id: "$_id.user", count: { $sum: 1 } } },
        ]),
        ActivityEvent.aggregate([
            { $match: { at: { $gte: from } } },
            {
                $group: {
                    _id: {
                        user: "$user_id",
                        day: { $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: tz } },
                    },
                },
            },
            { $group: { _id: "$_id.user", days: { $sum: 1 } } },
        ]),
        UsageSession.aggregate([
            { $match: { last_seen_at: { $gte: from } } },
            { $group: { _id: "$user_id", seconds: { $sum: "$active_seconds" }, last: { $max: "$last_seen_at" } } },
        ]),
        flagsFor({ from, tz }),
        duplicateEffort({ from, names }),
    ]);

    const rows = new Map();
    const rowOf = (id) => {
        const key = id.toString();
        if (!rows.has(key)) rows.set(key, emptyRow());
        return rows.get(key);
    };
    const touch = (row, at) => {
        if (at && (!row.lastActiveAt || at > row.lastActiveAt)) row.lastActiveAt = at;
    };

    for (const { _id, count, items, last } of counts) {
        const row = rowOf(_id.user);
        touch(row, last);
        switch (_id.type) {
            case ACTIVITY.SEARCH_RESULTS:
                row.searches += count;
                break;
            case ACTIVITY.QUESTION:
                row.questions += count;
                break;
            case ACTIVITY.RESUME_VIEW:
            case ACTIVITY.RESUME_DOWNLOAD:
                row.resumes += count;
                break;
            case ACTIVITY.CONTACT_VIEW:
                row.contacts += count;
                break;
            case ACTIVITY.SHORTLIST_ADD:
                row.shortlisted += count;
                break;
            case ACTIVITY.EXPORT:
                row.exportedCandidates += items;
                break;
        }
    }
    for (const { _id, count } of worked) rowOf(_id).candidatesWorked = count;
    for (const { _id, days: n } of activeDays) rowOf(_id).activeDays = n;
    for (const { _id, seconds, last } of sessions) {
        const row = rowOf(_id);
        row.activeSeconds = seconds;
        touch(row, last);
    }
    for (const flag of flags) rowOf(flag.userId).flags += 1;

    // Active recruiters with nothing to show are listed too.
    for (const user of users) {
        if (user.active && user.role === ROLES.RECRUITER) rowOf(user._id);
    }

    const byId = new Map(users.map((user) => [user._id.toString(), user]));
    const ranking = [...rows.entries()]
        .map(([id, row]) => {
            const user = byId.get(id);
            return {
                user: user
                    ? { _id: id, name: user.name, email: user.email, role: user.role, active: user.active }
                    : { _id: id, name: FORMER_USER, email: null, role: null, active: false },
                ...row,
            };
        })
        // Most candidates worked on first, then time spent.
        .sort((a, b) => b.candidatesWorked - a.candidatesWorked || b.activeSeconds - a.activeSeconds);

    const sum = (pick) => ranking.reduce((total, row) => total + pick(row), 0);

    return {
        range: { days, from, to: new Date(), tz },
        totals: {
            activeUsers: ranking.filter((row) => row.activeDays > 0 || row.activeSeconds > 0).length,
            searches: sum((row) => row.searches),
            candidatesWorked: duplicates.candidates,
            activeSeconds: sum((row) => row.activeSeconds),
        },
        ranking,
        inactive: ranking.filter((row) => row.user.role === ROLES.RECRUITER && !row.lastActiveAt).map((row) => row.user),
        duplicateEffort: duplicates,
        flags,
    };
};

export { teamSummary, flagsFor };
