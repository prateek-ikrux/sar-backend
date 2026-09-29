const ROLES = Object.freeze({
  ADMIN: "admin",
  RECRUITER: "recruiter",
});

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const OTP_REQUESTS_PER_IP = 10;
// Each code allows OTP_MAX_ATTEMPTS guesses, so this also bounds guesses per
// address: 5 codes x 5 attempts = 25 per window.
const OTP_REQUESTS_PER_EMAIL = 5;
const OTP_VERIFICATIONS_PER_IP = 20;

const MICROSOFT_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const MICROSOFT_GET_TOKEN = "https://login.microsoftonline.com/<TENANT_ID>/oauth2/v2.0/token";
const MICROSOFT_SEND_MAIL = "https://graph.microsoft.com/v1.0/users/<SENDER_EMAIL>/sendMail";

const VECTOR_INDEX = "autoembed_index";
const VECTOR_SEARCH_PATH = "document";

const SEARCH_LIMIT_MIN = 1;
const SEARCH_LIMIT_MAX = 40;
const SEARCH_LIMIT_DEFAULT = 5;

const CHARS_PER_DOCUMENT_MIN = 500;
const CHARS_PER_DOCUMENT_MAX = 20000;
const CHARS_PER_DOCUMENT_DEFAULT = 4000;

// Upper bound on limit x charsPerDocument: the resume text pinned into a
// conversation and re-sent with every follow-up. 200k chars is roughly 50k
// tokens. Without it, 40 x 20000 would put ~200k tokens on every turn. The
// frontend mirrors this in src/services/search.ts.
const MAX_CONTEXT_CHARS = 200000;

const REQUIRE_RESUME_DEFAULT = true;

// Pool size for requireResume. ENN costs the same at 400 as at 20, so the pool
// is cheap; the existence checks are batched and stop once enough are found.
const MAX_CANDIDATES = 400;
const EXISTENCE_BATCH = 40;

const PHONE_DIGITS_MIN = 10;
const PHONE_DIGITS_MAX = 15;

const MAX_CONVERSATIONS = 200;
const MAX_CONVERSATIONS_PER_USER = 20;
const MAX_STORED_MESSAGES = 20;
const MAX_HISTORY_MESSAGES = 12;

// Per OpenAI request. Worst case is (retries + 1) x timeout, about 2 minutes,
// which has to stay under the frontend's ask timeout (ASK_TIMEOUT_MS, 3
// minutes) so the server always gives up first.
const LLM_TIMEOUT_MS = 60 * 1000;
const LLM_MAX_RETRIES = 1;

const RESUME_URL_EXPIRY_SECONDS = 24 * 60 * 60;
const RESUME_URL_REFRESH_MS = 60 * 60 * 1000;

// Resumes arrive from a separate pipeline over time, so the two answers age
// differently: a file that exists will not disappear, a missing one appears later.
const RESUME_EXISTS_TTL_MS = 6 * 60 * 60 * 1000;
const RESUME_MISSING_TTL_MS = 5 * 60 * 1000;
const RESUME_CACHE_MAX_ENTRIES = 50000;

// A personal shortlist is a working set, not an archive. Bounded so the list
// page (which signs a fresh resume link for every item) stays quick.
const SHORTLIST_MAX_ITEMS = 200;
const SHORTLIST_NOTE_MAX_CHARS = 1000;

// How the product names itself to users, in the UI and in every email. The
// organisation is always lower-case "ikrux", as in its wordmark.
const ORG_NAME = "ikrux";
const PRODUCT_NAME = "Candidate Search & Retrieval";

export {
  ROLES,
  ORG_NAME,
  PRODUCT_NAME,
  SHORTLIST_MAX_ITEMS,
  SHORTLIST_NOTE_MAX_CHARS,
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  OTP_REQUESTS_PER_IP,
  OTP_REQUESTS_PER_EMAIL,
  OTP_VERIFICATIONS_PER_IP,
  MICROSOFT_GRAPH_SCOPE,
  MICROSOFT_GET_TOKEN,
  MICROSOFT_SEND_MAIL,
  VECTOR_INDEX,
  VECTOR_SEARCH_PATH,
  SEARCH_LIMIT_MIN,
  SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_DEFAULT,
  CHARS_PER_DOCUMENT_MIN,
  CHARS_PER_DOCUMENT_MAX,
  CHARS_PER_DOCUMENT_DEFAULT,
  MAX_CONTEXT_CHARS,
  REQUIRE_RESUME_DEFAULT,
  MAX_CANDIDATES,
  EXISTENCE_BATCH,
  PHONE_DIGITS_MIN,
  PHONE_DIGITS_MAX,
  MAX_CONVERSATIONS,
  MAX_CONVERSATIONS_PER_USER,
  MAX_STORED_MESSAGES,
  MAX_HISTORY_MESSAGES,
  LLM_TIMEOUT_MS,
  LLM_MAX_RETRIES,
  RESUME_URL_EXPIRY_SECONDS,
  RESUME_URL_REFRESH_MS,
  RESUME_EXISTS_TTL_MS,
  RESUME_MISSING_TTL_MS,
  RESUME_CACHE_MAX_ENTRIES,
};
