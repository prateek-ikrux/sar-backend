import { PHONE_DIGITS_MIN, PHONE_DIGITS_MAX } from "../constants.js";

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Digit runs are only treated as phone numbers at 10-15 digits. A looser
// pattern redacts employment dates such as "2018-2022", which the model needs
// in order to answer anything about tenure.
const DIGIT_RUN_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

const EMAIL_REDACTED = "[email redacted]";
const PHONE_REDACTED = "[phone redacted]";

const redact = (text) =>
    text.replace(EMAIL_PATTERN, EMAIL_REDACTED).replace(DIGIT_RUN_PATTERN, (match) => {
        const digits = match.replace(/\D/g, "").length;
        return digits >= PHONE_DIGITS_MIN && digits <= PHONE_DIGITS_MAX ? PHONE_REDACTED : match;
    });

export { redact, EMAIL_REDACTED, PHONE_REDACTED };
