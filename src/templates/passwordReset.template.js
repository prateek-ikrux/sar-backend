import { ORG_NAME, PRODUCT_NAME } from "../constants.js";
import { escapeHtml, safeUrl, button, emailLayout, paragraph } from "./layout.js";

// Styled like otp.template.js: inline, table-based markup for email clients.
const passwordResetTemplate = ({ code, name = "there", expiryMinutes = 10, appUrl }) => {
    const subject = `${code} is your ${ORG_NAME} password reset code`;
    const link = safeUrl(appUrl);

    const text = [
        `Hi ${name},`,
        "",
        `Your code to reset your ${PRODUCT_NAME} password is ${code}.`,
        `It expires in ${expiryMinutes} minutes and can be used once.`,
        ...(link ? ["", `Open ${PRODUCT_NAME}: ${link}`] : []),
        "",
        "If you didn't ask to reset your password, you can safely ignore this email.",
        "Your password has not been changed.",
        "",
        `— ${ORG_NAME} · ${PRODUCT_NAME}`,
    ].join("\n");

    // Everything interpolated into the markup is escaped: name is whatever an
    // admin typed, and a stray < or & would otherwise become markup in the mail.
    const safe = {
        name: escapeHtml(name),
        code: escapeHtml(code),
        expiryMinutes: escapeHtml(expiryMinutes),
        product: escapeHtml(PRODUCT_NAME),
    };

    const content = [
        paragraph(`Hi ${safe.name},`),
        paragraph(`Use this code to reset your ${safe.product} password:`),
        `            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:20px 16px; background-color:#f4f5f7; border-radius:6px;">
                  <span style="font-family:'SF Mono',Consolas,'Courier New',monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#1a1d21;">${safe.code}</span>
                </td>
              </tr>
            </table>`,
        paragraph(
            `This code expires in <strong style="color:#1a1d21;">${safe.expiryMinutes} minutes</strong> and can only be used once.`,
            { muted: true, top: 24 }
        ),
        ...(link ? [button(link, `Open ${PRODUCT_NAME}`)] : []),
        `            <p style="margin:24px 0 0 0; padding-top:24px; border-top:1px solid #e3e5e9; font-size:14px; line-height:22px; color:#5c6370;">
              If you didn't ask to reset your password, you can safely ignore this email — your password has not been changed. No one can reset it without this code.
            </p>`,
    ].join("\n");

    const html = emailLayout({
        title: subject,
        preheader: `${code} is your ${ORG_NAME} password reset code. It expires in ${expiryMinutes} minutes.`,
        content,
    });

    return { subject, html, text };
};

export default passwordResetTemplate;
