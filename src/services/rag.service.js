import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { searchProfiles, redact } from "./profileRetriever.service.js";
import { createConversation, appendTurn } from "./conversation.service.js";
import { getResumeUrl } from "../utils/minio.js";
import {
    SEARCH_LIMIT_DEFAULT,
    CHARS_PER_DOCUMENT_DEFAULT,
    REQUIRE_RESUME_DEFAULT,
    MAX_HISTORY_MESSAGES,
    RESUME_URL_REFRESH_MS,
} from "../constants.js";

const SYSTEM_TEMPLATE = `You are a recruiting assistant. Answer using only the candidate profiles below and the conversation so far.

Each profile is labelled with its number and file name. When you refer to a candidate, cite that
number like [1]. These profiles were retrieved once at the start of this conversation and will not
change. If a question cannot be answered from them, say so and suggest starting a new search rather
than guessing or implying that other candidates exist. Contact details have been removed from these
profiles, so do not attempt to supply them.

The profiles were retrieved for the recruiter request below. Treat it as the role requirements when
judging how well candidates fit. If the recruiter later refines or changes a requirement in the
conversation, the later statement takes precedence.

<request>
{searchQuery}
</request>

Profiles:
{context}`;

// context and the search query sit in the system message, ahead of the history,
// so the multi-KB prefix is byte-identical on every turn and stays eligible for
// prompt caching. The query is kept there rather than in the history so it never
// ages out of the MAX_HISTORY_MESSAGES window.
const PROMPT = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_TEMPLATE],
    new MessagesPlaceholder("history"),
    ["human", "{question}"],
]);

const formatProfiles = (profiles, charsPerDocument) =>
    profiles
        .map(
            (profile, index) =>
                `[${index + 1}] ${profile.fileName ?? "unknown file"} (score ${profile.score?.toFixed(4)})\n${redact(
                    (profile.document ?? "").slice(0, charsPerDocument)
                )}`
        )
        .join("\n\n---\n\n");

// Nothing without a resume reaches the model, whichever path opened the
// conversation, so a caller that opted out of requireResume still cannot pin
// an unbacked profile into the context.
const buildConversationContext = ({ profiles, charsPerDocument = CHARS_PER_DOCUMENT_DEFAULT }) => {
    const backed = profiles.filter((profile) => profile.resumeUrl);

    return {
        context: formatProfiles(backed, charsPerDocument),
        sources: backed.map(({ document, ...source }) => source),
        skipped: profiles.length - backed.length,
    };
};

const openConversation = async ({ userId, question, profiles, limit, charsPerDocument }) => {
    const { context, sources } = buildConversationContext({ profiles, charsPerDocument });

    return createConversation({ userId, question, context, sources, limit, charsPerDocument });
};

// getResumeUrl yields null when MinIO is unreachable, so a failed refresh must
// keep the URL already held rather than replacing it with null.
const refreshResumeUrls = async (conversation) => {
    if (Date.now() - conversation.resumeUrlsIssuedAt <= RESUME_URL_REFRESH_MS) return;

    const hadUrls = conversation.sources.some((source) => source.resumeUrl);

    const refreshed = await Promise.all(
        conversation.sources.map(async (source) => {
            const resumeUrl = await getResumeUrl(source.fileName);
            return resumeUrl ? { ...source, resumeUrl } : source;
        })
    );

    const renewed = refreshed.some((source, index) => source !== conversation.sources[index]);

    conversation.sources = refreshed;

    if (renewed || !hadUrls) conversation.resumeUrlsIssuedAt = Date.now();
};

const askProfiles = async ({ question, limit, charsPerDocument, requireResume, conversation, userId }) => {
    let active = conversation;

    if (active) {
        await refreshResumeUrls(active);
    } else {
        const resolvedLimit = limit ?? SEARCH_LIMIT_DEFAULT;
        const resolvedChars = charsPerDocument ?? CHARS_PER_DOCUMENT_DEFAULT;
        const resolvedRequireResume = requireResume ?? REQUIRE_RESUME_DEFAULT;
        const profiles = await searchProfiles({
            query: question,
            limit: resolvedLimit,
            requireResume: resolvedRequireResume,
        });

        active = await openConversation({
            userId,
            question,
            profiles,
            limit: resolvedLimit,
            charsPerDocument: resolvedChars,
        });
    }

    const chatModel = new ChatOpenAI({
        model: process.env.OPENAI_MODEL,
        apiKey: process.env.OPENAI_API_KEY,
        temperature: 0,
    });

    const chain = PROMPT.pipe(chatModel).pipe(new StringOutputParser());

    const answer = await chain.invoke({
        context: active.context,
        searchQuery: active.question,
        history: active.messages.slice(-MAX_HISTORY_MESSAGES),
        question,
    });

    await appendTurn({
        conversation: active,
        humanMessage: new HumanMessage(question),
        aiMessage: new AIMessage(answer),
    });

    return {
        answer,
        model: process.env.OPENAI_MODEL,
        sources: active.sources,
        conversation: active,
    };
};

export {
    askProfiles,
    openConversation,
    buildConversationContext,
    formatProfiles,
    refreshResumeUrls,
    SYSTEM_TEMPLATE,
    PROMPT,
};
