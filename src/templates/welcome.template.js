import { ORG_NAME, PRODUCT_NAME, ROLES } from "../constants.js";
import { escapeHtml, safeUrl, button, emailLayout, paragraph } from "./layout.js";

const roleLine = (role) =>
    role === ROLES.ADMIN
        ? "You can search candidates and manage who has access."
        : "You can search candidates and ask questions about them.";

// Sent when an admin adds someone, so they hear about access from the product
// rather than having to be told, and know there is no password to set up.
const welcomeTemplate = ({ name = "there", role, appUrl }) => {
    const subject = `You now have access to ${ORG_NAME} ${PRODUCT_NAME}`;
    const link = safeUrl(appUrl);

    const text = [
        `Hi ${name},`,
        "",
        `You've been given access to ${PRODUCT_NAME}. ${roleLine(role)}`,
        "",
        "There's no password. To sign in, enter this email address and we'll send you a one-time code.",
        ...(link ? ["", `Sign in: ${link}`] : []),
        "",
        `— ${ORG_NAME} · ${PRODUCT_NAME}`,
    ].join("\n");

    const content = [
        paragraph(`Hi ${escapeHtml(name)},`),
        paragraph(
            `You've been given access to <strong>${escapeHtml(PRODUCT_NAME)}</strong>. ${escapeHtml(roleLine(role))}`
        ),
        paragraph(
            "There's no password. To sign in, enter this email address and we'll send you a one-time code.",
            { muted: true }
        ),
        ...(link ? [button(link, `Sign in to ${PRODUCT_NAME}`)] : []),
    ].join("\n");

    const html = emailLayout({
        title: subject,
        preheader: `You can now sign in to ${PRODUCT_NAME} with a code sent to this address.`,
        content,
    });

    return { subject, html, text };
};

export default welcomeTemplate;
