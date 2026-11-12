import mongoose from "mongoose";
import ActivityEvent from "../models/activity.model.js";
import UsageSession from "../models/usageSession.model.js";
import { getProfilesCollection } from "../db/index.js";
import { idForms } from "../utils/profileId.js";
import { ACTIVITY, ENGAGED_ACTIVITY } from "../constants.js";

// What admins see about a recruiter's use of the platform, built from the
// activity log on request. Nothing here writes.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// Usage on the Users table covers the last week.
const USAGE_DAYS = 7;

const RESUME_ACTIONS = [ACTIVITY.RESUME_VIEW, ACTIVITY.RESUME_DOWNLOAD];

/**
 * Last week's searches, resume opens and contact views, and when each user
 * last did anything at all, for a page of users. A Map of user id to usage.
 */
const usageFor = async (userIds) => {
    const ids = userIds.map(oid);
    const usage = new Map(
        ids.map((id) => [
            id.toString(),
            { lastActiveAt: null, activeSeconds: 0, searches: 0, resumes: 0, contacts: 0 },
        ])
    );
    if (!ids.length) return usage;

    const [counts, latest, time] = await Promise.all([
        ActivityEvent.aggregate([
            { $match: { user_id: { $in: ids }, at: { $gte: daysAgo(USAGE_DAYS) } } },
            { $group: { _id: { user: "$user_id", type: "$type" }, count: { $sum: 1 } } },
        ]),
        // One indexed lookup per user (user_recent) rather than a scan of
        // everyone's year.
        Promise.all(
            ids.map((id) => ActivityEvent.findOne({ user_id: id }, { at: 1, user_id: 1 }).sort({ at: -1 }).lean())
        ),
        UsageSession.aggregate([
            { $match: { user_id: { $in: ids }, last_seen_at: { $gte: daysAgo(USAGE_DAYS) } } },
            {
                $group: {
                    _id: "$user_id",
                    seconds: { $sum: "$active_seconds" },
                    lastSeen: { $max: "$last_seen_at" },
                },
            },
        ]),
    ]);

    for (const { _id, count } of counts) {
        const entry = usage.get(_id.user.toString());
        if (_id.type === ACTIVITY.SEARCH_RESULTS) entry.searches += count;
        else if (RESUME_ACTIONS.includes(_id.type)) entry.resumes += count;
        else if (_id.type === ACTIVITY.CONTACT_VIEW) entry.contacts += count;
    }
    for (const event of latest) {
        if (event) usage.get(event.user_id.toString()).lastActiveAt = event.at;
    }
    // Browsing without acting counts as active too.
    for (const { _id, seconds, lastSeen } of time) {
        const entry = usage.get(_id.toString());
        entry.activeSeconds = seconds;
        if (!entry.lastActiveAt || lastSeen > entry.lastActiveAt) entry.lastActiveAt = lastSeen;
    }

    return usage;
};

/** Every calendar day from `from` to now in `tz`, oldest first, as YYYY-MM-DD. */
const daysIn = (from, tz) => {
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const days = [];
    for (let t = from.getTime(); t <= Date.now(); t += DAY_MS / 2) {
        const day = format.format(new Date(t));
        if (days.at(-1) !== day) days.push(day);
    }
    const today = format.format(new Date());
    if (days.at(-1) !== today) days.push(today);
    return days;
};

const countOf = (facet) => facet[0]?.n ?? 0;

const RECENT_LOGINS = 10;

/**
 * One recruiter over the last `days`: totals of each kind of action, how many
 * distinct candidates they saw and worked on, the days they were active, and
 * a per-day series (in the admin's time zone) for the chart.
 */
const summaryFor = async ({ userId, days, tz }) => {
    const from = daysAgo(days);
    const user = oid(userId);
    const kind = {
        $switch: {
            branches: [
                { case: { $eq: ["$type", ACTIVITY.SEARCH_RESULTS] }, then: "searches" },
                { case: { $eq: ["$type", ACTIVITY.QUESTION] }, then: "questions" },
                { case: { $in: ["$type", ENGAGED_ACTIVITY] }, then: "candidateActions" },
            ],
            default: "other",
        },
    };

    const [[facets], last] = await Promise.all([
        ActivityEvent.aggregate([
            { $match: { user_id: user, at: { $gte: from } } },
            {
                $facet: {
                    byType: [
                        {
                            $group: {
                                _id: "$type",
                                count: { $sum: 1 },
                                items: { $sum: { $ifNull: ["$meta.count", 0] } },
                            },
                        },
                    ],
                    // A cleared tag is recorded too, as tag: null.
                    tagsSet: [{ $match: { type: ACTIVITY.TAG, "meta.tag": { $ne: null } } }, { $count: "n" }],
                    uniqueShown: [
                        { $match: { type: ACTIVITY.SEARCH_RESULTS } },
                        { $unwind: "$profile_ids" },
                        { $group: { _id: "$profile_ids" } },
                        { $count: "n" },
                    ],
                    uniqueWorked: [
                        { $match: { type: { $in: ENGAGED_ACTIVITY } } },
                        { $unwind: "$profile_ids" },
                        { $group: { _id: "$profile_ids" } },
                        { $count: "n" },
                    ],
                    daily: [
                        {
                            $group: {
                                _id: {
                                    day: { $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: tz } },
                                    kind,
                                },
                                count: { $sum: 1 },
                            },
                        },
                    ],
                    recentLogins: [
                        { $match: { type: { $in: [ACTIVITY.LOGIN, ACTIVITY.LOGIN_FAILED] } } },
                        { $sort: { at: -1 } },
                        { $limit: RECENT_LOGINS },
                        { $project: { type: 1, at: 1, meta: 1 } },
                    ],
                },
            },
        ]),
        ActivityEvent.findOne({ user_id: user }, { at: 1 }).sort({ at: -1 }).lean(),
    ]);

    const sessions = await UsageSession.aggregate([
        { $match: { user_id: user, last_seen_at: { $gte: from } } },
        {
            $facet: {
                total: [
                    {
                        $group: {
                            _id: null,
                            seconds: { $sum: "$active_seconds" },
                            count: { $sum: 1 },
                            longest: { $max: "$active_seconds" },
                            lastSeen: { $max: "$last_seen_at" },
                        },
                    },
                ],
                // A session belongs to the day it started.
                daily: [
                    {
                        $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$started_at", timezone: tz } },
                            seconds: { $sum: "$active_seconds" },
                        },
                    },
                ],
            },
        },
    ]);
    const time = sessions[0].total[0] ?? { seconds: 0, count: 0, longest: 0, lastSeen: null };

    const byType = new Map(facets.byType.map((row) => [row._id, row]));
    const count = (type) => byType.get(type)?.count ?? 0;

    const series = new Map(
        daysIn(from, tz).map((day) => [
            day,
            { date: day, searches: 0, questions: 0, candidateActions: 0, activeMinutes: 0 },
        ])
    );
    const active = new Set();
    for (const { _id, count: n } of facets.daily) {
        active.add(_id.day);
        const entry = series.get(_id.day);
        if (entry && _id.kind !== "other") entry[_id.kind] += n;
    }
    for (const { _id, seconds } of sessions[0].daily) {
        const entry = series.get(_id);
        if (entry) entry.activeMinutes = Math.round(seconds / 60);
        if (seconds > 0) active.add(_id);
    }

    const lastActiveAt = [last?.at, time.lastSeen].filter(Boolean).sort((a, b) => b - a)[0] ?? null;

    return {
        range: { days, from, to: new Date(), tz },
        lastActiveAt,
        time: { activeSeconds: time.seconds, sessions: time.count, longestSessionSeconds: time.longest },
        logins: {
            succeeded: count(ACTIVITY.LOGIN),
            failed: count(ACTIVITY.LOGIN_FAILED),
            recent: facets.recentLogins.map((event) => ({
                at: event.at,
                ok: event.type === ACTIVITY.LOGIN,
                ip: event.meta?.ip ?? null,
                userAgent: event.meta?.userAgent ?? null,
                reason: event.meta?.reason ?? null,
            })),
        },
        totals: {
            searches: count(ACTIVITY.SEARCH_RESULTS),
            questions: count(ACTIVITY.QUESTION),
            // Not distinct: a candidate in three searches counts three times.
            profilesShown: byType.get(ACTIVITY.SEARCH_RESULTS)?.items ?? 0,
            uniqueProfilesShown: countOf(facets.uniqueShown),
            contactViews: count(ACTIVITY.CONTACT_VIEW),
            resumeViews: count(ACTIVITY.RESUME_VIEW),
            resumeDownloads: count(ACTIVITY.RESUME_DOWNLOAD),
            shortlisted: count(ACTIVITY.SHORTLIST_ADD),
            tagged: countOf(facets.tagsSet),
            exports: count(ACTIVITY.EXPORT),
            exportedCandidates: byType.get(ACTIVITY.EXPORT)?.items ?? 0,
            uniqueCandidatesWorked: countOf(facets.uniqueWorked),
            activeDays: active.size,
        },
        daily: [...series.values()],
    };
};

const OUTCOME_OF = {
    [ACTIVITY.RESUME_VIEW]: "opened",
    [ACTIVITY.RESUME_DOWNLOAD]: "opened",
    [ACTIVITY.CONTACT_VIEW]: "contacted",
    [ACTIVITY.SHORTLIST_ADD]: "saved",
    [ACTIVITY.TAG]: "tagged",
    [ACTIVITY.EXPORT]: "exported",
};

/**
 * One page of a recruiter's searches, newest first, each with what came of
 * it: how many of its candidates the recruiter then opened, contacted, saved,
 * tagged or exported before their next search. That says which searches led
 * anywhere. The query is null once its text has been removed (90 days).
 */
const searchesFor = async ({ userId, days, page, limit }) => {
    const user = oid(userId);
    const filter = { user_id: user, type: ACTIVITY.SEARCH_RESULTS, at: { $gte: daysAgo(days) } };

    const [items, total] = await Promise.all([
        ActivityEvent.find(filter)
            .sort({ at: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        ActivityEvent.countDocuments(filter),
    ]);

    let rows = [];
    if (items.length) {
        // The newest search on this page ends where the next one (on the
        // page before) began, or now.
        const newer = await ActivityEvent.findOne(
            { user_id: user, type: ACTIVITY.SEARCH_RESULTS, at: { $gt: items[0].at } },
            { at: 1 }
        )
            .sort({ at: 1 })
            .lean();

        const engaged = await ActivityEvent.find(
            {
                user_id: user,
                type: { $in: ENGAGED_ACTIVITY },
                at: { $gte: items.at(-1).at, ...(newer ? { $lt: newer.at } : {}) },
            },
            { type: 1, at: 1, profile_ids: 1 }
        ).lean();

        rows = items.map((item, index) => {
            const end = index === 0 ? (newer?.at ?? new Date()) : items[index - 1].at;
            const shown = new Set(item.profile_ids ?? []);
            const outcome = { opened: new Set(), contacted: new Set(), saved: new Set(), tagged: new Set(), exported: new Set() };
            const worked = new Set();

            for (const event of engaged) {
                if (event.at < item.at || event.at >= end) continue;
                for (const id of event.profile_ids ?? []) {
                    if (!shown.has(id)) continue;
                    outcome[OUTCOME_OF[event.type]].add(id);
                    worked.add(id);
                }
            }

            return {
                id: item._id.toString(),
                at: item.at,
                query: item.query ?? null,
                source: item.meta?.source ?? "search",
                results: item.meta?.count ?? shown.size,
                filters: { hideMine: Boolean(item.meta?.hideMine), hideTeam: Boolean(item.meta?.hideTeam) },
                outcome: {
                    ...Object.fromEntries(Object.entries(outcome).map(([key, set]) => [key, set.size])),
                    worked: worked.size,
                },
            };
        });
    }

    return { items: rows, page, limit, total, pages: Math.ceil(total / limit) };
};

// A timeline entry names its candidates when there are a few; a search or a
// big export just says how many.
const NAMED_CANDIDATES_MAX = 3;

const labelOf = (fileName) => (fileName ? fileName.replace(/\.[^.]+$/, "") : null);

/**
 * A recruiter's activity, newest first, a page at a time: pass the last
 * entry's `at` as `before` for the next page. Candidates are labelled by
 * their resume file name, the one handle that needs no resume text.
 */
const eventsFor = async ({ userId, before, limit }) => {
    const events = await ActivityEvent.find({
        user_id: oid(userId),
        ...(before ? { at: { $lt: before } } : {}),
    })
        .sort({ at: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

    const more = events.length > limit;
    const page = events.slice(0, limit);

    const named = page.filter(
        (event) => event.type !== ACTIVITY.SEARCH_RESULTS && (event.profile_ids?.length ?? 0) <= NAMED_CANDIDATES_MAX
    );
    const ids = [...new Set(named.flatMap((event) => event.profile_ids ?? []))];
    const profiles = ids.length
        ? await getProfilesCollection()
              .find({ _id: { $in: ids.flatMap(idForms) } }, { projection: { file_name: 1 } })
              .toArray()
        : [];
    const labels = new Map(profiles.map((profile) => [profile._id.toString(), labelOf(profile.file_name)]));

    return {
        items: page.map((event) => ({
            id: event._id.toString(),
            at: event.at,
            type: event.type,
            query: event.query ?? null,
            count: event.profile_ids?.length ?? 0,
            candidates: named.includes(event)
                ? (event.profile_ids ?? []).map((id) => ({ id, label: labels.get(id) ?? null }))
                : [],
            tag: event.type === ACTIVITY.TAG ? (event.meta?.tag ?? null) : undefined,
            source: event.meta?.source,
            ...(event.type === ACTIVITY.LOGIN || event.type === ACTIVITY.LOGIN_FAILED
                ? {
                      ip: event.meta?.ip ?? null,
                      userAgent: event.meta?.userAgent ?? null,
                      reason: event.meta?.reason ?? null,
                  }
                : {}),
        })),
        next: more ? page.at(-1).at : null,
    };
};

export { usageFor, summaryFor, searchesFor, eventsFor, labelOf, daysIn, USAGE_DAYS };
