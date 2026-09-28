import { BaseRetriever } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import { getProfilesCollection } from "../db/index.js";
import { getResumeUrl, getPresignedUrl, objectExists } from "../utils/minio.js";
import {
    VECTOR_INDEX,
    VECTOR_SEARCH_PATH,
    PHONE_DIGITS_MIN,
    PHONE_DIGITS_MAX,
    MAX_CANDIDATES,
    EXISTENCE_BATCH,
} from "../constants.js";

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Digit runs are only treated as phone numbers at 10-15 digits. A looser
// pattern redacts employment dates such as "2018-2022", which the model needs
// in order to answer anything about tenure.
const DIGIT_RUN_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

// Resumes land from a separate pipeline over time, so a stored has_resume flag
// would go stale. Availability is checked live instead, and only ever improves.
const toResult = (profile, resumeUrl) => ({
    id: profile._id.toString(),
    fileName: profile.file_name,
    email: profile.email,
    phone: profile.phone,
    score: profile.score,
    resumeUrl,
    document: profile.document ?? "",
});

const projection = (includeDocument) => ({
    $project: {
        ...(includeDocument ? { document: 1 } : {}),
        file_name: 1,
        email: 1,
        phone: 1,
        score: { $meta: "vectorSearchScore" },
    },
});

// The index stores voyage-4 vectors that Atlas generates itself, so the query
// goes over as text. Sending a queryVector is rejected outright:
// "queryVector of type float32 cannot be used with autoEmbed quantization".
const runVectorSearch = async ({ query, limit, includeDocument }) =>
    getProfilesCollection()
        .aggregate([
            {
                $vectorSearch: {
                    index: VECTOR_INDEX,
                    path: VECTOR_SEARCH_PATH,
                    query,
                    exact: true,
                    limit,
                },
            },
            projection(includeDocument),
        ])
        .toArray();

// ENN costs the same at limit 20 or 400, so the candidate pool is cheap; the
// existence checks are not, and they stop as soon as enough are found.
const collectWithResumes = async ({ query, limit }) => {
    const candidates = await runVectorSearch({ query, limit: MAX_CANDIDATES, includeDocument: false });
    const kept = [];
    let scanned = 0;

    for (let start = 0; start < candidates.length && kept.length < limit; start += EXISTENCE_BATCH) {
        const batch = candidates.slice(start, start + EXISTENCE_BATCH);
        const flags = await Promise.all(batch.map((profile) => objectExists(profile.file_name)));

        scanned += batch.length;

        for (const [index, exists] of flags.entries()) {
            if (exists && kept.length < limit) kept.push(batch[index]);
        }
    }

    return { kept, scanned, poolSize: candidates.length };
};

const searchProfiles = async ({ query, limit, requireResume = false, includeDocument = true }) => {
    if (!requireResume) {
        const results = await runVectorSearch({ query, limit, includeDocument });

        return Promise.all(
            results.map(async (profile) => toResult(profile, await getResumeUrl(profile.file_name)))
        );
    }

    const { kept } = await collectWithResumes({ query, limit });

    const documents = new Map();
    if (includeDocument && kept.length) {
        const withText = await getProfilesCollection()
            .find({ _id: { $in: kept.map((profile) => profile._id) } }, { projection: { document: 1 } })
            .toArray();
        for (const profile of withText) documents.set(profile._id.toString(), profile.document);
    }

    return Promise.all(
        kept.map(async (profile) => {
            // Existence was just confirmed, so the URL is signed without a
            // second round trip to check it again.
            let resumeUrl = null;
            try {
                resumeUrl = await getPresignedUrl(profile.file_name);
            } catch (error) {
                console.error(`resume url failed for "${profile.file_name}":`, error.message);
            }

            return toResult(
                { ...profile, document: documents.get(profile._id.toString()) ?? "" },
                resumeUrl
            );
        })
    );
};

const redact = (text) =>
    text.replace(EMAIL_PATTERN, "[email redacted]").replace(DIGIT_RUN_PATTERN, (match) => {
        const digits = match.replace(/\D/g, "").length;
        return digits >= PHONE_DIGITS_MIN && digits <= PHONE_DIGITS_MAX ? "[phone redacted]" : match;
    });

class ProfileRetriever extends BaseRetriever {
    // lc_namespace = ["sar", "retrievers", "profiles"];

    constructor({ limit = 5, charsPerDocument = 4000 } = {}) {
        super();
        this.limit = limit;
        this.charsPerDocument = charsPerDocument;
        this.lastResults = [];
    }

    async _getRelevantDocuments(query) {
        const profiles = await searchProfiles({ query, limit: this.limit });

        this.lastResults = profiles;

        return profiles.map(
            (profile) =>
                new Document({
                    pageContent: redact(profile.document.slice(0, this.charsPerDocument)),
                    metadata: {
                        id: profile.id,
                        fileName: profile.fileName,
                        score: profile.score,
                    },
                })
        );
    }
}

export {
    ProfileRetriever,
    searchProfiles,
    collectWithResumes,
    redact,
};
