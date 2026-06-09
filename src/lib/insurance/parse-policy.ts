/**
 * Rule-based insurance-policy parser — NO AI.
 *
 * Takes the raw text pulled from a policy document (PDF text layer or OCR) and
 * extracts the fields the New-Policy form needs, into the exact same
 * `InsuranceExtraction` shape the old AI helper returned — so the form's
 * applyDraft() + confidence highlighting keep working unchanged.
 *
 * It is deliberately best-effort: it locates a labelled field and reads the
 * value near it. Digital PDFs + common insurer layouts fill most fields;
 * unusual layouts leave some blank for the RM to type. Confidence is modest by
 * design (heuristics, not certainty) and lower still for OCR'd images.
 */

import type { InsuranceExtraction, InsuranceCategory } from "@/lib/ai/assistant";
import { POLICY_TYPES, PREMIUM_FREQUENCIES } from "@/db/schema/insurance";

type PolicyType = (typeof POLICY_TYPES)[number];
type PremiumFrequency = (typeof PREMIUM_FREQUENCIES)[number];

const CATEGORY_BY_POLICY_TYPE: Record<PolicyType, InsuranceCategory> = {
  term: "life", ulip: "life", endowment: "life", money_back: "life", life_other: "life",
  health: "health", critical_illness: "health",
  personal_accident: "general", travel: "general", home: "general", general_other: "general",
  motor: "motor",
};

// Well-known Indian insurers — longest match wins so "ICICI Lombard" beats "ICICI".
const INSURERS = [
  "Life Insurance Corporation of India", "HDFC Life", "HDFC ERGO", "ICICI Prudential", "ICICI Lombard",
  "SBI Life", "SBI General", "Max Life", "Bajaj Allianz", "Tata AIA", "Tata AIG", "Kotak Mahindra",
  "Aditya Birla Sun Life", "Aditya Birla Health", "Star Health", "Care Health", "Niva Bupa", "PNB MetLife",
  "Canara HSBC", "IndiaFirst", "Pramerica", "Exide Life", "Aegon", "Edelweiss", "Bharti AXA", "Future Generali",
  "IFFCO Tokio", "Cholamandalam", "Royal Sundaram", "New India Assurance", "Oriental Insurance", "United India",
  "National Insurance", "ManipalCigna", "Reliance", "Shriram", "Digit", "Acko", "Aviva", "LIC",
];

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Locate any of `labels`, then read the first match of `valRe` in the ~80 chars after it. */
function grabNear(text: string, labels: string[], valRe: RegExp): string | null {
  for (const label of labels) {
    const lre = new RegExp(label, "i");
    const m = lre.exec(text);
    if (m) {
      const start = m.index + m[0].length;
      const window = text.slice(start, start + 90);
      const vm = window.match(valRe);
      if (vm) return (vm[1] ?? vm[0]).trim();
    }
  }
  return null;
}

const DATE_RE = /(\d{1,2}[\s./-][A-Za-z]{3,9}[\s./-]\d{2,4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
const AMOUNT_RE = /((?:rs\.?|inr|₹)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const NUM_RE = /([0-9]{1,3})/;
const PAN_RE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;

function toIso(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[\s./-]([A-Za-z]{3,9})[\s./-](\d{2,4})$/);
  if (m) {
    let [, d, mon, y] = m;
    const mm = MONTHS[mon.slice(0, 3).toLowerCase()];
    if (!mm) return null;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${mm}-${d.padStart(2, "0")}`;
  }
  return null;
}

function toAmount(s: string | null): number | null {
  if (!s) return null;
  // Strip the currency token (and its trailing dot, e.g. "Rs.") BEFORE parsing,
  // so "Rs. 1,00,00,000" doesn't collapse into the decimal ".10000000".
  const cleaned = s.replace(/(?:rs|inr|₹)\s*\.?/gi, "").replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toInt(s: string | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Once line breaks are flattened, a name value over-runs into the next label —
// cut at the first field-label keyword and tidy trailing punctuation.
const NAME_STOP = /\b(relationship|relation|nominee|date|pan|proposer|address|dob|age|policy|premium|sum|plan|insurer|gender|mobile|email|phone|nationality)\b/i;
function cleanName(s: string | null): string | null {
  if (!s) return null;
  let v = s.trim();
  const stop = v.search(NAME_STOP);
  if (stop > 0) v = v.slice(0, stop);
  v = v.replace(/\s{2,}/g, " ").replace(/[^A-Za-z]+$/, "").trim();
  return v.length >= 2 ? v : null;
}

function findInsurer(text: string): string | null {
  const lower = text.toLowerCase();
  let best: string | null = null;
  for (const name of INSURERS) {
    if (lower.includes(name.toLowerCase()) && (!best || name.length > best.length)) best = name;
  }
  return best;
}

function findPolicyType(text: string): PolicyType | null {
  const t = text.toLowerCase();
  if (/\bunit[\s-]*linked\b|\bulip\b/.test(t)) return "ulip";
  if (/\bmoney[\s-]*back\b/.test(t)) return "money_back";
  if (/\bendowment\b/.test(t)) return "endowment";
  if (/\bcritical illness\b/.test(t)) return "critical_illness";
  if (/\bpersonal accident\b|\bpa cover\b/.test(t)) return "personal_accident";
  if (/\btravel\b/.test(t)) return "travel";
  if (/\b(motor|private car|two wheeler|vehicle|idv|insured declared value)\b/.test(t)) return "motor";
  if (/\b(health|mediclaim|hospitali|family floater|room rent)\b/.test(t)) return "health";
  if (/\b(home|householder|property|fire|burglary)\b/.test(t)) return "home";
  if (/\b(term|protect|raksha|life cover)\b/.test(t)) return "term";
  if (/\b(life insurance|assurance|policyholder.*life)\b/.test(t)) return "life_other";
  return null;
}

function findFrequency(text: string): PremiumFrequency | null {
  const t = text.toLowerCase();
  if (/\bsingle\s*premium\b/.test(t)) return "single";
  if (/\b(half[\s-]*yearly|semi[\s-]*annual)\b/.test(t)) return "semi_annual";
  if (/\bquarterly\b/.test(t)) return "quarterly";
  if (/\bmonthly\b/.test(t)) return "monthly";
  if (/\b(yearly|annual|annually|per annum|p\.a\.)\b/.test(t)) return "annual";
  return null;
}

export function parseInsurancePolicy(rawText: string, opts: { ocr?: boolean } = {}): InsuranceExtraction {
  const text = (rawText || "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const conf: Record<string, number> = {};
  const base = opts.ocr ? 0.45 : 0.65; // OCR text is noisier → lower confidence
  const mark = (key: string, value: unknown, c = base) => {
    if (value !== null && value !== undefined && value !== "") conf[key] = c;
    return value as any;
  };

  const insurer = mark("insurer", findInsurer(text));
  const policyType = findPolicyType(text);
  if (policyType) conf.policyType = base - 0.1;
  const category: InsuranceCategory | null = policyType ? CATEGORY_BY_POLICY_TYPE[policyType] : null;

  const policyNumber = mark(
    "policyNumber",
    grabNear(text, ["policy\\s*(?:/\\s*certificate\\s*)?(?:no|number|#)", "certificate\\s*(?:no|number)"], /([A-Z0-9][A-Z0-9/\-]{4,23})/)
  );

  const planName = mark(
    "planName",
    grabNear(text, ["plan\\s*name", "product\\s*name", "plan\\s*/?\\s*product", "name of (?:the )?plan"], /([A-Za-z0-9][A-Za-z0-9 .&'\-]{3,48})/)
  );

  const sumAssured = mark(
    "sumAssured",
    toAmount(grabNear(text, ["sum\\s*assured", "sum\\s*insured", "basic\\s*sum\\s*assured", "insured\\s*declared\\s*value", "\\bidv\\b", "total\\s*sum\\s*insured"], AMOUNT_RE))
  );

  const annualPremium = mark(
    "annualPremium",
    toAmount(grabNear(text, ["annual\\s*premium", "total\\s*premium", "premium\\s*amount", "gross\\s*premium", "instal?ment\\s*premium", "modal\\s*premium", "premium\\s*payable", "premium\\s*\\(.*?\\)"], AMOUNT_RE))
  );

  const premiumFrequency = findFrequency(text);
  if (premiumFrequency) conf.premiumFrequency = base - 0.05;

  const premiumPayingTermYears = mark(
    "premiumPayingTermYears",
    toInt(grabNear(text, ["premium\\s*paying\\s*term", "premium\\s*payment\\s*term", "\\bppt\\b"], NUM_RE))
  );
  const policyTermYears = mark(
    "policyTermYears",
    toInt(grabNear(text, ["policy\\s*term", "term\\s*\\(\\s*years\\s*\\)", "\\bpt\\b"], NUM_RE))
  );

  const policyStartDate = mark(
    "policyStartDate",
    toIso(grabNear(text, ["date\\s*of\\s*commencement", "commencement\\s*date", "risk\\s*commencement\\s*date", "policy\\s*(?:start|issue)\\s*date", "date\\s*of\\s*issue", "period\\s*of\\s*insurance.*?from"], DATE_RE))
  );
  const maturityDate = mark(
    "maturityDate",
    toIso(grabNear(text, ["date\\s*of\\s*maturity", "maturity\\s*date"], DATE_RE))
  );
  const nextPremiumDueDate = mark(
    "nextPremiumDueDate",
    toIso(grabNear(text, ["next\\s*premium\\s*due\\s*date", "premium\\s*due\\s*date", "next\\s*due\\s*date", "due\\s*date\\s*of\\s*premium"], DATE_RE))
  );

  const nomineeName = mark(
    "nomineeName",
    cleanName(grabNear(text, ["name\\s*of\\s*(?:the\\s*)?nominee", "nominee\\s*name", "nominee\\s*details", "\\bnominee\\b"], /([A-Za-z][A-Za-z .]{2,40})/))
  );
  const nomineeRelation = mark(
    "nomineeRelation",
    grabNear(text, ["relationship\\s*with\\s*(?:life\\s*assured|proposer|insured)?", "nominee.*?relation", "\\brelation(?:ship)?\\b"], /([A-Za-z]{3,18})/)
  );

  const proposerName = cleanName(grabNear(text, ["proposer\\s*name", "name\\s*of\\s*(?:the\\s*)?proposer"], /([A-Za-z][A-Za-z .]{2,40})/));
  const panMatch = text.match(PAN_RE);
  const proposerPan = panMatch ? panMatch[1] : null;

  // ── confidence + warnings ────────────────────────────────────────────────
  const confVals = Object.values(conf);
  const overallConfidence = confVals.length ? Number((confVals.reduce((a, b) => a + b, 0) / confVals.length).toFixed(2)) : 0;
  const filled = confVals.length;

  const warnings: string[] = [];
  if (opts.ocr) warnings.push("Read via OCR (image) — please double-check every field.");
  if (filled === 0) warnings.push("No recognisable policy fields were found — this layout may need manual entry.");
  else if (filled < 4) warnings.push(`Only ${filled} field(s) detected — please fill the rest manually.`);

  return {
    insurer,
    planName,
    policyNumber,
    policyType,
    category,
    sumAssured,
    annualPremium,
    premiumFrequency,
    premiumPayingTermYears,
    policyTermYears,
    policyStartDate,
    maturityDate,
    nextPremiumDueDate,
    livesCovered: null,
    nomineeName,
    nomineeRelation,
    businessType: null,
    proposerName: proposerName || null,
    proposerPan,
    details: {},
    fieldConfidence: conf,
    overallConfidence,
    warnings,
  };
}
