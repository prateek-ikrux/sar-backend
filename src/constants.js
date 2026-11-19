const ROLES = Object.freeze({
  ADMIN: "admin",
  RECRUITER: "recruiter",
});

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
// What an emailed code is good for. A code only works for the purpose it was
// issued for, so a password-reset code can never sign anyone in.
const OTP_PURPOSE = Object.freeze({ LOGIN: "login", RESET: "reset" });

// Passwords a user chooses.
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const OTP_REQUESTS_PER_IP = 10;
// Per address per window, for sign-in requests and, separately, forgot-password.
// Each sign-in request also checks a password, so this caps password guesses per
// address too; and each code allows OTP_MAX_ATTEMPTS guesses, so it bounds code
// guesses as well: 5 codes x 5 attempts = 25 per window.
const OTP_REQUESTS_PER_EMAIL = 5;
const OTP_VERIFICATIONS_PER_IP = 20;
const PASSWORD_CHANGES_PER_IP = 10;

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

// Recruiter activity. Each event keeps the candidate's id only, never their
// details. Events go after a year; the text a recruiter typed (searches,
// questions) is dropped from them after 90 days, leaving the counts.
const ACTIVITY = Object.freeze({
  SEARCH_RESULTS: "search_results",
  QUESTION: "question",
  CONTACT_VIEW: "contact_view",
  RESUME_VIEW: "resume_view",
  RESUME_DOWNLOAD: "resume_download",
  SHORTLIST_ADD: "shortlist_add",
  SHORTLIST_REMOVE: "shortlist_remove",
  TAG: "tag",
  EXPORT: "export",
  LOGIN: "login",
  LOGIN_FAILED: "login_failed",
});
// What counts as having worked on a candidate, as against them only turning
// up in someone's results. These are what the search card flags to others.
const ENGAGED_ACTIVITY = Object.freeze([
  ACTIVITY.CONTACT_VIEW,
  ACTIVITY.RESUME_VIEW,
  ACTIVITY.RESUME_DOWNLOAD,
  ACTIVITY.SHORTLIST_ADD,
  ACTIVITY.TAG,
  ACTIVITY.EXPORT,
]);
const ACTIVITY_RETENTION_DAYS = 365;
const ACTIVITY_TEXT_RETENTION_DAYS = 90;
const ACTIVITY_TEXT_PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// How far back a search card looks for other recruiters' work.
const TEAM_ACTIVITY_WINDOW_DAYS = 90;
// Other recruiters named on one card; the rest are counted.
const TEAM_ACTIVITY_NAMES_MAX = 5;

// Shared status on a candidate, one current tag per recruiter, seen by all.
const CANDIDATE_TAGS = Object.freeze([
  "contacted",
  "interested",
  "not_interested",
  "not_reachable",
  "wrong_number",
  "in_process",
  "not_a_fit",
  "placed",
]);
const CANDIDATE_TAG_NOTE_MAX_CHARS = 280;

// Time on the platform. The page checks in about once a minute while it is
// visible and in use; check-ins closer together than SESSION_GAP_MS belong to
// one session. Each check-in adds the time since the last one, capped, so two
// open tabs or a stalled timer cannot inflate it.
const SESSION_GAP_MS = 5 * 60 * 1000;
const HEARTBEAT_MAX_CREDIT_SECONDS = 75;
// User agents are free text from the client; this is plenty to name a browser.
const USER_AGENT_MAX_CHARS = 300;

// Unusual activity, flagged for admins. Each is a count in one window that a
// recruiter working normally wouldn't reach.
const FLAG_RESUMES_PER_HOUR = 30;
const FLAG_CONTACTS_PER_HOUR = 30;
const FLAG_EXPORTED_PER_DAY = 100;
const FLAG_FAILED_LOGINS_PER_DAY = 5;
const FLAG_NIGHT_ACTIONS_PER_DAY = 5;
// Local hours counted as night: from NIGHT_START until NIGHT_END.
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;
// A sign-in is from somewhere new if its IP or browser wasn't seen in this
// many days before it.
const NEW_LOCATION_LOOKBACK_DAYS = 90;

// The weekly summary email: Mondays, from this hour, in the time zone the
// admins chose. Off until an admin turns it on.
const WEEKLY_SUMMARY_HOUR = 9;
const WEEKLY_SUMMARY_CHECK_MS = 10 * 60 * 1000;
const WEEKLY_SUMMARY_MAX_RECIPIENTS = 20;

const EXPORT_MAX_ROWS = 200;
// A download link is used straight away, so it is short-lived.
const RESUME_DOWNLOAD_URL_EXPIRY_SECONDS = 5 * 60;

// How the product names itself to users, in the UI and in every email. The
// organisation is always lower-case "ikrux", as in its wordmark.
const ORG_NAME = "ikrux";
const PRODUCT_NAME = "Candidate Search & Retrieval";

export {
  ROLES,
  ACTIVITY,
  ENGAGED_ACTIVITY,
  ACTIVITY_RETENTION_DAYS,
  ACTIVITY_TEXT_RETENTION_DAYS,
  ACTIVITY_TEXT_PURGE_INTERVAL_MS,
  TEAM_ACTIVITY_WINDOW_DAYS,
  TEAM_ACTIVITY_NAMES_MAX,
  CANDIDATE_TAGS,
  CANDIDATE_TAG_NOTE_MAX_CHARS,
  EXPORT_MAX_ROWS,
  RESUME_DOWNLOAD_URL_EXPIRY_SECONDS,
  SESSION_GAP_MS,
  HEARTBEAT_MAX_CREDIT_SECONDS,
  USER_AGENT_MAX_CHARS,
  FLAG_RESUMES_PER_HOUR,
  FLAG_CONTACTS_PER_HOUR,
  FLAG_EXPORTED_PER_DAY,
  FLAG_FAILED_LOGINS_PER_DAY,
  FLAG_NIGHT_ACTIONS_PER_DAY,
  NIGHT_START_HOUR,
  NIGHT_END_HOUR,
  NEW_LOCATION_LOOKBACK_DAYS,
  WEEKLY_SUMMARY_HOUR,
  WEEKLY_SUMMARY_CHECK_MS,
  WEEKLY_SUMMARY_MAX_RECIPIENTS,
  ORG_NAME,
  PRODUCT_NAME,
  SHORTLIST_MAX_ITEMS,
  SHORTLIST_NOTE_MAX_CHARS,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_PURPOSE,
  RATE_LIMIT_WINDOW_MS,
  OTP_REQUESTS_PER_IP,
  OTP_REQUESTS_PER_EMAIL,
  OTP_VERIFICATIONS_PER_IP,
  PASSWORD_CHANGES_PER_IP,
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
