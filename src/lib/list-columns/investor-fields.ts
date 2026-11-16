/**
 * Fields a person can ADD as a column on the Clients list, beyond the ones the
 * table draws by default. The list is code (one place), each field an
 * expression over `i` (investors), `u` (the RM), `b` (the branch), `f` (the
 * family) — static text, never user input. A key a cookie names that is not
 * here is dropped, so nothing outside this list can be asked for.
 *
 * Values come back as display text (dates in India time), so the table needs no
 * per-field formatting. A client's own custom fields are offered too, as
 * `cf:<key>`.
 */
import { sql } from "drizzle-orm";
import { formatINR } from "@/lib/utils";
import type { ExtraFieldDef } from "./types";

type Def = ExtraFieldDef & { expr: string; gate?: string; /** raw number text, shown as rupees */ inr?: boolean };

const D = (e: string) => `to_char(${e}, 'DD Mon YYYY')`;
const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;
const YN = (e: string) => `CASE WHEN ${e} THEN 'Yes' ELSE 'No' END`;

export const INVESTOR_EXTRA_FIELDS: Def[] = [
  // Contact
  { key: "email", label: "Email", group: "Contact", expr: "i.email", gate: "email" },
  { key: "phone", label: "Mobile", group: "Contact", expr: "i.phone", gate: "phone" },
  { key: "alt_phone", label: "Alternate mobile", group: "Contact", expr: "i.alternate_phone", gate: "phone" },
  { key: "whatsapp", label: "WhatsApp number", group: "Contact", expr: "i.whatsapp_phone", gate: "phone" },
  { key: "city", label: "City", group: "Contact", expr: "i.address->>'city'" },
  { key: "state", label: "State", group: "Contact", expr: "i.address->>'state'" },
  { key: "pincode", label: "Pincode", group: "Contact", expr: "i.address->>'pincode'" },
  { key: "address", label: "Address", group: "Contact", expr: "NULLIF(concat_ws(', ', i.address->>'line1', i.address->>'city', i.address->>'state', i.address->>'pincode'), '')" },
  // People & relationship
  { key: "rm", label: "Relationship manager", group: "Relationship", expr: "u.name" },
  { key: "branch", label: "Branch", group: "Relationship", expr: "b.name" },
  { key: "family", label: "Family", group: "Relationship", expr: "f.family_name" },
  { key: "family_role", label: "Family role", group: "Relationship", expr: "i.family_role" },
  { key: "onboarded", label: "Onboarded on", group: "Relationship", expr: TS("i.onboarded_at") },
  { key: "last_contact", label: "Last contacted", group: "Relationship", expr: TS("i.last_contact_at") },
  { key: "last_txn", label: "Last transaction", group: "Relationship", expr: TS("i.last_transaction_at") },
  { key: "last_review", label: "Last review", group: "Relationship", expr: TS("i.last_review_at") },
  { key: "next_review", label: "Next review", group: "Relationship", expr: TS("i.next_review_at") },
  { key: "review_freq", label: "Review frequency", group: "Relationship", expr: "i.review_frequency" },
  { key: "tags", label: "Tags", group: "Relationship", expr: "NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(COALESCE(i.tags, '[]'::jsonb))), ', '), '')" },
  // Personal
  { key: "dob", label: "Date of birth", group: "Personal", expr: D("i.dob") },
  { key: "gender", label: "Gender", group: "Personal", expr: "CASE i.gender WHEN 'M' THEN 'Male' WHEN 'F' THEN 'Female' WHEN 'O' THEN 'Other' END" },
  { key: "occupation", label: "Occupation", group: "Personal", expr: "i.occupation" },
  { key: "income", label: "Income range", group: "Personal", expr: "i.income_range" },
  { key: "employer", label: "Employer", group: "Personal", expr: "i.employer_name" },
  { key: "residency", label: "Residency", group: "Personal", expr: "i.residency_status" },
  { key: "language", label: "Language", group: "Personal", expr: "i.language_pref" },
  // Compliance
  { key: "kyc_validated", label: "KYC validated on", group: "Compliance", expr: D("i.kyc_validated_at") },
  { key: "kyc_remark", label: "KRA remark", group: "Compliance", expr: "i.kyc_status_remark" },
  { key: "ckyc", label: "CKYC number", group: "Compliance", expr: "i.ckyc_number" },
  { key: "fatca", label: "FATCA", group: "Compliance", expr: "i.fatca_status" },
  { key: "pan_aadhaar", label: "PAN–Aadhaar link", group: "Compliance", expr: "i.pan_aadhaar_link_status" },
  { key: "nominee", label: "Nominee", group: "Compliance", expr: "i.nominee_name" },
  { key: "mandate", label: "Mandate status", group: "Compliance", expr: "i.mandate_status" },
  { key: "ucc", label: "BSE UCC", group: "Compliance", expr: "i.bse_ucc_code" },
  { key: "risk", label: "Risk profile", group: "Compliance", expr: "i.risk_profile" },
  { key: "risk_score", label: "Risk score", group: "Compliance", expr: "i.risk_profile_score::text" },
  { key: "risk_signed", label: "Risk profile signed", group: "Compliance", expr: TS("i.risk_profile_signed_at") },
  // Money
  { key: "inflow", label: "Lifetime inflow", group: "Money", expr: "i.lifetime_inflow::text", inr: true },
  { key: "outflow", label: "Lifetime outflow", group: "Money", expr: "i.lifetime_outflow::text", inr: true },
  { key: "bank", label: "Bank", group: "Money", expr: "i.bank_name" },
  { key: "ifsc", label: "IFSC", group: "Money", expr: "i.bank_ifsc" },
  { key: "minor", label: "Minor", group: "Money", expr: YN("COALESCE(i.is_minor, false)") },
  { key: "dormant_since", label: "Dormant since", group: "Money", expr: TS("i.dormant_since") },
];

const BY_KEY = new Map(INVESTOR_EXTRA_FIELDS.map((f) => [f.key, f]));

/** Fields offered for this firm: the catalog (minus any its licence withholds) plus its custom client fields. */
export function investorExtraOptions(
  allowed: (field: string) => boolean,
  customDefs: Array<{ key: string; label: string }>,
): ExtraFieldDef[] {
  const base = INVESTOR_EXTRA_FIELDS.filter((f) => !f.gate || allowed(f.gate)).map(({ key, label, group }) => ({ key, label, group }));
  const custom = customDefs.map((c) => ({ key: `cf:${c.key}`, label: c.label, group: "Custom fields" }));
  return [...base, ...custom];
}

/** Values of the chosen fields for these clients: `{ [clientId]: { [fieldKey]: text } }`. */
export async function loadInvestorExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => {
    if (k.startsWith("cf:")) {
      const cfKey = k.slice(3);
      // The key is a bound parameter, never spliced into the text.
      return sql`(i.custom_fields ->> ${cfKey}) AS ${sql.raw(`"c${n}"`)}`;
    }
    const def = BY_KEY.get(k);
    return sql`(${sql.raw(def!.expr)}) AS ${sql.raw(`"c${n}"`)}`;
  });
  const res = await tx.execute(sql`
    SELECT i.id, ${sql.join(cols, sql`, `)}
    FROM investors i
    LEFT JOIN users u ON u.id = i.rm_id
    LEFT JOIN branches b ON b.id = i.branch_id
    LEFT JOIN families f ON f.id = i.family_id
    WHERE i.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `);
  const out: Record<string, Record<string, string>> = {};
  for (const r of res.rows as any[]) {
    const o: Record<string, string> = {};
    fields.forEach((k, n) => {
      const v = r[`c${n}`];
      if (v == null || String(v).trim() === "") return;
      o[k] = BY_KEY.get(k)?.inr ? formatINR(Number(v)) : String(v);
    });
    out[String(r.id)] = o;
  }
  return out;
}

/** Keys that exist for this firm — what a cookie's choice is checked against. */
export function allowedExtraKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
