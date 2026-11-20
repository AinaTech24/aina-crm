/**
 * Investment Options' Zoho "Contacts" (Clients) → the CRM client. Agreed with the
 * firm on 2026-11-20:
 *
 *  - Records are read through Zoho's API (COQL), so they carry API names, not
 *    export column labels. `ioContactRow` turns one into the row the shared
 *    mapper (contacts.ts mapZohoContact) reads, and `mapIoContact` adds what the
 *    firm's Zoho holds beyond that.
 *  - The client's RM is the CFE (Zoho's "client facing executive"), not the
 *    Contact Owner — Keval Ashar owns almost every record. No CFE → Keval.
 *  - The firm's Zoho keeps the STATE in "Mailing Street" and the address lines
 *    in "Mailing Street 2" / "Mailing Street3"; "NA" means blank throughout.
 *  - The bank account number is kept masked (last four digits), as the CRM does.
 *  - Zoho's money columns (Total Investments, Current Value, SIP, XIRR) are not
 *    read: AUM and SIPs come only from the registrar feeds.
 */

import { clientTypeFromTaxStatus } from "@/lib/investors/client-types";
import {
  LEAD_SOURCE_FIELD,
  SALUTATION_FIELD,
  ZOHO_ID_FIELD,
  mapZohoContact,
  type InvestorExtra,
  type MappedContact,
  type ZohoCustomField,
} from "../contacts";
import { ageOn } from "../values";
import { IO_DEFAULT_OWNER_ID, IO_ZOHO_USERS, ioUserEmail } from "./users";

type Rec = Record<string, unknown>;

/** Zoho's "NA", "0", "-" and blanks read as nothing. */
export function na(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  const s = String(v).replace(/\s+/g, " ").trim();
  return /^(na|n\/a|-|null|0)$/i.test(s) ? "" : s;
}

const lookupName = (v: unknown): string => (v && typeof v === "object" ? na((v as { name?: unknown }).name) : "");
const lookupId = (v: unknown): string => (v && typeof v === "object" ? na((v as { id?: unknown }).id) : "");

const STATES = new Set(
  [
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat", "haryana", "himachal pradesh",
    "jharkhand", "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland", "odisha",
    "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana", "tripura", "uttar pradesh", "uttarakhand", "west bengal",
    "delhi", "new delhi", "jammu and kashmir", "jammu & kashmir", "ladakh", "puducherry", "pondicherry", "chandigarh",
    "dadra and nagar haveli", "daman and diu", "andaman and nicobar islands", "lakshadweep",
  ]
);
export const isIndianState = (v: string) => STATES.has(v.toLowerCase().replace(/\s+/g, " ").trim());

/** "GUJARAT" → "Gujarat". */
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The firm's custom client fields for its Zoho columns (created on the first import). */
export const IO_CUSTOM_FIELDS: ZohoCustomField[] = [
  ZOHO_ID_FIELD,
  LEAD_SOURCE_FIELD,
  SALUTATION_FIELD,
  { key: "cf_zoho_group_code", label: "Group Code", type: "text", column: "Group_Code" },
  { key: "cf_zoho_client_code", label: "Client Code", type: "text", column: "Client_Code" },
  { key: "cf_zoho_software_id", label: "Software ID", type: "text", column: "Software_ID" },
  { key: "cf_zoho_customer_type", label: "Customer Type", type: "text", column: "Customer_Type" },
  { key: "cf_zoho_relation_to_head", label: "Relation with Family Head", type: "text", column: "Relation_with_Family_Head" },
  { key: "cf_zoho_bank_branch", label: "Bank Branch", type: "text", column: "Branch_Name" },
  { key: "cf_zoho_micr", label: "MICR No", type: "text", column: "MICR_No" },
  { key: "cf_zoho_education", label: "Education", type: "text", column: "Education" },
  { key: "cf_zoho_preferred_mode", label: "Preferred Mode", type: "text", column: "Preferred_Mode" },
  { key: "cf_zoho_hobbies", label: "Hobbies & Interest", type: "textarea", column: "Hobbies_Interest" },
  { key: "cf_zoho_status", label: "Status (Zoho)", type: "text", column: "Status" },
  { key: "cf_zoho_engagement", label: "Active / Inactive (Zoho)", type: "text", column: "Engagement_Status" },
  { key: "cf_zoho_relationship", label: "Relationship Type", type: "text", column: "Relationship" },
  { key: "cf_zoho_ucc_status", label: "UCC Status", type: "text", column: "UCC_Status" },
  { key: "cf_zoho_nominee_status", label: "Nominee Status (Zoho)", type: "text", column: "Nominee_Status" },
  { key: "cf_zoho_product", label: "Product (Zoho)", type: "text", column: "Product" },
  { key: "cf_zoho_client_category", label: "Client Category (Zoho)", type: "text", column: "Client_Category" },
  { key: "cf_zoho_review_type", label: "Review Type (Zoho)", type: "text", column: "Review_Type" },
  { key: "cf_zoho_family_or_individual", label: "Family or Individual (Zoho)", type: "text", column: "Family_or_Individual" },
];

/** IO API-name custom fields read straight from the record (the rest are set by the shared mapper). */
const DIRECT_CUSTOM: Array<[apiName: string, key: string]> = [
  ["Group_Code", "cf_zoho_group_code"],
  ["Client_Code", "cf_zoho_client_code"],
  ["Software_ID", "cf_zoho_software_id"],
  ["Customer_Type", "cf_zoho_customer_type"],
  ["Branch_Name", "cf_zoho_bank_branch"],
  ["MICR_No", "cf_zoho_micr"],
  ["Education", "cf_zoho_education"],
  ["Hobbies_Interest", "cf_zoho_hobbies"],
  ["Status", "cf_zoho_status"],
  ["Engagement_Status", "cf_zoho_engagement"],
  ["Relationship", "cf_zoho_relationship"],
  ["UCC_Status", "cf_zoho_ucc_status"],
  ["Nominee_Status", "cf_zoho_nominee_status"],
  ["Product", "cf_zoho_product"],
];

/** The Zoho user lookup that owns the client: the CFE, else Keval Ashar. */
export function ioClientOwnerEmail(r: Rec): string {
  return ioUserEmail(r.CFE) || IO_ZOHO_USERS[IO_DEFAULT_OWNER_ID].email;
}

/** One API record → the export-shaped row mapZohoContact reads, plus the IO extras under "__io". */
export function ioContactRow(r: Rec): Rec {
  const street = na(r.Mailing_Street);
  const streetIsState = isIndianState(street);
  const state = na(r.Mailing_State) || (streetIsState ? titleCase(street) : "");
  const lines = [streetIsState ? "" : street, na(r.Mailing_Street_2), na(r.Mailing_Street3)].filter(Boolean);
  const zip = na(r.Mailing_Zip).replace(/\D/g, "");

  return {
    "Record Id": na(r.id),
    "Contact Owner": ioClientOwnerEmail(r),
    "Contact Name": na(r.Full_Name) || [na(r.First_Name), na(r.Last_Name)].filter(Boolean).join(" "),
    Email: na(r.Email),
    Mobile: na(r.Mobile),
    "Date of Birth": na(r.Date_of_Birth),
    "Pan Card No": na(r.Pan_Card_No),
    "Adhaar Card": na(r.Adhaar_Card),
    Salutation: na(r.Salutation),
    "Mailing Street": [...new Set(lines)].join(", "),
    "Mailing City": na(r.Mailing_City) ? titleCase(na(r.Mailing_City)) : na(r.Other_City),
    "Mailing State": state,
    "Mailing Zip": zip.length === 6 ? zip : "",
    "Mailing Country": na(r.Mailing_Country),
    Description: na(r.Description),
    Profession: na(r.Occupation),
    "Company Name": na(r.Company_Name),
    "Date of Onboarding": na(r.Date_of_Onboarding),
    "Family Owner.id": lookupId(r.Family_Owner),
    "Family Owner": lookupName(r.Family_Owner),
    "Referal Client Name.id": lookupId(r.Referal_Client_Name),
    "Referal Client Name": lookupName(r.Referal_Client_Name),
    "Client Category": na(r.Client_Category),
    "Review Type": na(r.Review_Type),
    "Last Meeting Date": na(r.Last_Meeting),
    "Lead Source": na(r.Lead_Source),
    "Family or Individual": na(r.Family_or_Individual),
    "CAN/IIN No": na(r.CAN_IIN_UCC),
    __io: r,
  };
}

const OCCUPATION: Record<string, string> = {
  "private sector": "Salaried",
  salaried: "Salaried",
  "public / government sector": "Salaried",
  "self employed": "Self-Employed",
  business: "Business Owner",
  professional: "Professional (Doctor/CA/Lawyer)",
  retired: "Retired",
  housewife: "Homemaker",
  student: "Student",
  agriculturist: "Other",
  "forex dealer": "Other",
};

const MARITAL: Record<string, string> = { married: "Married", unmarried: "Single", single: "Single", widow: "Widowed", divorce: "Divorced" };
const RESIDENCY: Record<string, NonNullable<InvestorExtra["residencyStatus"]>> = {
  "resident indian": "indian_resident",
  "non-resident indian": "nri",
  "overseas citizen of india": "oci",
  "foreign national": "foreign_national",
};

/** A bank account number → "XXXX1234" (the CRM never keeps the full number). */
export function maskAccount(v: string): string {
  const digits = v.replace(/\s+/g, "");
  return digits.length >= 4 ? `XXXX${digits.slice(-4)}` : "";
}

/** Map one row made by ioContactRow. */
export function mapIoContact(row: Rec, now: Date = new Date()): MappedContact {
  const m = mapZohoContact(row, now);
  const r = (row.__io ?? {}) as Rec;
  const g = (k: string) => na(r[k]);

  // Gender is its own Zoho field (the shared mapper guesses it from the salutation).
  const gender = g("Gender").toLowerCase();
  if (gender === "male") m.gender = "M";
  else if (gender === "female") m.gender = "F";
  else if (gender === "other") m.gender = "O" as MappedContact["gender"];

  // Zoho has no guardian field: a client under 18 is a Minor, held through the
  // family head (the parent in this firm's books) — only individuals nominate.
  const headName = m.familyOwnerZohoId && m.familyOwnerZohoId !== m.zohoId ? m.familyOwnerName : "";
  if (!m.isMinor && m.dob && ageOn(m.dob, now) < 18 && !/corporate/i.test(g("Customer_Type"))) {
    m.isMinor = true;
    m.investorCategory = "minor";
    m.guardianName = headName || null;
    m.nominee = null;
  }

  // Client type: tax status first, then a Corporate customer type / family field.
  const tax = g("Tax_Status");
  const corporate = /corporate/i.test(g("Customer_Type")) || /corporate/i.test(g("Family_or_Individual"));
  if (!m.isMinor) {
    const type = tax ? clientTypeFromTaxStatus(tax) : corporate ? "company" : null;
    if (type && type !== "individual") m.investorCategory = type;
  }
  if (corporate && !m.householdType) m.householdType = "Company";

  // Occupation → the CRM's own list (lib/investors/client-types.ts OCCUPATIONS).
  const occ = OCCUPATION[g("Occupation").toLowerCase()];
  if (occ) m.occupation = occ;

  const extra: InvestorExtra = {};
  const marital = MARITAL[g("Maritial_Status").toLowerCase()];
  if (marital) extra.maritalStatus = marital;
  if (g("Annual_Income")) extra.incomeRange = g("Annual_Income");
  if (tax) extra.taxStatus = tax;
  const residency = RESIDENCY[g("Residential_Status").toLowerCase()];
  if (residency) extra.residencyStatus = residency;
  for (const [api, key] of [
    ["Anniversary_Date", "anniversaryDate"],
    ["Date_of_Demise", "dateOfDemise"],
  ] as const) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(g(api))) extra[key] = g(api);
  }
  if (g("Birth_Place")) extra.birthPlace = g("Birth_Place");
  if (g("Mother_Name")) extra.motherName = g("Mother_Name");
  if (g("Mobile_Relation")) extra.mobileRelation = g("Mobile_Relation");
  if (g("Email_Relation")) extra.emailRelation = g("Email_Relation");
  const other = g("Other_Phone").replace(/\D/g, "").slice(-10);
  if (other.length === 10 && other !== m.phone) extra.alternatePhone = other;
  if (/^(single|joint|anyone)/i.test(g("Mode_of_Holding"))) extra.modeOfHolding = g("Mode_of_Holding").toLowerCase().startsWith("joint") ? "joint" : g("Mode_of_Holding").toLowerCase().startsWith("any") ? "anyone_or_survivor" : "single";

  const bankName = g("Bank_Name");
  const ifsc = g("IFSC_Code").toUpperCase();
  const masked = maskAccount(g("Account_Number"));
  if (bankName) {
    extra.bankName = bankName;
    if (ifsc) extra.bankIfsc = ifsc;
    if (masked) extra.bankAccountNumberMasked = masked;
    extra.bankAccounts = [{ bankName, ...(masked ? { accountMasked: masked } : {}), ...(ifsc ? { ifsc } : {}) }];
  }

  const kyc = g("KYC_Status").toUpperCase();
  if (kyc === "KYC VERIFIED" || kyc === "YES") extra.kycStatus = "verified";
  else if (kyc === "KYC REJECTED") extra.kycStatus = "rejected";
  const link = g("Pan_Adhaar_Link").toLowerCase();
  if (link === "yes") extra.panAadhaarLinkStatus = "linked";
  else if (link === "no") extra.panAadhaarLinkStatus = "not_linked";
  m.extra = extra;

  for (const [api, key] of DIRECT_CUSTOM) {
    const v = Array.isArray(r[api]) ? (r[api] as unknown[]).map(na).filter(Boolean).join(", ") : g(api);
    if (v) m.custom[key] = v.slice(0, 2000);
  }
  if (Array.isArray(r.Preferred_Mode) && r.Preferred_Mode.length) m.custom.cf_zoho_preferred_mode = (r.Preferred_Mode as unknown[]).map(na).filter(Boolean).join(", ");
  // TRUE / FALSE is Zoho's own "is the head" flag, not a relation.
  const rel = g("Relation_with_Family_Head");
  if (rel && !/^(true|false)$/i.test(rel)) m.custom.cf_zoho_relation_to_head = rel;
  // "A+" is not one of the CRM's A–D grades: keep Zoho's own (the shared mapper already does).
  return m;
}
