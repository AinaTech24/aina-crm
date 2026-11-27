/**
 * The risk profile PDF must never present a category-only record (no answers:
 * set directly by the adviser, imported from another CRM, or suggested from age)
 * as a questionnaire the client answered and signed. We Care Freedom Wealth,
 * 2026-11-16: imported profiles printed every question unticked and a "Client's
 * signature" line dated the import.
 */
import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { renderRiskProfilePdf, type RiskProfilePdfData } from "@/lib/risk-profile/risk-profile-pdf";

async function text(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text).replace(/\s+/g, " ");
}

const questions = [
  { key: "q7", label: "How much experience do you have with mutual funds?", options: [
    { value: "a", label: "None - this is my first time", score: 1 },
    { value: "b", label: "More than 10 years", score: 5 },
  ] },
];
const bands = [
  { id: "conservative", label: "Conservative", minScore: 1, maxScore: 2 },
  { id: "aggressive", label: "Aggressive", minScore: 3, maxScore: 5 },
] as RiskProfilePdfData["bands"];

const render = (profile: Partial<RiskProfilePdfData>) =>
  renderRiskProfilePdf({
    profile: { category: "aggressive", totalScore: 35, responses: [], questions, bands, verificationMethod: "rm_entry", markNoAnswers: true, recordedAt: "2026-11-14T12:28:00Z", ...profile },
    investor: { name: "Harsh Test" },
    brand: { displayName: "Test Wealth", arn: "123456" } as any,
    generatedAt: "2026-11-16T00:00:00Z",
  });

describe("risk profile PDF", () => {
  it("a firm WITHOUT the riskPdfNoAnswers flag keeps the original report", async () => {
    const t = await text(await render({ markNoAnswers: false }));
    expect(t).toContain("How much experience do you have");
    expect(t).toContain("Client's signature");
    expect(t).not.toContain("No questionnaire answers");
    expect(t).not.toContain("Not scored");
  });

  it("a category-only profile says so — no empty questionnaire, no score, no client signature", async () => {
    const t = await text(await render({ note: "Imported from Zoho CRM. Confirm it with the client." }));
    expect(t).toContain("No questionnaire answers are on record");
    expect(t).toContain("Note: Imported from Zoho CRM");
    expect(t).toContain("Not scored");
    expect(t).toContain("Not confirmed by the client");
    expect(t).toContain("Category only - no answers");
    expect(t).not.toContain("Client's signature");
    expect(t).not.toContain("How much experience do you have");
    expect(t).not.toContain("35");
    expect(t).not.toContain("based on the responses recorded above");
    expect(t).toContain("records a category only");
  });

  it("a provisional one is labelled provisional", async () => {
    const t = await text(await render({ provisional: true }));
    expect(t).toContain("PROVISIONAL - NOT CONFIRMED BY THE CLIENT");
    expect(t).toContain("assigned without the client's answers");
  });

  it("an answered profile prints as before: questions, score and the client's signature", async () => {
    const t = await text(
      await render({
        totalScore: 5,
        responses: [{ key: "q7", question: questions[0].label, answer: "More than 10 years", score: 5 }],
        verificationMethod: "client_link",
        signedAt: "2026-11-14T12:28:00Z",
        verification: { ip: "203.0.113.7" },
      })
    );
    expect(t).toContain("How much experience do you have");
    expect(t).toContain("Client's signature");
    expect(t).toContain("203.0.113.7");
    expect(t).not.toContain("No questionnaire answers");
    expect(t).not.toContain("Not scored");
    expect(t).toContain("based on the responses recorded above");
  });
});

describe("risk profile PDF header", () => {
  // A 1 x 1 PNG, as a data URL so nothing is fetched over the network.
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhWMzKwAAAABJRU5ErkJggg==";
  const withLogo = (logoUrl: string | null) =>
    renderRiskProfilePdf({
      profile: { category: "aggressive", totalScore: 4, responses: [], questions, bands, verificationMethod: "rm_entry" },
      investor: { name: "Harsh Test" },
      brand: { displayName: "Test Wealth", arn: "123456", logoUrl } as any,
      generatedAt: "2026-11-27T00:00:00Z",
    });

  it("draws the firm's logo beside the firm name", async () => {
    const buf = await withLogo(png);
    expect(buf.toString("latin1")).toContain("/Subtype /Image");
    expect(await text(buf)).toContain("Test Wealth");
  });

  it("keeps the name alone when the firm has no logo, or it cannot be read", async () => {
    for (const logoUrl of [null, "data:image/png;base64,bm90LWFuLWltYWdl"]) {
      const buf = await withLogo(logoUrl);
      expect(buf.toString("latin1")).not.toContain("/Subtype /Image");
      expect(await text(buf)).toContain("Test Wealth");
    }
  });
});
