import WeeklySummarySettings from "../models/weeklySummarySettings.model.js";
import User from "../models/user.model.js";
import logger from "../utils/logger.js";
import { sendMail } from "../utils/mailer.js";
import weeklySummaryTemplate from "../templates/weeklySummary.template.js";
import { teamSummary } from "./teamReport.service.js";
import { ROLES, WEEKLY_SUMMARY_HOUR, WEEKLY_SUMMARY_CHECK_MS } from "../constants.js";

// The weekly summary email. Off by default; admins turn it on and choose who
// gets it, from among the admins: recruiters aren't told their activity is
// tracked, so the report never goes to one.

const KEY = "weekly_summary";

const loadSettings = async () =>
    (await WeeklySummarySettings.findOne({ key: KEY }).lean()) ??
    (await WeeklySummarySettings.create({ key: KEY })).toObject();

/** Active admins: the only people the summary can go to. */
const eligibleRecipients = () =>
    User.find({ role: ROLES.ADMIN, active: true }, { name: 1, email: 1 }).sort({ name: 1 }).lean();

/** Settings as the admin page shows them, with who can be chosen. */
const describeSettings = async () => {
    const [settings, eligible] = await Promise.all([loadSettings(), eligibleRecipients()]);
    const chosen = new Set(settings.recipient_ids.map(String));
    return {
        enabled: settings.enabled,
        timeZone: settings.time_zone,
        sendsAt: { weekday: "Monday", hour: WEEKLY_SUMMARY_HOUR },
        recipients: eligible.filter((user) => chosen.has(user._id.toString())).map(toPerson),
        eligible: eligible.map(toPerson),
        lastSentAt: settings.last_sent_at,
        lastError: settings.last_error,
    };
};

const toPerson = (user) => ({ _id: user._id.toString(), name: user.name, email: user.email });

/**
 * Saves the settings. Recipients must be active admins; turning it on with
 * nobody to send to is refused rather than silently doing nothing.
 */
const saveSettings = async ({ enabled, recipientIds, timeZone, updatedBy }) => {
    const eligible = new Set((await eligibleRecipients()).map((user) => user._id.toString()));
    const invalid = recipientIds.filter((id) => !eligible.has(id));
    if (invalid.length) return { error: "Only active admins can receive the summary" };
    if (enabled && !recipientIds.length) return { error: "Choose at least one person to send it to" };

    await WeeklySummarySettings.findOneAndUpdate(
        { key: KEY },
        { enabled, recipient_ids: recipientIds, time_zone: timeZone, updated_by: updatedBy },
        { upsert: true, setDefaultsOnInsert: true }
    );
    return { settings: await describeSettings() };
};

/** The weekday (0 = Sunday), hour and date of `now` in `tz`. */
const localParts = (now, tz) => {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hourCycle: "h23",
            weekday: "short",
        })
            .formatToParts(now)
            .map((part) => [part.type, part.value])
    );
    const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        weekday: weekdays[parts.weekday],
        hour: Number(parts.hour),
        date: `${parts.year}-${parts.month}-${parts.day}`,
    };
};

/**
 * The week a summary is due for at `now`, as that Monday's date, or null. Due
 * on Mondays from WEEKLY_SUMMARY_HOUR, local time, once. A Monday the server
 * missed altogether is skipped, not sent late on Tuesday.
 */
const dueWeek = (now, tz, lastSentWeek) => {
    const local = localParts(now, tz);
    if (local.weekday !== 1 || local.hour < WEEKLY_SUMMARY_HOUR) return null;
    return local.date === lastSentWeek ? null : local.date;
};

const buildEmail = async (timeZone) =>
    weeklySummaryTemplate({ summary: await teamSummary({ days: 7, tz: timeZone }), appUrl: process.env.APP_URL });

/**
 * Sends this week's summary if it's due. Claims the week first, so with
 * several servers running only one sends; a failed send gives the claim back
 * so the next check tries again. `send` is replaceable for tests.
 */
const runWeeklySummary = async ({ now = new Date(), send = sendMail } = {}) => {
    const settings = await loadSettings();
    if (!settings.enabled || !settings.recipient_ids.length) return { sent: false, reason: "off" };

    const week = dueWeek(now, settings.time_zone, settings.last_sent_week);
    if (!week) return { sent: false, reason: "not due" };

    const claimed = await WeeklySummarySettings.findOneAndUpdate(
        { key: KEY, enabled: true, last_sent_week: settings.last_sent_week },
        { last_sent_week: week }
    );
    if (!claimed) return { sent: false, reason: "claimed elsewhere" };

    // Recipients are checked again at send time: one may have lost admin since.
    const recipients = await User.find(
        { _id: { $in: settings.recipient_ids }, role: ROLES.ADMIN, active: true },
        { email: 1 }
    ).lean();

    try {
        if (!recipients.length) throw new Error("none of the chosen recipients is an active admin any more");
        await send({ to: recipients.map((user) => user.email), ...(await buildEmail(settings.time_zone)) });
        await WeeklySummarySettings.updateOne({ key: KEY }, { last_sent_at: now, last_error: null });
        logger.info({ week, recipients: recipients.length }, "weekly summary sent");
        return { sent: true, week };
    } catch (error) {
        await WeeklySummarySettings.updateOne(
            { key: KEY, last_sent_week: week },
            { last_sent_week: settings.last_sent_week, last_error: error.message?.slice(0, 300) ?? "send failed" }
        );
        logger.error({ err: error, week }, "weekly summary failed");
        return { sent: false, reason: "failed", error: error.message };
    }
};

/** Sends the summary now to one person, so an admin can see what it looks like. */
const sendTestSummary = async ({ to, send = sendMail }) => {
    const settings = await loadSettings();
    const email = await buildEmail(settings.time_zone);
    await send({ to, ...email, subject: `[Test] ${email.subject}` });
};

const startWeeklySummary = () => {
    const run = () => runWeeklySummary().catch((error) => logger.error({ err: error }, "weekly summary check failed"));
    void run();
    setInterval(run, WEEKLY_SUMMARY_CHECK_MS).unref();
};

export { describeSettings, saveSettings, runWeeklySummary, sendTestSummary, startWeeklySummary, dueWeek };
