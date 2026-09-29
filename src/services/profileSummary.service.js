import { redact } from "../utils/redact.js";
import { cleanLine, findCandidateName } from "./candidateName.js";

// A result row needs more than a file name for a recruiter to triage it. The
// search itself is semantic, so this is only a reading aid: the candidate's
// name as the resume gives it, and the passage sharing the most words with
// the query. It never claims to be *why* the vector search ranked a profile.

const SNIPPET_MAX_CHARS = 200;
const SNIPPET_LEAD_CHARS = 60;
const MAX_TERMS = 6;

// Words a recruiter types that say nothing about a particular resume.
const STOPWORDS = new Set(
    `a an and or the of in on at to for from by with without who whom whose that this these those
    is are was were be been has have had having can could should would will must
    someone somebody person people candidate candidates profile profiles resume resumes
    looking need needs want find search show get me us our we you i
    year years yr yrs experience experienced exp plus least minimum min max more than over
    based located near around good strong solid great excellent comfortable proficient
    background knowledge skills skill familiar hands handson who's etc also`.split(/\s+/)
);

// Keeps tokens like node.js, c++ and c# whole.
const TOKEN_PATTERN = /[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g;

// A table's divider row carries no text worth previewing.
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|?\s*$/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const termsOf = (query) => {
    const seen = new Set();
    for (const token of query.toLowerCase().match(TOKEN_PATTERN) ?? []) {
        const term = token.replace(/\.+$/, "");
        if (term.length < 2 || STOPWORDS.has(term) || /^\d+\+?$/.test(term)) continue;
        seen.add(term);
    }
    return [...seen];
};

// Word boundaries that also hold for terms ending in + or #.
const termPattern = (term) => new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`, "i");

// Converted-PDF noise (entities, placeholders, markup) out, and table cells
// joined into one readable line.
const plain = (line) =>
    TABLE_DIVIDER.test(line)
        ? ""
        : cleanLine(line)
              .replace(/\s*\|\s*/g, " · ")
              .replace(/\s+/g, " ")
              .replace(/^[\s·]+|[\s·]+$/g, "")
              .trim();

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// Long lines (a paragraph pasted as one) are split into sentences so the
// snippet is a passage, not a page.
const passagesOf = (lines) =>
    lines.flatMap((line) => (line.length > SNIPPET_MAX_CHARS * 1.5 ? line.split(/(?<=[.;!?])\s+/) : [line]));

const snippetOf = (passages, patterns) => {
    let best = null;

    for (const passage of passages) {
        const hits = patterns.filter((pattern) => pattern.test(passage)).length;
        if (hits > 0 && (!best || hits > best.hits)) best = { passage, hits };
    }

    if (!best) return null;

    const { passage } = best;
    if (passage.length <= SNIPPET_MAX_CHARS) return passage;

    // Centre the window on the first hit, so the matched word is visible.
    const first = Math.min(
        ...patterns.map((pattern) => passage.search(pattern)).filter((index) => index >= 0)
    );
    let start = Math.max(0, first - SNIPPET_LEAD_CHARS);
    if (start > 0) start = passage.indexOf(" ", start) + 1 || start;
    const window = passage.slice(start, start + SNIPPET_MAX_CHARS);

    return `${start > 0 ? "…" : ""}${truncate(window, SNIPPET_MAX_CHARS)}`;
};

/**
 * `name` is null when the resume doesn't make it clear (see candidateName).
 * `terms` are the query words the resume actually contains, spelled as the
 * resume spells them, so the client can highlight them in the snippet.
 * `email` is the profile's: the best evidence for which phrase is the name.
 */
const summarizeProfile = (document, query, email) => {
    const lines = (document ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) return { name: null, snippet: null, terms: [] };

    const queryTerms = termsOf(query ?? "");
    const passages = passagesOf(lines.map((line) => plain(redact(line)))).filter(Boolean);
    const text = passages.join("\n");

    const terms = [];
    const patterns = [];
    for (const term of queryTerms) {
        const pattern = termPattern(term);
        const found = text.match(pattern);
        if (!found) continue;
        patterns.push(pattern);
        if (terms.length < MAX_TERMS) terms.push(found[0]);
    }

    return {
        name: findCandidateName(document, email),
        snippet: patterns.length ? snippetOf(passages, patterns) : null,
        terms,
    };
};

export { summarizeProfile, termsOf };
