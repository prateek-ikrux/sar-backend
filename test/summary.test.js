import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findCandidateName } from "../src/services/candidateName.js";
import welcomeTemplate from "../src/templates/welcome.template.js";
import otpTemplate from "../src/templates/otp.template.js";

// Shapes seen in the real library (converted PDFs); the names are made up.
describe("findCandidateName", () => {
    it("finds the name on a heading line, without contact details", () => {
        const doc = "# Priya Sharma | priya@example.com | +91 98765 43210\n\n## Summary\nBackend engineer.";
        assert.equal(findCandidateName(doc, "priya.s@example.com"), "Priya Sharma");
    });

    it("returns null for an empty resume", () => {
        assert.equal(findCandidateName("", "priya@example.com"), null);
    });

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
