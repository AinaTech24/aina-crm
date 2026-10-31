import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_RECIPIENT,
  CONSENT_PURPOSE,
  buildNoticeSections,
  privacyContact,
  privacyNoticePath,
  readPrivacyNotice,
} from "@/lib/privacy/notice";
import { requestEvidence } from "@/lib/privacy/consent";
import { leadWelcomeBody } from "@/lib/templates/starters";
import { renderEmailHtml, renderEmailText } from "@/lib/email-designer/render";
import type { EmailDesignerBody } from "@/lib/email-designer/types";

const firm = { name: "We Care Freedom Wealth", legalName: "We Care Freedom Wealth LLP", arn: "ARN-123456", address: "Surat, Gujarat" };

describe("privacy notice settings", () => {
  it("an unset firm gets the standard notice, version 1", () => {
    const n = readPrivacyNotice({});
    expect(n).toEqual({ extraPurposes: [], extraRecipients: [], mentionsAi: true, version: 1, publishedAt: null });
    expect(readPrivacyNotice(null).version).toBe(1);
    expect(readPrivacyNotice("junk").mentionsAi).toBe(true);
  });

  it("keeps the stored version and the firm's own lines", () => {
    const n = readPrivacyNotice({ extraPurposes: ["Estate planning"], version: 3, publishedAt: "2026-10-31T00:00:00Z" });
    expect(n.version).toBe(3);
    expect(n.extraPurposes).toEqual(["Estate planning"]);
  });

  it("the privacy contact is the DPO, else the firm's own email and phone", () => {
    expect(privacyContact({ name: "Asha", email: "dpo@x.in" }, { email: "hello@x.in", phone: "99" })).toEqual({ name: "Asha", email: "dpo@x.in", phone: "99" });
    expect(privacyContact(null, { email: "hello@x.in", phone: null })).toEqual({ name: null, email: "hello@x.in", phone: null });
  });

  it("the public address is /privacy/<tenant id>", () => {
    expect(privacyNoticePath("abc")).toBe("/privacy/abc");
  });
});

describe("the notice text", () => {
  const sections = buildNoticeSections(firm, readPrivacyNotice({ extraPurposes: ["Estate planning"], extraRecipients: ["Our CA firm"] }), { name: "Asha", email: "dpo@x.in" });
  const text = JSON.stringify(sections);

  it("names the firm, its ARN once, and the Act", () => {
    expect(text).toContain("We Care Freedom Wealth (We Care Freedom Wealth LLP)");
    expect(text).toContain("ARN-123456");
    expect(text).not.toContain("ARN-ARN");
    expect(text).toContain("Digital Personal Data Protection Act, 2023");
  });

  it("covers every Rule 3 element: purposes, withdrawal, rights, contact, the Board", () => {
    const headings = sections.map((s) => s.heading);
    expect(headings).toEqual(["Who we are", "What we collect", "Why we use it", "Who we share it with", "How long we keep it", "Your rights", "Children", "Contact us"]);
    expect(text).toContain("Withdraw your consent at any time");
    expect(text).toContain("dpo@x.in");
    expect(text).toContain("Data Protection Board of India");
  });

  it("adds the firm's own purposes and recipients, and the AI line only when on", () => {
    expect(text).toContain("Estate planning");
    expect(text).toContain("Our CA firm");
    expect(text).toContain(AI_RECIPIENT);
    const off = JSON.stringify(buildNoticeSections(firm, readPrivacyNotice({ mentionsAi: false }), {}));
    expect(off).not.toContain(AI_RECIPIENT);
    expect(off).toContain("contact your relationship manager");
  });

  it("every form source has a purpose to consent to", () => {
    expect(Object.keys(CONSENT_PURPOSE).sort()).toEqual(["discovery_form", "docs_form", "lead_form"]);
  });
});

describe("evidence of consent", () => {
  it("takes the first forwarded address and the browser", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "user-agent": "Mozilla" });
    expect(requestEvidence(h)).toEqual({ ip: "1.2.3.4", userAgent: "Mozilla" });
    expect(requestEvidence(new Headers())).toEqual({ ip: null, userAgent: null });
  });
});

describe("every email footer links the notice", () => {
  const ctx = {
    variables: { name: "Ravi" },
    blankUnresolved: true,
    tenant: { displayName: "We Care", arn: "123456", privacyUrl: "https://crm.example.in/privacy/t1", privacyContact: "dpo@x.in" },
  };

  it("in the HTML and the text part", () => {
    const body = leadWelcomeBody(false) as unknown as EmailDesignerBody;
    expect(renderEmailHtml(body, ctx)).toContain('href="https://crm.example.in/privacy/t1"');
    expect(renderEmailHtml(body, ctx)).toContain("Privacy questions: dpo@x.in");
    expect(renderEmailText(body, ctx)).toContain("How we use your personal data: https://crm.example.in/privacy/t1");
  });

  it("not in a designer preview with no notice URL", () => {
    const body = leadWelcomeBody(false) as unknown as EmailDesignerBody;
    expect(renderEmailHtml(body, { ...ctx, tenant: { displayName: "We Care" } })).not.toContain("How we use your personal data");
  });
});

describe("the notice is public", () => {
  it("middleware lets /privacy/<firm> through without a session", () => {
    const src = readFileSync("src/middleware.ts", "utf8");
    const prefixes = src.slice(src.indexOf("const PUBLIC_PATH_PREFIXES"), src.indexOf("];", src.indexOf("const PUBLIC_PATH_PREFIXES")));
    expect(prefixes).toContain('"/privacy/"');
  });
});
