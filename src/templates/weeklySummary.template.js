import { ORG_NAME, PRODUCT_NAME } from "../constants.js";
import { escapeHtml, safeUrl, button, emailLayout, paragraph, FONT } from "./layout.js";

const n = (value) => Number(value).toLocaleString("en-IN");

const duration = (seconds) => {
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};


const FLAG_TEXT = {
    bulk_resumes: (f) => `opened ${n(f.count)} resumes in one hour`,
    bulk_contacts: (f) => `viewed ${n(f.count)} contacts in one hour`,
    bulk_export: (f) => `exported ${n(f.count)} candidates in one day`,
    failed_logins: (f) => `had ${n(f.count)} failed sign-ins in one day`,
    night_activity: (f) => `worked on ${n(f.count)} candidates at night`,
    new_ip: (f) => `signed in from a new IP address (${f.ip})`,
    new_browser: (f) => `signed in from a new browser (${f.browser})`,
};

const flagLine = (flag) => `${flag.name} ${(FLAG_TEXT[flag.kind] ?? (() => "did something unusual"))(flag)}`;

const TOP = 5;
const FLAGS_SHOWN = 10;

const cell = (html, { align = "left", head = false } = {}) =>
    `<td style="padding:6px 8px; border-bottom:1px solid #e3e5e9; text-align:${align}; font-family:${FONT}; font-size:13px; line-height:18px; color:${head ? "#5c6370" : "#1a1d21"};${head ? " font-weight:600;" : ""}">${html}</td>`;

const heading = (text) =>
    `            <p style="margin:24px 0 8px 0; font-size:15px; line-height:22px; font-weight:600; color:#1a1d21;">${escapeHtml(text)}</p>`;

/**
 * The week in one email for admins: headline numbers, the busiest
 * recruiters, how often two worked the same candidate, who did nothing, and
 * anything unusual. `summary` is teamSummary's result for 7 days.
 */
const weeklySummaryTemplate = ({ summary, appUrl }) => {
    const { totals, ranking, duplicateEffort, flags, inactive } = summary;
    const subject = `${PRODUCT_NAME}: your team's week`;
    const top = ranking.filter((row) => row.activeDays > 0 || row.activeSeconds > 0).slice(0, TOP);
    const link = safeUrl(appUrl) ? `${appUrl.replace(/\/+$/, "")}/team` : null;
    const shared = `${Math.round(duplicateEffort.rate * 100)}%`;

    const headline = [
        `${n(totals.activeUsers)} people active`,
        `${n(totals.searches)} searches`,
        `${n(totals.candidatesWorked)} candidates worked on`,
        `${duration(totals.activeSeconds)} on the platform`,
    ];

    const text = [
        `Your team's last 7 days on ${PRODUCT_NAME}:`,
        "",
        ...headline.map((line) => `- ${line}`),
        "",
        "Most active:",
        ...(top.length
            ? top.map(
                  (row) =>
                      `- ${row.user.name}: ${n(row.candidatesWorked)} candidates, ${n(row.searches)} searches, ${duration(row.activeSeconds)}`
              )
            : ["- Nobody used the platform this week."]),
        "",
        `Duplicate effort: ${shared} of candidates (${n(duplicateEffort.shared)} of ${n(duplicateEffort.candidates)}) were worked on by more than one recruiter.`,
        ...(inactive.length ? ["", `No activity: ${inactive.map((user) => user.name).join(", ")}`] : []),
        ...(flags.length
            ? ["", "Worth a look:", ...flags.slice(0, FLAGS_SHOWN).map((flag) => `- ${flagLine(flag)}`)]
            : []),
        ...(link ? ["", `Details: ${link}`] : []),
        "",
        `— ${ORG_NAME} · ${PRODUCT_NAME}`,
    ].join("\n");

    const table = top.length
        ? `            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>${cell("Recruiter", { head: true })}${cell("Candidates", { head: true, align: "right" })}${cell("Searches", { head: true, align: "right" })}${cell("Time", { head: true, align: "right" })}</tr>
              ${top
                  .map(
                      (row) =>
                          `<tr>${cell(escapeHtml(row.user.name))}${cell(n(row.candidatesWorked), { align: "right" })}${cell(n(row.searches), { align: "right" })}${cell(duration(row.activeSeconds), { align: "right" })}</tr>`
                  )
                  .join("\n              ")}
            </table>`
        : paragraph("Nobody used the platform this week.", { muted: true });

    const list = (items) =>
        `            <ul style="margin:0; padding:0 0 0 18px; font-size:14px; line-height:22px; color:#1a1d21;">
              ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n              ")}
            </ul>`;

    const content = [
        paragraph(`Your team's last 7 days on <strong>${escapeHtml(PRODUCT_NAME)}</strong>.`),
        list(headline),
        heading("Most active"),
        table,
        heading("Duplicate effort"),
        paragraph(
            `<strong>${escapeHtml(shared)}</strong> of candidates worked on (${n(duplicateEffort.shared)} of ${n(duplicateEffort.candidates)}) had more than one recruiter on them.`,
            { muted: true }
        ),
        ...(inactive.length
            ? [heading("No activity"), paragraph(escapeHtml(inactive.map((user) => user.name).join(", ")), { muted: true })]
            : []),
        ...(flags.length
            ? [
                  heading("Worth a look"),
                  list(flags.slice(0, FLAGS_SHOWN).map(flagLine)),
                  ...(flags.length > FLAGS_SHOWN
                      ? [paragraph(`And ${n(flags.length - FLAGS_SHOWN)} more on the team page.`, { muted: true, top: 8 })]
                      : []),
              ]
            : []),
        ...(link ? [button(link, "Open team activity")] : []),
    ].join("\n");

    const html = emailLayout({
        title: subject,
        preheader: headline.join(" · "),
        content,
    });

    return { subject, html, text };
};

export default weeklySummaryTemplate;
