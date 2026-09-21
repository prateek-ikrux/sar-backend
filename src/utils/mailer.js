import ApiError from "./apiError.js";
import { MICROSOFT_GRAPH_SCOPE, MICROSOFT_GET_TOKEN, MICROSOFT_SEND_MAIL } from "../constants.js";
import otpTemplate from "../templates/otp.template.js";

const REQUEST_TIMEOUT_MS = 15000;

// Tokens last an hour; retire them a minute early so a send never races expiry.
const EXPIRY_SKEW_MS = 60 * 1000;
let cachedToken = null;

const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        throw error.name === "AbortError"
            ? new ApiError(504, `Microsoft Graph timed out after ${REQUEST_TIMEOUT_MS}ms`)
            : error;
    } finally {
        clearTimeout(timer);
    }
};

const getAccessToken = async () => {
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
        return cachedToken.value;
    }

    const response = await fetchWithTimeout(
        MICROSOFT_GET_TOKEN.replace("<TENANT_ID>", process.env.GRAPH_TENANT_ID),
        {
            method: "POST",
            body: new URLSearchParams({
                client_id: process.env.GRAPH_CLIENT_ID,
                client_secret: process.env.GRAPH_CLIENT_SECRET,
                scope: MICROSOFT_GRAPH_SCOPE,
                grant_type: "client_credentials",
            }),
        }
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new ApiError(502, "Could not authenticate with Microsoft Graph", [
            payload.error_description?.split(/\r?\n/)[0] ?? `token endpoint responded ${response.status}`,
        ]);
    }

    cachedToken = {
        value: payload.access_token,
        expiresAt: Date.now() + payload.expires_in * 1000 - EXPIRY_SKEW_MS,
    };

    return cachedToken.value;
};

// Sends as GRAPH_SENDER. `to` takes one address or several.
const sendMail = async ({ to, subject, html, text }) => {
    const recipients = [].concat(to).filter(Boolean).map((address) => ({ emailAddress: { address } }));

    if (!recipients.length) throw new ApiError(422, "sendMail requires at least one recipient");
    if (!subject) throw new ApiError(422, "sendMail requires a subject");
    if (!html && !text) throw new ApiError(422, "sendMail requires html or text");

    const token = await getAccessToken();
    const response = await fetchWithTimeout(
        MICROSOFT_SEND_MAIL.replace("<SENDER_EMAIL>", encodeURIComponent(process.env.GRAPH_SENDER)),
        {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: {
                    subject,
                    body: html ? { contentType: "HTML", content: html } : { contentType: "Text", content: text },
                    toRecipients: recipients,
                },
            }),
        }
    );

    // Graph answers 202 Accepted with an empty body.
    if (response.status !== 202) {
        const payload = await response.json().catch(() => ({}));
        throw new ApiError(502, "Microsoft Graph rejected the message", [
            payload.error?.message ?? `sendMail responded ${response.status}`,
        ]);
    }

    return { accepted: true };
};

const sendOtpMail = async ({ to, code, name, expiryMinutes }) => {
    if (!code) throw new ApiError(422, "sendOtpMail requires a code");

    return sendMail({ to, ...otpTemplate({ code, name, expiryMinutes }) });
};

export { sendMail, sendOtpMail };
