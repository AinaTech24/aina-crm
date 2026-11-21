/**
 * The compliance text the presenter shows, VERBATIM from the web CRM — never
 * shortened, never paraphrased (tests/disclosures.test.ts checks each against
 * the web source):
 *
 *  - MANDATORY_RISK_DISCLAIMER — lib/comms/compliance.ts (AMFI's sentence).
 *  - CALC_ILLUSTRATION_DISCLAIMER — lib/calculators/calc-pdf.ts, the footer of
 *    every calculator illustration the web hands a client.
 *  - the proposal's "At a glance", assumption notes and Important disclosures
 *    — lib/proposal/proposal-pdf.ts, the document the client receives.
 *
 * Pure (no React Native), so all of it is testable.
 */

import { itemMonthly, itemOneTime, recommendationType } from "../proposals/shared/items";
import { fmtDate } from "../../lib/format";

export const MANDATORY_RISK_DISCLAIMER =
  "Mutual fund investments are subject to market risks. Read all scheme related documents carefully.";

export const AMFI_TAGLINE = "AMFI Registered Mutual Fund Distributor";

export const CALC_ILLUSTRATION_DISCLAIMER =
  "This report is for illustration purposes only and is not a guarantee of returns. " +
  "Calculations are based on the inputs and assumptions provided. Mutual fund investments are " +
  "subject to market risks; read all scheme related documents carefully.";

/** The digits alone (web lib/branding/arn bareArn): "ARN-90577" → "90577". */
export function bareArn(raw: string | null | undefined): string {
  return String(raw ?? "").trim().replace(/^arn[\s\-–—]*/i, "").trim();
}

/** One way to print an ARN (web formatArn): "90577" | "arn 90577" → "ARN-90577"; none → "". */
export function formatArn(raw: string | null | undefined): string {
  const bare = bareArn(raw);
  return bare ? `ARN-${bare}` : "";
}

/* ── The proposal PDF's value helpers (proposal-pdf.ts), unchanged ── */

const n = (v: any): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null;
};
function projected(amount: any, ret: any, years: any): number | null {
  const a = Number(amount), r = Number(ret), y = Number(years);
  if (!isFinite(a) || a <= 0 || !isFinite(r) || !isFinite(y) || y <= 0) return null;
  return Math.round(a * Math.pow(1 + r / 100, y));
}
function lumpsumValue(it: any): number | null {
  return n(it.projectedCorpus) ?? projected(it.lumpsum, it.expectedReturn, it.sipTermYears);
}
function groupKey(it: any): string {
  const kind = it?.kind ?? "mf";
  return kind === "mf" ? `mf:${recommendationType(it) ?? "sip"}` : kind;
}
/** The illustrative value a line contributes to the at-a-glance total. */
export function illustrativeOf(it: any): number | null {
  const kind = groupKey(it);
  if (kind === "mf:sip") return n(it.projectedCorpus);
  if (kind === "mf:lumpsum") return lumpsumValue(it);
  if (kind === "pms" || kind === "aif") return projected(it.proposedAmount, it.expectedReturn ?? it.targetIrr, it.termYears ?? it.lockInYears);
  return null;
}

export interface GlanceTile { label: string; value: number; sub?: string }

/** The PDF's "At a glance" tiles: one-time money, monthly SIP, insurance premium, illustrative value. */
export function proposalAtAGlance(products: any[], p: { totalInvestment?: unknown; expectedCorpus?: unknown }): GlanceTile[] {
  let oneTime = 0, monthly = 0, premium = 0, illus = 0;
  for (const it of products) {
    oneTime += itemOneTime(it) ?? 0;
    monthly += itemMonthly(it) ?? 0;
    if (it?.kind === "insurance") premium += n(it.annualPremium) ?? 0;
    illus += illustrativeOf(it) ?? 0;
  }
  if (!products.length) oneTime = n(p.totalInvestment) ?? 0;
  if (!illus) illus = n(p.expectedCorpus) ?? 0;
  const tiles: GlanceTile[] = [];
  if (oneTime) tiles.push({ label: "One-time investment", value: oneTime });
  if (monthly) tiles.push({ label: "Monthly SIP", value: monthly, sub: "per month" });
  if (premium) tiles.push({ label: "Insurance premium", value: premium, sub: "per year" });
  if (illus) tiles.push({ label: "Illustrative value*", value: illus, sub: "at assumed returns" });
  return tiles;
}

/** The PDF's notes under an illustrative value. */
export const ILLUSTRATIVE_NOTES = [
  "* Illustrative values are calculated at the assumed annual rate of return shown against each recommendation, over the period stated. They do not account for taxes or exit loads.",
  "Assumed returns are not guaranteed and are not an indication of any scheme's future performance. Mutual funds do not offer assured returns; the actual value of your investment may be higher or lower.",
];

export const DISCLOSURES_LEAD = "Issued in line with SEBI and AMFI requirements for mutual fund distributors. Please read before you invest.";

export interface DisclosureArgs {
  firm: string;
  arn: string | null | undefined;
  products: any[];
  /** The firm's email and phone, as the grievance line names them. */
  email?: string | null;
  phone?: string | null;
  proposalDate: string | Date;
  validUntil?: string | null;
  disclaimer?: string | null;
}

/** The PDF's "Important disclosures", in its order, with the same conditions. */
export function proposalDisclosures(a: DisclosureArgs): Array<[string, string]> {
  const { firm, products } = a;
  const arnNo = bareArn(a.arn);
  const has = (k: string) => products.some((it) => (it?.kind ?? "mf") === k);
  const reg = `${firm} is an AMFI Registered Mutual Fund Distributor${arnNo ? ` (ARN-${arnNo})` : ""}.`;
  const items: Array<[string, string]> = [
    ["Distributor, not an investment adviser",
      `${reg} We are not registered with SEBI as an Investment Adviser or Portfolio Manager. The recommendations in this proposal are incidental to our distribution services and are not investment advice under the SEBI (Investment Advisers) Regulations, 2013.`],
    ["Market risk",
      `${MANDATORY_RISK_DISCLAIMER} Past performance may or may not be sustained in future and is not a guarantee of future returns. The value of investments and the income from them can go down as well as up.`],
    ["Illustrations are not promises",
      "Every projected or illustrative value in this proposal is computed at an assumed rate of return for illustration only. It is not guaranteed and is not an indication of future performance."],
    ["Commission disclosure",
      `${firm} receives commission from the Asset Management Companies (AMCs) of the schemes recommended, as trail commission paid out of the scheme's Total Expense Ratio (TER), in line with SEBI's transparency norms for distributors. Details of the commission payable for the recommended schemes and their competing schemes are available from us on request.`],
    ["Regular and Direct plans",
      "Schemes are offered through their Regular Plan, from which distributor commission is paid. Every scheme also has a Direct Plan with a lower expense ratio and no distributor commission, which you may choose to invest in directly with the AMC."],
    ["Suitability and risk-o-meter",
      "These recommendations are based on the risk profile and information you have shared with us. Please check each scheme's risk-o-meter and investment objective in its scheme documents and confirm that they match your own risk appetite; where a scheme sits above your risk profile, the reason is stated in this proposal."],
    ["Scheme documents and KYC",
      "Please read the Scheme Information Document (SID), Statement of Additional Information (SAI) and Key Information Memorandum (KIM) of each scheme before investing. All investments are subject to completion of KYC as required by SEBI."],
  ];
  if (has("insurance"))
    items.push(["Insurance",
      "Insurance is the subject matter of solicitation. Please read the sales brochure and policy wording carefully before concluding a sale. In Unit Linked Insurance Plans (ULIPs), the investment risk in the investment portfolio is borne by the policyholder."]);
  if (has("pms") || has("aif"))
    items.push(["PMS and AIF",
      "Portfolio Management Services and Alternative Investment Funds carry higher risk, have minimum investment requirements prescribed by SEBI and may have limited liquidity or lock-in. Please read the Disclosure Document or Private Placement Memorandum carefully before investing."]);
  if (has("other"))
    items.push(["Other products",
      "Fixed deposits, bonds and other products in this proposal are not mutual fund products. They carry the issuer's credit risk and are governed by the issuer's own terms and conditions."]);
  const contact = [a.email, a.phone].filter(Boolean).map((v) => String(v).trim()).join(" or ");
  items.push(["Grievance redressal",
    `For any query or complaint, please contact us${contact ? ` at ${contact}` : ""}. If your complaint is not resolved, you may approach the AMC concerned or lodge a complaint on SEBI SCORES (https://scores.sebi.gov.in).`]);
  items.push(["Validity",
    `This proposal reflects market conditions and the information available on ${fmtDate(a.proposalDate)}${a.validUntil ? ` and is valid until ${fmtDate(a.validUntil)}` : ""}. It is not an offer or solicitation to buy or sell any security.`]);
  if (a.disclaimer && a.disclaimer.trim()) items.push(["Additional disclosure", a.disclaimer.trim()]);
  return items;
}
