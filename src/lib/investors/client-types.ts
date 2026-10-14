/**
 * Client types — what kind of investor a client record is, and what the
 * client master asks for each. ONE list for the forms, the APIs, the imports
 * and every label (it used to be copied into ten places).
 *
 * The rules follow how Indian mutual fund registrations work (SEBI, the KRAs,
 * CAMS / KFintech and the BSE / NSE client masters):
 *
 *   Individual, NRI,    a person: personal details, joint holders allowed,
 *   Sole proprietor     and NOMINATION — up to the SEBI limit, or a recorded
 *                       opt-out. A sole proprietorship invests in the
 *                       proprietor's own name and PAN.
 *   NRI                 also the country of residence, an overseas address,
 *                       tax residency and foreign TIN (FATCA / CRS), and
 *                       whether money comes from an NRE or NRO account.
 *   Minor               held through a guardian: the guardian's name, PAN,
 *                       relationship (natural parent or court-appointed) and
 *                       contact. Single holding only, NO nomination, and the
 *                       record must change to Individual at 18 (a "minor to
 *                       major" change with fresh KYC and bank details).
 *   HUF                 the Karta acts for it: Karta's name, PAN and contact,
 *                       the date the HUF was formed and its coparceners.
 *                       Single holding, NO nomination.
 *   Company, LLP,       an entity: date and number of incorporation /
 *   Partnership, Trust, registration, nature of business, net worth, the
 *   Society / AOP / BOI authorised signatories and the beneficial owners
 *                       (PMLA), and its FATCA / CRS classification.
 *                       Single holding, NO nomination.
 *
 * Only individuals can nominate. The APIs enforce it: a nominee list sent
 * for any other type is not written (nothing already on file is deleted).
 *
 * Plain module, safe in the browser.
 */

import { z } from "zod";

export const CLIENT_TYPE_KEYS = [
  "individual",
  "nri",
  "minor",
  "sole_proprietor",
  "huf",
  "company",
  "llp",
  "partnership",
  "trust",
  "aop_boi",
  "corporate",
  "other",
] as const;
export type ClientType = (typeof CLIENT_TYPE_KEYS)[number];

/** How the master is laid out for a type. */
export type ClientTypeKind = "person" | "minor" | "huf" | "entity";

type Def = {
  key: ClientType;
  label: string;
  kind: ClientTypeKind;
  /** Kept for records that carry it; not offered for new ones. */
  legacy?: boolean;
  /** What the registration number is called for this entity. */
  registrationLabel?: string;
  /** What its "date of birth" is called. */
  formedLabel?: string;
};

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

export function clientTypeDef(key: string | null | undefined): Def {
  return BY_KEY.get((key ?? "individual") as ClientType) ?? BY_KEY.get("individual")!;
}

export function clientTypeLabel(key: string | null | undefined): string {
  return key ? BY_KEY.get(key as ClientType)?.label ?? key : "Individual";
}

/** The picker's options: every current type, plus a legacy one the record already has. */
export function clientTypeOptions(current?: string | null): Array<{ value: ClientType; label: string }> {
  return DEFS.filter((d) => !d.legacy || d.key === current).map((d) => ({ value: d.key, label: d.label }));
}

/** Only an individual holder can nominate (SEBI). */
export function canNominate(key: string | null | undefined): boolean {
  return clientTypeDef(key).kind === "person";
}

/** Joint holding is for individuals; everyone else holds singly. */
export function singleHoldingOnly(key: string | null | undefined): boolean {
  return clientTypeDef(key).kind !== "person";
}

/** Gender, marital status, mother's name, place of birth, Aadhaar, anniversary. */
export function hasPersonalDetails(key: string | null | undefined): boolean {
  const k = clientTypeDef(key).kind;
  return k === "person" || k === "minor";
}

/** Occupation, employer, marital status, anniversary — an adult's. */
export function hasAdultDetails(key: string | null | undefined): boolean {
  return clientTypeDef(key).kind === "person";
}

/** The day a minor turns 18 (YYYY-MM-DD), or null without a date of birth. */
export function majorityDate(dob: string | null | undefined): string | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const y = Number(dob.slice(0, 4)) + 18;
  const md = dob.slice(5, 10);
  // 29 Feb + 18 years lands on a non-leap year: the day after 28 Feb.
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === "02-29" && !leap ? "03-01" : md}`;
}

/* ─────────────────────────── the details a type adds ─────────────────────────── */

const PAN = z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN should look like ABCDE1234F");
const optPan = z.union([PAN, z.literal("")]).optional();
const optText = (max = 200) => z.string().trim().max(max).optional();
const optDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional();

export const GUARDIAN_RELATIONS = [
  ["father", "Father"],
  ["mother", "Mother"],
  ["court_appointed", "Court-appointed guardian"],
] as const;

export const FATCA_ENTITY_CLASSES = [
  ["active_nfe", "Active NFE (operating business)"],
  ["passive_nfe", "Passive NFE"],
  ["financial_institution", "Financial institution"],
  ["listed_or_related", "Listed company or its related entity"],
  ["government_or_ngo", "Government / international body / NGO"],
] as const;

export const NRI_ACCOUNT_TYPES = [
  ["nre", "NRE (repatriable)"],
  ["nro", "NRO (non-repatriable)"],
  ["both", "Both"],
] as const;

export const TypeDetailsSchema = z.object({
  guardian: z.object({
    name: optText(),
    pan: optPan,
    dob: optDate,
    relation: z.enum(["father", "mother", "court_appointed", ""]).optional(),
    mobile: optText(20),
    email: optText(),
  }).partial().optional(),
  karta: z.object({
    name: optText(),
    pan: optPan,
    dob: optDate,
    mobile: optText(20),
    email: optText(),
  }).partial().optional(),
  coparceners: z.array(z.object({ name: z.string().trim().max(200), relation: optText(60), dob: optDate })).max(40).optional(),
  entity: z.object({
    formedOn: optDate,
    registrationNo: optText(60),
    placeOfIncorporation: optText(),
    natureOfBusiness: optText(),
    netWorth: z.union([z.coerce.number().nonnegative().max(1e14), z.literal("")]).optional(),
    netWorthAsOn: optDate,
    fatcaClass: z.enum(["active_nfe", "passive_nfe", "financial_institution", "listed_or_related", "government_or_ngo", ""]).optional(),
    giin: optText(30),
  }).partial().optional(),
  signatories: z.array(z.object({
    name: z.string().trim().max(200),
    pan: optPan,
    designation: optText(80),
    mobile: optText(20),
    email: optText(),
  })).max(30).optional(),
  ubos: z.array(z.object({
    name: z.string().trim().max(200),
    pan: optPan,
    holdingPct: z.union([z.coerce.number().min(0).max(100), z.literal("")]).optional(),
  })).max(30).optional(),
  nri: z.object({
    countryOfResidence: optText(80),
    overseasAddress: optText(500),
    taxResidencyCountry: optText(80),
    foreignTin: optText(40),
    accountType: z.enum(["nre", "nro", "both", ""]).optional(),
  }).partial().optional(),
  businessName: optText(),
  /** An individual chose not to nominate (SEBI asks for nominees or a recorded opt-out). */
  nominationOptOut: z.boolean().optional(),
});
export type ClientTypeDetails = z.infer<typeof TypeDetailsSchema>;

/**
 * Keep only what this type uses, with blank rows and empty strings dropped,
 * so a record switched from HUF to Individual does not carry a Karta.
 */
export function cleanTypeDetails(type: string | null | undefined, d: ClientTypeDetails | null | undefined): ClientTypeDetails {
  const kind = clientTypeDef(type).kind;
  const src = d ?? {};
  const strip = <T extends Record<string, unknown>>(o: T | undefined): T | undefined => {
    if (!o) return undefined;
    const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null)) as T;
    return Object.keys(out).length ? out : undefined;
  };
  const rows = <T extends { name: string }>(xs: T[] | undefined) => {
    const kept = (xs ?? []).map((x) => strip(x as any) as T | undefined).filter((x): x is T => !!x && !!x.name?.trim());
    return kept.length ? kept : undefined;
  };
  const out: ClientTypeDetails = {};
  if (kind === "minor") out.guardian = strip(src.guardian);
  if (kind === "huf") {
    out.karta = strip(src.karta);
    out.coparceners = rows(src.coparceners);
    // An HUF's "date of birth" is the day it was formed.
    out.entity = strip({ formedOn: src.entity?.formedOn });
  }
  if (kind === "entity") {
    out.entity = strip(src.entity);
    out.signatories = rows(src.signatories);
    out.ubos = rows(src.ubos);
  }
  if (type === "nri") out.nri = strip(src.nri);
  if (type === "sole_proprietor" && src.businessName?.trim()) out.businessName = src.businessName.trim();
  if (kind === "person" && src.nominationOptOut) out.nominationOptOut = true;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as ClientTypeDetails;
}

/**
 * The client type a registrar's tax-status text describes (CAMS "Partnership
 * Firm", KFintech "HINDU UNDIVIDED FAMILY", BSE "On behalf of Minor" …).
 * Minor is checked first: "NRI - Minor" is a minor.
 */
export function clientTypeFromTaxStatus(text: string | null | undefined): ClientType {
  const s = (text ?? "").toLowerCase();
  if (!s.trim()) return "individual";
  if (s.includes("minor")) return "minor";
  if (s.includes("huf") || s.includes("hindu undivided")) return "huf";
  if (/\bllp\b|limited liability partnership/.test(s)) return "llp";
  if (s.includes("partnership")) return "partnership";
  if (s.includes("proprietor")) return "sole_proprietor";
  if (s.includes("trust")) return "trust";
  if (/society|\baop\b|\bboi\b|association of persons|body of individuals/.test(s)) return "aop_boi";
  if (/company|\bltd\b|limited|corporate|body corp|\bpvt\b/.test(s)) return "company";
  if (s.includes("nri") || s.includes("non resident") || s.includes("non-resident")) return "nri";
  return "individual";
}

/* ─────────────────────────── the master's dropdowns ─────────────────────────── */

/** Tax status as the registrars and exchanges word it, by client type. */
const TAX_STATUS_BY_TYPE: Record<ClientType, string[]> = {
  individual: ["Resident Individual"],
  nri: ["NRI – Repatriable (NRE)", "NRI – Non-repatriable (NRO)"],
  minor: ["On behalf of minor", "NRI minor"],
  sole_proprietor: ["Sole proprietorship"],
  huf: ["HUF"],
  company: ["Company", "Body corporate"],
  corporate: ["Company", "Body corporate"],
  llp: ["LLP"],
  partnership: ["Partnership firm"],
  trust: ["Trust"],
  aop_boi: ["Society", "AOP / BOI"],
  other: [],
};
export const ALL_TAX_STATUSES = [...new Set(Object.values(TAX_STATUS_BY_TYPE).flat())];

/** The tax statuses that fit the type (all of them for "Other"). */
export function taxStatusOptions(type: string | null | undefined): string[] {
  const own = TAX_STATUS_BY_TYPE[clientTypeDef(type).key] ?? [];
  return own.length ? own : ALL_TAX_STATUSES;
}

/** The tax status a new record of this type starts with. */
export function defaultTaxStatus(type: string | null | undefined): string {
  return TAX_STATUS_BY_TYPE[clientTypeDef(type).key]?.[0] ?? "";
}

export const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"];

/** The firm's income bands (the same labels as the income_range master). */
export const INCOME_RANGES = ["Below ₹5L", "₹5L – ₹15L", "₹15L – ₹50L", "₹50L – ₹1Cr", "₹1Cr – ₹5Cr", "Above ₹5Cr"];

export const HOUSEHOLD_TYPES = ["Individual", "Family", "Company", "HUF"];

/** Household type from the client type and whether the client is in a family. */
export function defaultHouseholdType(type: string | null | undefined, inFamily: boolean): string {
  const kind = clientTypeDef(type).kind;
  if (kind === "huf") return "HUF";
  if (kind === "entity") return "Company";
  return inFamily ? "Family" : "Individual";
}

/** A dropdown's options, keeping a value already on file that the list lacks. */
export function withCurrent(options: string[], current: string | null | undefined): string[] {
  return current && !options.includes(current) ? [...options, current] : options;
}
