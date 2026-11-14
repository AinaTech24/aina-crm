/**
 * Client types — the app's copy of the CRM's src/lib/investors/client-types.ts
 * (the firm's request of 2026-10-12). The client master asks for what each
 * type of investor needs; keep the keys, labels and lists equal to the web's.
 *
 *   person  Individual · NRI · Sole proprietor · Other — personal details,
 *           joint holding, and NOMINATION (or a recorded opt-out)
 *   minor   through a guardian; DOB required and under 18; single; no nominees
 *   huf     the Karta, date formed, coparceners; single; no nominees
 *   entity  Company · LLP · Partnership · Trust · Society/AOP/BOI (+ legacy
 *           Corporate): incorporation, signatories, beneficial owners; single;
 *           no nominees
 *
 * Only individuals nominate (SEBI). The server enforces it too: a nominee list
 * sent for any other type is not written, and nominees on file are never
 * deleted.
 */

export type ClientTypeKind = "person" | "minor" | "huf" | "entity";
type Def = { key: string; label: string; kind: ClientTypeKind; legacy?: boolean; registrationLabel?: string; formedLabel?: string };

const DEFS: Def[] = [
  { key: "individual", label: "Individual", kind: "person" },
  { key: "nri", label: "NRI", kind: "person" },
  { key: "minor", label: "Minor (through guardian)", kind: "minor" },
  { key: "sole_proprietor", label: "Sole proprietorship", kind: "person" },
  { key: "huf", label: "HUF", kind: "huf" },
  { key: "company", label: "Company / body corporate", kind: "entity", registrationLabel: "CIN", formedLabel: "Date of incorporation" },
  { key: "llp", label: "LLP", kind: "entity", registrationLabel: "LLPIN", formedLabel: "Date of incorporation" },
  { key: "partnership", label: "Partnership firm", kind: "entity", registrationLabel: "Firm registration no.", formedLabel: "Date of partnership deed" },
  { key: "trust", label: "Trust", kind: "entity", registrationLabel: "Trust registration no.", formedLabel: "Date of trust deed" },
  { key: "aop_boi", label: "Society / AOP / BOI", kind: "entity", registrationLabel: "Registration no.", formedLabel: "Date of registration" },
  { key: "corporate", label: "Corporate (legacy)", kind: "entity", legacy: true, registrationLabel: "CIN", formedLabel: "Date of incorporation" },
  { key: "other", label: "Other", kind: "person" },
];
const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

export const clientTypeDef = (key?: string | null): Def => BY_KEY.get(key ?? "individual") ?? BY_KEY.get("individual")!;
export const clientTypeLabel = (key?: string | null) => (key ? BY_KEY.get(key)?.label ?? key : "Individual");
export const clientKind = (key?: string | null) => clientTypeDef(key).kind;

/** Every current type, plus a legacy one the record already has. */
export const clientTypeOptions = (current?: string | null) =>
  DEFS.filter((d) => !d.legacy || d.key === current).map((d) => ({ value: d.key, label: d.label }));

export const canNominate = (key?: string | null) => clientKind(key) === "person";
export const singleHoldingOnly = (key?: string | null) => clientKind(key) !== "person";
/** Gender, mother's name, place of birth, Aadhaar — a person's or a minor's. */
export const hasPersonalDetails = (key?: string | null) => ["person", "minor"].includes(clientKind(key));
/** Marital status, occupation, employer, anniversary, PAN–Aadhaar link — an adult's. */
export const hasAdultDetails = (key?: string | null) => clientKind(key) === "person";

/** The day a minor turns 18 (YYYY-MM-DD), or null without a date of birth. */
export function majorityDate(dob?: string | null): string | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const y = Number(dob.slice(0, 4)) + 18;
  const md = dob.slice(5, 10);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === "02-29" && !leap ? "03-01" : md}`;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const isPan = (v: string) => PAN_RE.test(v);

/** The client's own PAN from `investors.pan`, or "" when it holds an import
 *  key (`MINOR:<guardian PAN>:<NAME>`, `NOPAN:…`) — web lib/investors/pan-display. */
export function ownPan(stored?: string | null): string {
  const v = (stored ?? "").trim().toUpperCase();
  if (PAN_RE.test(v)) return v;
  const m = /^MINOR:([A-Z]{5}[0-9]{4}[A-Z])$/.exec(v);
  return m ? m[1] : "";
}

const opts = (xs: readonly (readonly [string, string])[]) => xs.map(([value, label]) => ({ value, label }));
export const GUARDIAN_RELATIONS = opts([["father", "Father"], ["mother", "Mother"], ["court_appointed", "Court-appointed guardian"]]);
export const FATCA_ENTITY_CLASSES = opts([
  ["active_nfe", "Active NFE (operating business)"],
  ["passive_nfe", "Passive NFE"],
  ["financial_institution", "Financial institution"],
  ["listed_or_related", "Listed company or its related entity"],
  ["government_or_ngo", "Government / international body / NGO"],
]);
export const NRI_ACCOUNT_TYPES = opts([["nre", "NRE (repatriable)"], ["nro", "NRO (non-repatriable)"], ["both", "Both"]]);

const COMPANY_STATUSES = [
  "Company", "Body corporate", "Overseas Corporate Body", "Foreign Institutional Investor (FII)",
  "Foreign Portfolio Investor (FPI)", "QFI – Corporate", "Financial Institution (DFI)", "Bank",
  "Insurance Company", "Mutual Fund",
];
const TAX_STATUS_BY_TYPE: Record<string, string[]> = {
  individual: ["Resident Individual"],
  nri: ["NRI – Repatriable (NRE)", "NRI – Non-repatriable (NRO)", "NRI – Others", "Person of Indian Origin (PIO)", "QFI – Individual"],
  minor: ["On behalf of minor", "NRI minor", "QFI – Minors"],
  sole_proprietor: ["Sole proprietorship"],
  huf: ["HUF"],
  company: COMPANY_STATUSES,
  corporate: COMPANY_STATUSES,
  llp: ["LLP"],
  partnership: ["Partnership firm"],
  trust: ["Trust", "Provident Fund", "Superannuation Fund", "Gratuity Fund", "Pension Fund"],
  aop_boi: ["Society", "AOP / BOI"],
  other: [],
};
const ALL_TAX_STATUSES = [...new Set([...Object.values(TAX_STATUS_BY_TYPE).flat(), "Others"])];

/** The tax statuses that fit the type (all of them for "Other"). */
export function taxStatusOptions(type?: string | null): string[] {
  const own = TAX_STATUS_BY_TYPE[clientTypeDef(type).key] ?? [];
  return own.length ? own : ALL_TAX_STATUSES;
}
/** The tax status a new record of this type starts with. */
export const defaultTaxStatus = (type?: string | null) => TAX_STATUS_BY_TYPE[clientTypeDef(type).key]?.[0] ?? "";

export const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"];
export const HOUSEHOLD_TYPES = ["Individual", "Family", "Company", "HUF"];
export const CONTACT_OWNERS = ["Self", "Spouse", "Dependent children", "Dependent parents", "Dependent siblings", "Guardian"];
export const NOMINEE_RELATIONS = [
  "Spouse", "Son", "Daughter", "Father", "Mother", "Brother", "Sister", "Grandson", "Granddaughter",
  "Grandfather", "Grandmother", "Son-in-law", "Daughter-in-law", "Nephew", "Niece", "Other",
];
export const COPARCENER_RELATIONS = ["Spouse", "Son", "Daughter", "Grandson", "Granddaughter", "Brother", "Nephew", "Mother", "Daughter-in-law", "Other"];
export const SIGNATORY_DESIGNATIONS = [
  "Director", "Managing Director", "Whole-time Director", "Partner", "Designated Partner", "Trustee",
  "Managing Trustee", "Proprietor", "President", "Secretary", "Treasurer", "Chief Financial Officer",
  "Company Secretary", "Authorised signatory", "Other",
];
export const BUSINESS_NATURES = [
  "Manufacturing", "Trading", "Services", "IT / software", "Financial services / investment",
  "Real estate / construction", "Healthcare", "Education", "Agriculture", "Professional services",
  "Retail", "Transport / logistics", "Hospitality", "Charitable / non-profit", "Other",
];

/** A dropdown's options with a blank first, keeping a value already on file that the list lacks. */
export function withCurrent(options: string[], current?: string | null): string[] {
  return ["", ...options, ...(current && !options.includes(current) ? [current] : [])];
}
