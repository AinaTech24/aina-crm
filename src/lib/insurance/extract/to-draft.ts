/**
 * Step 7 (final): map the sanitized, entity-separated StructuredExtraction onto
 * the form's existing `InsuranceExtraction` draft shape — so the redesigned
 * pipeline is a drop-in replacement that the current new-policy form consumes
 * unchanged. Auto-fill confidence is carried through per field.
 *
 * Auto-fill policy (matches the spec):
 *   conf ≥ 0.90 → trusted auto-fill
 *   0.70–0.89   → filled but flagged for review (low fieldConfidence)
 *   < 0.70      → already dropped to null upstream (never guessed)
 */

import type { InsuranceExtraction, InsuranceCategory } from "@/lib/ai/assistant";
import { POLICY_TYPES, PREMIUM_FREQUENCIES } from "@/db/schema";
import { paymentsPerYear } from "@/lib/insurance/premium";
import type { Field, StructuredExtraction, TableRow } from "./types";

const v = <T>(f?: Field<T>): T | null => (f && f.value != null ? f.value : null);

/**
 * Map a free-text policy type onto our enum. Specific words win, in this order,
 * so "Term Life" is term (not life_other) and "Critical Illness" is not "health".
 * Exported for the tests.
 */
export function toPolicyType(s: string | null, kind: string): (typeof POLICY_TYPES)[number] | null {
  const norm = (s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (norm) {
    const exact = (POLICY_TYPES as readonly string[]).find((t) => t.replace(/_/g, " ") === norm);
    if (exact) return exact as (typeof POLICY_TYPES)[number];
    const rules: Array<[RegExp, (typeof POLICY_TYPES)[number]]> = [
      [/critical illness|dread disease/, "critical_illness"],
      [/personal accident|accidental/, "personal_accident"],
      [/\bulip\b|unit linked/, "ulip"],
      [/money back/, "money_back"],
      [/endowment|savings|guaranteed (?:income|return)/, "endowment"],
      [/\bterm\b|protect|raksha/, "term"],
      [/health|mediclaim|hospital|family floater|senior citizen/, "health"],
      [/motor|vehicle|\bcar\b|two wheeler|bike|private car/, "motor"],
      [/travel/, "travel"],
      [/\bhome\b|householder|property|fire/, "home"],
    ];
    for (const [re, t] of rules) if (re.test(norm)) return t;
  }
  const byKind: Record<string, string> = { life: "life_other", health: "health", motor: "motor", travel: "travel" };
  return (byKind[kind] as any) ?? null;
}

/**
 * Map the printed premium mode onto our enum. "Half-yearly" and "Semi-annual"
 * are semi_annual — they both CONTAIN "yearly" / "annual", which used to send
 * them to annual (and a half-yearly premium was then read as a whole year's).
 * Exported for the tests.
 */
export function toFreq(s: string | null): (typeof PREMIUM_FREQUENCIES)[number] | null {
  if (!s) return null;
  const n = s.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/single|one ?time|lump ?sum|\bsp\b/.test(n)) return "single";
  if (/half|semi|6 ?month|six ?month|bi ?annual|\bhy\b/.test(n)) return "semi_annual";
  if (/quarter|3 ?month|three ?month|\bqtr?\b/.test(n)) return "quarterly";
  if (/month|\bmly\b/.test(n)) return "monthly";
  if (/annual|year|12 ?month|per annum|\bp ?a\b|yly/.test(n)) return "annual";
  return null;
}
function toBiz(s: string | null): "new" | "renewal" | "portability" | null {
  if (!s) return null;
  const n = s.toLowerCase();
  return /renew/.test(n) ? "renewal" : /port/.test(n) ? "portability" : /new|fresh/.test(n) ? "new" : null;
}

const mapRows = (rows: TableRow[], map: Record<string, string>): TableRow[] =>
  rows.map((r) => {
    const out: TableRow = {};
    for (const [from, to] of Object.entries(map)) out[to] = (r[from] ?? null) as string | null;
    return out;
  });

export function structuredToDraft(x: StructuredExtraction): InsuranceExtraction {
  const p = x.policy, ph = x.policyholder, pr = x.proposer, ag = x.agency, rc = x.receipt, ps = x.premiumSummary;
  const policyType = toPolicyType(v(p.policyType), x.documentKind);
  const category: InsuranceCategory | null =
    x.documentKind === "life" ? "life" : x.documentKind === "health" ? "health" : x.documentKind === "motor" ? "motor" : ["travel", "general", "policy_schedule"].includes(x.documentKind) ? "general" : null;

  const details: Record<string, unknown> = {
    // Policyholder
    holderName: v(ph.name), customerId: v(ph.customerId), uin: v(ph.uin),
    email: v(ph.email), mobile: v(ph.mobile),
    addressLine1: v(ph.address), city: v(ph.city), state: v(ph.state), postalCode: v(ph.postalCode), country: v(ph.country) ?? "India",
    // Proposer
    proposerStatus: v(pr.status), proposerCustomerId: v(pr.customerId), proposerPhone: v(pr.phone), proposerEmail: v(pr.email),
    proposerAddressLine1: v(pr.address), proposerCity: v(pr.city), proposerState: v(pr.state), proposerPostalCode: v(pr.postalCode), proposerCountry: v(pr.country),
    proposerRemarks: v(pr.remarks),
    // Agency / agent (emit both legacy + new keys so whichever the form reads is filled)
    agencyCode: v(ag.agencyCode), agencyName: v(ag.agencyName), agentName: v(ag.agentName),
    agencyEmail: v(ag.agentEmail), agentEmail: v(ag.agentEmail), agencyContact: v(ag.agentPhone), agentPhone: v(ag.agentPhone),
    // Receipt
    receiptNo: v(rc.receiptNumber), receiptDate: v(rc.receiptDate), businessChannel: v(rc.businessChannel),
    taxInvoiceNo: v(rc.taxInvoiceNumber), taxInvoiceDate: v(rc.taxInvoiceDate), gstin: v(rc.gstin), receiptPan: v(rc.pan),
    paymentDetails: v(rc.paymentDetails),
    // Premium summary + commission
    financialYear: v(ps.financialYear), eightyDAmount: v(ps.eightyDAmount), grossPremium: v(ps.grossPremium),
    commission: v(p.commission), nomineeSharePercent: v(x.nominee.sharePercent),
    // Tables — mapped to the form's expected row-key names
    insuredMembers: mapRows(x.insuredMembers, { name: "name", customerId: "customerId", plan: "planOpted", subPlan: "subPlanOpted", gender: "gender", dob: "dob", age: "age", relation: "relation", firstInceptionDate: "firstInceptionDate", insuredAddress: "insuredAddress", nomineeRelation: "nominee" }),
    sumInsuredCovers: mapRows(x.sumInsured, { member: "memberName", cover: "cover", sumInsured: "sumInsured", cb: "cb", cbAmount: "cbAmount", limit: "limit", notes: "notes" }),
    // Optional covers is a member-row × dynamic-cover-column matrix — pass the
    // rows through as-is (already cleaned) so the per-cover keys survive.
    optionalCovers: (x.optionalCovers ?? []) as TableRow[],
    premiumBreakdown: mapRows(x.premiumDetails, { description: "description", amount: "amount" }),
    exclusions: mapRows(x.exclusions, { member: "memberName", exclusion: "exclusion" }),
  };
  // Drop null detail scalars so they don't overwrite anything the RM already typed.
  for (const k of Object.keys(details)) if (details[k] == null) delete details[k];

  // Per-field confidence for the form's review highlighting.
  const fc: Record<string, number> = {};
  const put = (key: string, f?: Field<any>) => { if (f && f.value != null) fc[key] = f.confidence; };
  put("insurer", p.insurer); put("planName", p.planName); put("policyNumber", p.policyNumber);
  put("sumAssured", p.sumAssured); put("annualPremium", p.annualPremium ?? p.installmentPremium); put("policyStartDate", p.policyStartDate);
  put("maturityDate", p.maturityDate); put("nextPremiumDueDate", p.renewalDate);
  put("holderName", ph.name); put("email", ph.email); put("mobile", ph.mobile); put("addressLine1", ph.address);
  put("proposerName", pr.name); put("proposerPan", pr.pan); put("proposerEmail", pr.email); put("proposerPhone", pr.phone);
  put("agencyEmail", ag.agentEmail); put("agencyContact", ag.agentPhone); put("gstin", rc.gstin); put("nomineeName", x.nominee.name);

  // The figure printed for one payment and the year's figure must agree; when
  // they do not, say so rather than fill one silently.
  const freq = toFreq(v(p.premiumFrequency));
  const inst = v(p.installmentPremium), annual = v(p.annualPremium);
  const premiumWarnings: string[] = [];
  if (inst != null && annual != null && freq) {
    const expected = inst * paymentsPerYear(freq);
    if (Math.abs(expected - annual) / Math.max(annual, 1) > 0.03) {
      premiumWarnings.push(
        `Premium: the document shows ₹${inst} per payment (${freq.replace("_", "-")}) and ₹${annual} for a year, which do not match — check the premium before saving.`,
      );
    }
  }
  if (inst == null && annual != null && !freq) {
    premiumWarnings.push("Premium frequency was not found on the document — set it so the premium reads correctly.");
  }

  return {
    insurer: v(p.insurer), planName: v(p.planName), policyNumber: v(p.policyNumber),
    policyType, category,
    sumAssured: v(p.sumAssured), annualPremium: v(p.annualPremium), installmentPremium: v(p.installmentPremium),
    premiumFrequency: toFreq(v(p.premiumFrequency)),
    premiumPayingTermYears: v(p.premiumPayingTermYears), policyTermYears: v(p.policyTermYears),
    policyStartDate: v(p.policyStartDate), maturityDate: v(p.maturityDate), nextPremiumDueDate: v(p.renewalDate),
    livesCovered: x.insuredMembers.length || null,
    nomineeName: v(x.nominee.name), nomineeRelation: v(x.nominee.relation),
    businessType: toBiz(v(p.businessType)),
    proposerName: v(pr.name), proposerPan: v(pr.pan),
    details,
    fieldConfidence: fc,
    overallConfidence: x.overallConfidence,
    warnings: [...x.warnings, ...premiumWarnings],
  };
}
