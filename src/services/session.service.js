import UsageSession from "../models/usageSession.model.js";
import { SESSION_GAP_MS, HEARTBEAT_MAX_CREDIT_SECONDS } from "../constants.js";

/**
 * A check-in from a page in use. Extends the user's current session by the
 * time since its last check-in (capped), or opens a new one after a gap.
 *
 * The update only lands if nobody else extended the session first, so two
 * tabs checking in together count that minute once, not twice.
 */
const recordHeartbeat = async (userId, now = new Date()) => {
    const current = await UsageSession.findOne({
        user_id: userId,
        last_seen_at: { $gte: new Date(now.getTime() - SESSION_GAP_MS) },
    })
        .sort({ last_seen_at: -1 })
        .lean();

    if (!current) {
        await UsageSession.create({ user_id: userId, started_at: now, last_seen_at: now });
        return { session: "started" };
    }

    const elapsed = Math.max(0, (now.getTime() - current.last_seen_at.getTime()) / 1000);
    const credit = Math.round(Math.min(elapsed, HEARTBEAT_MAX_CREDIT_SECONDS));

    await UsageSession.updateOne(
        { _id: current._id, last_seen_at: current.last_seen_at },
        { $set: { last_seen_at: now }, $inc: { active_seconds: credit, heartbeats: 1 } }
    );
    return { session: "extended" };
};

export { recordHeartbeat };
