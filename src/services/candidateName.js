// Resumes reach us as markdown converted from PDFs, with no name field, so a
// candidate's name has to be found in the text. The first line is often not
// it: it may be an image placeholder, a section heading or a sentence. This
// looks for a name-shaped phrase near the top and only answers when the
// evidence is good -- a wrong name is worse than showing the file name.

const NAME_SCAN_LINES = 20;
const MIN_SCORE = 6;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decodeEntities = (text) =>
    text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === "#") {
            const code =
                entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return ENTITIES[entity.toLowerCase()] ?? match;
    });

// Bullets, arrows and emoji the converter keeps from the PDF, plus the
// private-use glyphs Word uses for bullets.
const DECORATION = /[\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{E000}-\u{F8FF}\u{1F000}-\u{1FAFF}\u{25A0}-\u{25FF}\u{2022}]/gu;

/**
 * One line of converted resume, as a person would read it: entities decoded,
 * placeholders, markup and decoration gone. Runs of spaces and tabs are kept
 * (as a tab) because they often separate fields, e.g. a name and a phone.
 */
const cleanLine = (raw) =>
    decodeEntities(raw)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/^\s*#{1,6}\s*/, "")
        .replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, "")
        .replace(DECORATION, " ")
        .replace(/[*_`~]+/g, "")
        .replace(/ {2,}|\t+/g, "\t")
        .replace(/ +/g, " ")
        .trim();

// Words that show a phrase is a heading, a job, a place or a qualification
// rather than a person. Compared lower-case, with dots removed.
const NOT_NAME_WORDS = new Set(
    `summary profile professional objective objectives career resume curriculum vitae cv biodata bio
    contact contacts details detail information info personal experience experiences education educational
    skills skill technical technology technologies key core competencies competency work history employment
    project projects achievements achievement certifications certification certificate certificates
    languages language hobbies hobby interests interest strengths strength declaration references reference
    about me address email mail phone mobile tel telephone name date birth dob total years year months
    academic academics qualification qualifications additional activities activity expertise areas area
    highlights overview responsibilities responsibility roles role accomplishments awards award training
    trainings courses course internship internships publications tools environment domain industry client
    duration team size organization organisation current previous present company employer location
    nationality status marital gender father mother passport known strengths synopsis snapshot abstract
    statement goal vision mission extra curricular co page linkedin github portfolio website
    engineer engineering developer development manager management analyst analysis consultant designer design
    architect lead leader administrator admin tester testing intern executive officer specialist associate
    senior junior sr jr software hardware data business product sales marketing hr head director trainee
    fresher full stack frontend front backend back end web cloud devops qa support services service
    university college school institute pvt ltd limited inc llp corporation corp group bachelor bachelors
    master masters degree diploma be btech mtech bsc msc bca mca mba bcom mcom phd ssc hsc cbse
    computer computers science sciences it information systems electronics electrical mechanical civil
    java python javascript react angular node sql oracle sap aws azure microsoft google amazon
    india indian pune mumbai navi thane bangalore bengaluru hyderabad chennai delhi new noida gurgaon gurugram
    kolkata ahmedabad nagpur nashik maharashtra karnataka telangana tamil nadu kerala gujarat
    of and in the for with to at on by from as or an a is my our your i`.split(/\s+/)
);

const titleCase = (word) =>
    word.length <= 2 && word.endsWith(".")
        ? word
        : word.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());

/**
 * A phrase that could be a person's name, tidied for display; else null.
 * `full` is false for a single name, with or without initials ("Priya",
 * "RAHUL K"), which only counts when the email backs it up.
 */
const asName = (segment) => {
    const words = segment
        .replace(/\([^)]*\)?/g, " ")
        // Initials run together with a name: "Ramesh.K.S" -> "Ramesh. K. S".
        .replace(/\.(?=\p{L})/gu, ". ")
        .replace(/[.,;:]+$/, "")
        .split(/\s+/)
        .filter(Boolean);

    if (words.length < 1 || words.length > 5) return null;
    const longWords = words.filter((w) => w.replace(/\./g, "").length >= 3).length;
    if (longWords < 1) return null;

    for (const word of words) {
        // Each word a capitalised run of letters: sentence fragments, emails,
        // numbers and dates all fail here.
        if (!/^\p{Lu}[\p{L}'.-]*$/u.test(word)) return null;
        if (NOT_NAME_WORDS.has(word.toLowerCase().replace(/\./g, ""))) return null;
    }

    // All capitals is a styling choice; show it the way names are written.
    // Initials get one dot each ("K. S."), full names none ("Ramesh").
    const shouting = words.every((w) => w === w.toUpperCase());
    const tidy = words.map((w) => {
        const bare = w.replace(/\.+$/, "");
        return bare.length === 1 ? `${bare}.` : shouting ? titleCase(bare) : bare;
    });
    return {
        name: tidy.join(" "),
        full: words.filter((w) => w.replace(/\./g, "").length >= 2).length >= 2,
    };
};

// The email's local part, as letters: "amol.bandal92" -> "amolbandal".
const emailLetters = (email) => (email ?? "").split("@")[0].toLowerCase().replace(/[^a-z]/g, "");

/** How many of the name's words (3+ letters) also appear in the email address. */
const emailOverlap = (name, letters) =>
    letters.length < 3
        ? 0
        : name
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.replace(/[^a-z]/g, "").length >= 3 && letters.includes(w.replace(/[^a-z]/g, ""))).length;

const LABELLED = /(?:^|\t|\s)(?:candidate\s+|full\s+)?name\s*[:\-–]\s*(.+)$/i;
const FIELD_BREAK = /\s+(?:mobile|mob|phone|ph|contact|e-?mail|dob|date|address|gender|age|cell)\b.*$/i;

/**
 * The candidate's name as written in the resume, or null when nothing near
 * the top looks enough like one. `email` (the profile's) is the best evidence:
 * most addresses are built from the owner's name.
 */
const findCandidateName = (document, email) => {
    const letters = emailLetters(email);
    const lines = String(document ?? "")
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(0, NAME_SCAN_LINES);

    let best = null;

    lines.forEach((raw, index) => {
        const heading = /^\s*#{1,6}\s/.test(raw);
        const line = cleanLine(raw);
        if (!line) return;

        const labelled = LABELLED.exec(line);
        const segments = labelled
            ? [{ text: labelled[1].replace(FIELD_BREAK, "").split(/[\t|,;]/)[0], labelled: true }]
            : line.split(/\t|\s*[|·,;:]\s*|\s+[-–—]\s+/).map((text) => ({ text, labelled: false }));

        for (const segment of segments) {
            const candidate = asName(segment.text.trim());
            if (!candidate) continue;
            const { name, full } = candidate;
            const overlap = emailOverlap(name, letters);
            // One name alone (or with initials) is too easy to mistake for a
            // heading or a word; the email has to vouch for it.
            if (!full && overlap === 0) continue;

            const score =
                10 * Math.min(overlap, 2) +
                (segment.labelled ? 8 : 0) +
                (heading ? 3 : 0) +
                // The name alone on its line, rather than inside a sentence.
                (segment.text.trim().length >= line.replace(/\t/g, " ").trim().length - 2 ? 3 : 0) +
                (NAME_SCAN_LINES - index) * 0.2;

            if (!best || score > best.score) best = { name, score };
        }
    });

    return best && best.score >= MIN_SCORE ? best.name : null;
};

export { findCandidateName, cleanLine, decodeEntities };
