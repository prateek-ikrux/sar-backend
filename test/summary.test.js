import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeProfile, termsOf } from "../src/services/profileSummary.service.js";
import { findCandidateName } from "../src/services/candidateName.js";
import welcomeTemplate from "../src/templates/welcome.template.js";
import otpTemplate from "../src/templates/otp.template.js";

const RESUME = `# Priya Sharma | priya@example.com | +91 98765 43210

## Summary
Backend engineer with 6 years building APIs.

## Experience
- Built payment services in **Node.js** and MongoDB at Acme (2018-2022).
- Led a team of four on a React dashboard.`;

describe("termsOf", () => {
    it("drops filler words and bare numbers but keeps tech tokens whole", () => {
        assert.deepEqual(termsOf("Senior backend engineer with Node.js and C++, 5+ years"), [
            "senior",
            "backend",
            "engineer",
            "node.js",
            "c++",
        ]);
    });
});

describe("summarizeProfile", () => {
    it("finds the name on a heading line, without contact details", () => {
        assert.equal(summarizeProfile(RESUME, "node", "priya.s@example.com").name, "Priya Sharma");
    });

    it("cleans converter noise out of the snippet", () => {
        const { snippet } = summarizeProfile("<!-- image -->\nLed R&amp;D on Kafka pipelines <!-- image -->", "kafka");
        assert.equal(snippet, "Led R&D on Kafka pipelines");
    });

    it("picks the passage sharing the most query words", () => {
        const { snippet, terms } = summarizeProfile(RESUME, "Node.js MongoDB developer");
        assert.equal(snippet, "Built payment services in Node.js and MongoDB at Acme (2018-2022).");
        assert.deepEqual(terms, ["Node.js", "MongoDB"]);
    });

    it("never leaks an email or phone number into the snippet", () => {
        const { snippet } = summarizeProfile("Reach me at a@b.com or +91 98765 43210 about Kafka", "kafka");
        assert.equal(snippet.includes("a@b.com"), false);
        assert.equal(snippet.includes("98765"), false);
    });

    it("returns nothing it cannot back up", () => {
        assert.deepEqual(summarizeProfile("", "react"), { name: null, snippet: null, terms: [] });
        assert.equal(summarizeProfile(RESUME, "kubernetes").snippet, null);
    });

    it("trims a long passage around the first match", () => {
        // One sentence, so it cannot be split into shorter passages first.
        const long = `${"worked on many internal tools, ".repeat(12)}then migrated the platform to Kubernetes`;
        const { snippet } = summarizeProfile(long, "kubernetes");
        assert.ok(snippet.length <= 201);
        assert.ok(snippet.includes("Kubernetes"));
        assert.ok(snippet.startsWith("…"));
    });
});

// Shapes seen in the real library (converted PDFs); the names are made up.
describe("findCandidateName", () => {
    it("skips placeholders and section headings to reach the name", () => {
        const doc = "<!-- image -->\n## Professional Summary\n## RAVI KIRAN DESAI\nravi.desai88@mail.com";
        assert.equal(findCandidateName(doc, "ravi.desai88@mail.com"), "Ravi Kiran Desai");
    });

    it("finds a name inside a sentence when the email backs it up", () => {
        const doc =
            "Total 5.6 years of experience in IT sector in that 4 , RAVI KIRAN DESAI (BE &amp; ME COMPUTER)";
        assert.equal(findCandidateName(doc, "desai.ravi@mail.com"), "Ravi Kiran Desai");
        // Nothing to vouch for a phrase mid-sentence: better no name than a guess.
        assert.equal(findCandidateName(doc, "jobs123@mail.com"), null);
    });

    it("reads a labelled name up to the next field", () => {
        const doc = "Name : Sneha R Patil Mobile : 9876543210 Email : sp@mail.com";
        assert.equal(findCandidateName(doc, "sp@mail.com"), "Sneha R. Patil");
    });

    it("accepts a single name or initials only when the email agrees", () => {
        assert.equal(findCandidateName("## RAHUL K\n## Summary", "rahulk@mail.com"), "Rahul K.");
        assert.equal(findCandidateName("## Ramesh.K.S", "ramesh.ks@mail.com"), "Ramesh K. S.");
        assert.equal(findCandidateName("## RAHUL K\n## Summary", "hr@mail.com"), null);
    });

    it("never takes a heading, job title or place for a name", () => {
        for (const line of ["## Software Engineer", "## Career Objective", "## Navi Mumbai", "## Areas Of Expertise"]) {
            assert.equal(findCandidateName(line, "someone@mail.com"), null, line);
        }
    });
});

describe("email templates", () => {
    it("links back to the app only for an http(s) APP_URL", () => {
        assert.ok(welcomeTemplate({ name: "Ann", appUrl: "https://sar.example.com" }).html.includes('href="https://sar.example.com"'));
        assert.equal(welcomeTemplate({ name: "Ann", appUrl: "javascript:alert(1)" }).html.includes("javascript:"), false);
        assert.equal(otpTemplate({ code: "123456" }).html.includes("<a href"), false);
    });

    it("names the product and keeps the organisation lower-case", () => {
        const { subject, text } = otpTemplate({ code: "123456" });
        assert.equal(subject, "123456 is your ikrux sign-in code");
        assert.ok(text.includes("Candidate Search & Retrieval"));
    });

    it("escapes the name in the welcome email", () => {
        const { html } = welcomeTemplate({ name: "<b>Eve</b>" });
        assert.equal(html.includes("<b>Eve</b>"), false);
    });
});
