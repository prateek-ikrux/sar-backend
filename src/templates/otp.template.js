const DEFAULT_APP_NAME = "iKrux";

// Email clients strip <style> blocks and understand little beyond table
// layout, so everything here is inline and table-based on purpose. Outlook on
// Windows renders with Word's engine — no flexbox, no grid, no shorthand.
const otpTemplate = ({
    code,
    name = "there",
    expiryMinutes = 10,
    appName = DEFAULT_APP_NAME,
}) => {
    const subject = `${code} is your ${appName} verification code`;

    const text = [
        `Hi ${name},`,
        "",
        `Your ${appName} verification code is ${code}.`,
        `It expires in ${expiryMinutes} minutes and can be used once.`,
        "",
        "If you didn't request this code, you can safely ignore this email.",
        "Someone may have typed your address by mistake.",
        "",
        `— ${appName}`,
    ].join("\n");

    const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<title>${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f5f7; -webkit-font-smoothing:antialiased;">

<!-- preheader: shown in the inbox preview, hidden in the message itself -->
<div style="display:none; font-size:1px; color:#f4f5f7; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
  ${code} is your ${appName} verification code. It expires in ${expiryMinutes} minutes.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; border:1px solid #e3e5e9;">
        <tr>
          <td style="padding:32px 32px 24px 32px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

            <p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#1a1d21;">
              Hi ${name},
            </p>

            <p style="margin:0 0 24px 0; font-size:16px; line-height:24px; color:#1a1d21;">
              Use this code to sign in to ${appName}:
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:20px 16px; background-color:#f4f5f7; border-radius:6px;">
                  <span style="font-family:'SF Mono',Consolas,'Courier New',monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#1a1d21;">${code}</span>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0 0; font-size:14px; line-height:22px; color:#5c6370;">
              This code expires in <strong style="color:#1a1d21;">${expiryMinutes} minutes</strong> and can only be used once.
            </p>

            <p style="margin:24px 0 0 0; padding-top:24px; border-top:1px solid #e3e5e9; font-size:14px; line-height:22px; color:#5c6370;">
              If you didn't request this code, you can safely ignore this email — someone may have typed your address by mistake. No one can access your account without the code.
            </p>

          </td>
        </tr>
      </table>

      <p style="margin:24px 0 0 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:#8a909c;">
        ${appName} &middot; This is an automated message, please don't reply.
      </p>

    </td>
  </tr>
</table>

</body>
</html>`;

    return { subject, html, text };
};

export default otpTemplate;
