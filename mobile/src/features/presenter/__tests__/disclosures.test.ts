/**
 * Presenter mode's compliance text is the web CRM's, word for word: each
 * string is looked up in the web source it was copied from, so an edit on
 * either side that drifts fails here. And the proposal's "At a glance"
 * follows the PDF's rules.
 */

import { WEB_LIB } from "../../calculators/testing/webModules";
import {
  CALC_ILLUSTRATION_DISCLAIMER, DISCLOSURES_LEAD, ILLUSTRATIVE_NOTES, MANDATORY_RISK_DISCLAIMER, AMFI_TAGLINE,
  formatArn, proposalAtAGlance, proposalDisclosures,
} from "../disclosures";

// The app has no Node typings; the calculator tests read the web source the same way.
const nodeRequire: any = require;
const fs = nodeRequire("fs");
const path = nodeRequire("path");
const web = (rel: string): string => fs.readFileSync(path.join(WEB_LIB, rel), "utf8");
const PDF = web("proposal/proposal-pdf.ts");

/** The string literals of `const NAME = "…" + "…";` (ending at `";` + newline), joined. */
function constant(src: string, name: string): string {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = src.indexOf("\";\n", start) >= 0 ? src.indexOf("\";\n", start) + 1 : src.indexOf("\";\r\n", start) + 1;
  return [...src.slice(start, end).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("");
}

describe("presenter compliance text is verbatim", () => {
  it("the AMFI market-risk sentence", () => {
    expect(constant(web("comms/compliance.ts"), "MANDATORY_RISK_DISCLAIMER")).toBe(MANDATORY_RISK_DISCLAIMER);
  });
  it("the calculator illustration disclaimer", () => {
    expect(constant(web("calculators/calc-pdf.ts"), "DISCLAIMER")).toBe(CALC_ILLUSTRATION_DISCLAIMER);
  });
  it("the tagline, the lead line and the illustrative notes", () => {
    expect(constant(PDF, "TAGLINE")).toBe(AMFI_TAGLINE);
    expect(PDF).toContain(`"${DISCLOSURES_LEAD}"`);
    for (const n of ILLUSTRATIVE_NOTES) expect(PDF).toContain(`"${n}"`);
  });
  it("every Important disclosure, heading and body", () => {
    const all = proposalDisclosures({
      firm: "${firm}", arn: null, products: [{ kind: "mf" }, { kind: "insurance" }, { kind: "pms" }, { kind: "other" }],
      email: null, phone: null, proposalDate: "2026-11-21", validUntil: null, disclaimer: "Firm text",
    });
    expect(all.map(([h]) => h)).toEqual([
      "Distributor, not an investment adviser", "Market risk", "Illustrations are not promises", "Commission disclosure",
      "Regular and Direct plans", "Suitability and risk-o-meter", "Scheme documents and KYC", "Insurance", "PMS and AIF",
      "Other products", "Grievance redressal", "Validity", "Additional disclosure",
    ]);
    for (const [head, body] of all) {
      expect(PDF).toContain(`["${head}",`);
      if (head === "Additional disclosure") continue;
      // Every fixed run of words in the body appears in the PDF source as written.
      const fixed = body
        .replace(/^\$\{firm\} is an AMFI Registered Mutual Fund Distributor\./, "")
        .replace("Mutual fund investments are subject to market risks. Read all scheme related documents carefully.", "")
        .split(/21 Nov 2026|\$\{firm\}|please contact us/)
        .map((s) => s.trim())
        .filter((s) => s.length > 12);
      for (const run of fixed) expect([head, PDF.includes(run.replace(/^\.\s*/, ""))]).toEqual([head, true]);
    }
  });
  it("names the firm, its ARN once, and its contact in the grievance line", () => {
    const all = proposalDisclosures({
      firm: "Acme Wealth", arn: "arn 90577", products: [{ kind: "mf" }], email: "help@acme.in", phone: "+91 98200 00000",
      proposalDate: "2026-11-21", validUntil: "2026-12-21", disclaimer: null,
    });
    const body = (h: string) => all.find(([x]) => x === h)?.[1];
    expect(body("Distributor, not an investment adviser")).toMatch(/^Acme Wealth is an AMFI Registered Mutual Fund Distributor \(ARN-90577\)\. We are not registered/);
    expect(body("Grievance redressal")).toContain("please contact us at help@acme.in or +91 98200 00000.");
    expect(body("Validity")).toBe("This proposal reflects market conditions and the information available on 21 Nov 2026 and is valid until 21 Dec 2026. It is not an offer or solicitation to buy or sell any security.");
    expect(all.map(([h]) => h)).not.toContain("Insurance");
    expect([formatArn("90577"), formatArn("ARN-90577"), formatArn("arn 90577"), formatArn(null)]).toEqual(["ARN-90577", "ARN-90577", "ARN-90577", ""]);
  });
});

describe("At a glance (the proposal PDF's tiles)", () => {
  it("adds one-time money, the monthly SIP, the premium and the illustrative value", () => {
    const tiles = proposalAtAGlance([
      { kind: "mf", recommendationType: "sip", monthlyAmount: 10000, projectedCorpus: 2500000, lumpsum: 100000 },
      { kind: "mf", recommendationType: "lumpsum", lumpsum: 500000, expectedReturn: 12, sipTermYears: 10 },
      { kind: "insurance", annualPremium: 25000 },
    ], {});
    expect(tiles).toEqual([
      { label: "One-time investment", value: 600000 },
      { label: "Monthly SIP", value: 10000, sub: "per month" },
      { label: "Insurance premium", value: 25000, sub: "per year" },
      { label: "Illustrative value*", value: 2500000 + Math.round(500000 * Math.pow(1.12, 10)), sub: "at assumed returns" },
    ]);
  });
  it("falls back to the proposal's totals with no lines", () => {
    expect(proposalAtAGlance([], { totalInvestment: "100000", expectedCorpus: "250000" })).toEqual([
      { label: "One-time investment", value: 100000 },
      { label: "Illustrative value*", value: 250000, sub: "at assumed returns" },
    ]);
  });
});
