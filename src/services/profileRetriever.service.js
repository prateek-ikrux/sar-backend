import { getProfilesCollection } from "../db/index.js";
import { getResumeUrl, getPresignedUrl, objectExists } from "../utils/minio.js";
import { VECTOR_INDEX, VECTOR_SEARCH_PATH, MAX_CANDIDATES, EXISTENCE_BATCH } from "../constants.js";
import { redact } from "../utils/redact.js";
import { findCandidateName } from "./candidateName.js";

// Resumes land from a separate pipeline over time, so a stored has_resume flag
// would go stale. Availability is checked live instead, and only ever improves.
// The name is found here, while the full document is still at hand; the
// document itself is stripped before anything reaches the client.
const toResult = (profile, resumeUrl) => ({
    id: profile._id.toString(),
    fileName: profile.file_name,
    email: profile.email,
    phone: profile.phone,
    score: profile.score,
    resumeUrl,
    summary: { name: findCandidateName(profile.document, profile.email) },
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

            return toResult({ ...profile, document: documents.get(profile._id.toString()) ?? "" }, resumeUrl);
        })
    );
};

export { searchProfiles, redact };
