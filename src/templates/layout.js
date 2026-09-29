import { ORG_NAME, PRODUCT_NAME } from "../constants.js";

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Only http(s) links are rendered; anything else in APP_URL is ignored rather
// than put in an href.
const safeUrl = (url) => (typeof url === "string" && /^https?:\/\//i.test(url) ? url : null);

// A bulletproof button: a padded table cell, since Outlook ignores padding on
// links. The teal is the ikrux primary, dark enough for white text (4.74:1).
const button = (href, label) => `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">
              <tr>
                <td align="center" bgcolor="#1f8277" style="border-radius:6px;">
                  <a href="${escapeHtml(href)}" style="display:inline-block; padding:12px 20px; font-family:${FONT}; font-size:15px; font-weight:600; line-height:20px; color:#ffffff; text-decoration:none; border-radius:6px;">${escapeHtml(label)}</a>
                </td>
              </tr>
            </table>`;

/**
 * The shared frame for every email: header with the product name, one card of
 * content, and a footer. `content` is trusted markup built by the caller, who
 * must escape anything interpolated into it.
 */
const emailLayout = ({ title, preheader, content }) => `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f5f7; -webkit-font-smoothing:antialiased;">

<!-- preheader: shown in the inbox preview, hidden in the message itself -->
<div style="display:none; font-size:1px; color:#f4f5f7; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
  ${escapeHtml(preheader)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <p style="margin:0 0 16px 0; font-family:${FONT}; font-size:13px; line-height:18px; color:#5c6370;">
        <strong style="color:#1a1d21;">${escapeHtml(ORG_NAME)}</strong> &middot; ${escapeHtml(PRODUCT_NAME)}
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; border:1px solid #e3e5e9;">
        <tr>
          <td style="padding:32px 32px 24px 32px; font-family:${FONT};">
${content}
          </td>
        </tr>
      </table>

      <p style="margin:24px 0 0 0; font-family:${FONT}; font-size:12px; line-height:18px; color:#8a909c;">
        ${escapeHtml(ORG_NAME)} &middot; ${escapeHtml(PRODUCT_NAME)} &middot; This is an automated message, please don't reply.
      </p>

    </td>
  </tr>
</table>

</body>
</html>`;

const paragraph = (html, { muted = false, top = 0 } = {}) =>
    `            <p style="margin:${top}px 0 ${muted ? 0 : 24}px 0; font-size:${muted ? 14 : 16}px; line-height:${muted ? 22 : 24}px; color:${muted ? "#5c6370" : "#1a1d21"};">
              ${html}
            </p>`;

export { escapeHtml, safeUrl, button, emailLayout, paragraph, FONT };
