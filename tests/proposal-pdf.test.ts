/**
 * The proposal PDF (lib/proposal/proposal-pdf.ts) after the 2026-10-07
 * redesign: whatever the layout does, the compliance text must survive whole —
 * the distributor statement, every disclosure, SEBI SCORES, and the AMFI
 * market-risk sentence in full on every page — and every recommendation must
 * be printed.
 */

import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { renderProposalPdf } from "@/lib/proposal/proposal-pdf";
import { MANDATORY_RISK_DISCLAIMER } from "@/lib/comms/compliance";

const brand = {
  legalName: "We Care Freedom Wealth", arn: "ARN-123456", primaryColor: "#7f0d0d",
  phone: "+918200770942", email: "info@wcfw.in", website: "https://www.example.in",
};

async function pages(buf: Buffer): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t) => t.replace(/\s+/g, " "));
}

describe("proposal PDF", () => {
  it("keeps every disclosure and the risk sentence on every page", async () => {
    const buf = await renderProposalPdf({
      brand,
      preparedBy: { name: "Pritesh Thakor", euin: "E123456" },
      proposal: {
        title: "Investment Proposal", proposalNumber: "PROP-2026-0011", recipientName: "DHruval",
        riskRating: "moderate", validUntil: "2026-11-06", preparedAt: "2026-10-07T11:02:00Z",
        products: [
          { kind: "mf", recommendationType: "sip", schemeName: "Kotak-Small Cap Fund - Growth", amcName: "Kotak Mahindra Mutual Fund", category: "Small Cap", riskRating: "very_high", planType: "regular" },
          { kind: "insurance", policyName: "HDFC Click 2 Protect Super", insurer: "HDFC Life", policyType: "term", sumAssured: 20000000, annualPremium: 24500 },
        ],
      },
      generatedAt: "2026-10-07T11:05:00Z",
    });
    const text = await pages(buf);
    const all = text.join(" ");
    for (const t of text) expect(t).toContain(MANDATORY_RISK_DISCLAIMER);
    for (const phrase of [
      "Distributor, not an investment adviser",
      "We Care Freedom Wealth is an AMFI Registered Mutual Fund Distributor (ARN-123456)",
      "EUIN E123456",
      "Commission disclosure",
      "Regular and Direct plans",
      "Scheme documents and KYC",
      "Insurance is the subject matter of solicitation",
      "SEBI SCORES (https://scores.sebi.gov.in)",
      "is valid until 06 Nov 2026",
      "I confirm that I have read this proposal",
    ]) expect(all).toContain(phrase);
    expect(all).toContain("Kotak-Small Cap Fund - Growth");
    expect(all).toContain("HDFC Click 2 Protect Super");
    // A blank required amount is said, not dashed.
    expect(all).toContain("Not specified");
  });

  it("prints every line of a long proposal, across pages", async () => {
    const schemes = Array.from({ length: 14 }, (_, i) => ({
      kind: "mf", recommendationType: "sip", schemeName: `Sample Equity Fund ${i + 1} - Regular Plan - Growth`,
      amcName: "Sample Mutual Fund", category: "Flexi Cap", riskRating: "very_high", planType: "regular",
      monthlyAmount: 5000 + i * 500, sipTermYears: 10, expectedReturn: 12, projectedCorpus: 1100000 + i * 10000,
    }));
    const buf = await renderProposalPdf({
      brand,
      proposal: { proposalNumber: "PROP-2026-0099", recipientName: "Long List", products: schemes, disclaimer: "Firm note. ".repeat(60) },
      generatedAt: "2026-10-07T11:05:00Z",
    });
    const text = await pages(buf);
    expect(text.length).toBeGreaterThan(1);
    const all = text.join(" ");
    for (let i = 1; i <= 14; i++) expect(all).toContain(`Sample Equity Fund ${i} - Regular Plan - Growth`);
    expect(all).toContain("Mutual funds: SIP (continued)");
    expect(all).toContain("Additional disclosure");
    for (const t of text) expect(t).toContain(`Page ${text.indexOf(t) + 1} of ${text.length}`);
  });
});
