// Adapted from the web CRM: src/lib/discovery/record-diff.ts. The type, the
// helpers, the two field lists and the comparison in `recordDiffs` are copied
// verbatim. Only the record's loading differs: the CRM reads it with SQL; the
// app reads the same row from the record's own API (camelCase) and maps it to
// the column names below (`recordFromApi`). Applying is never done here — the
// server's POST /api/discovery/[id]/apply recompares against what is stored
// and copies the fact-find's own values.

import type { DiscoveryData } from "./calc";

export type RecordDiff = {
  field: string;
  label: string;
  record: string;
  factFind: string;
  /** False for PAN: changed on the client's edit page, not from here. */
  applicable: boolean;
};

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const digits = (v: unknown) => s(v).replace(/\D/g, "").slice(-10);
const day = (v: unknown) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const t = s(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "";
};

type FieldDef = {
  field: string;
  label: string;
  /** Read the record's value. */
  rec: (r: Record<string, any>) => string;
  /** Normalise either side for comparison. */
  norm: (v: unknown) => string;
  applicable?: boolean;
};

const INVESTOR_FIELDS: FieldDef[] = [
  { field: "mobile", label: "Mobile", rec: (r) => s(r.phone), norm: digits },
  { field: "email", label: "Email", rec: (r) => s(r.email), norm: (v) => s(v).toLowerCase() },
  { field: "dob", label: "Date of birth", rec: (r) => day(r.dob), norm: day },
  { field: "city", label: "City", rec: (r) => s(r.address?.city), norm: (v) => s(v).toLowerCase() },
  { field: "occupation", label: "Occupation", rec: (r) => s(r.occupation), norm: (v) => s(v).toLowerCase() },
  { field: "nomineeName", label: "Nominee", rec: (r) => s(r.nominee_name), norm: (v) => s(v).toLowerCase() },
  { field: "nomineeRelation", label: "Nominee relation", rec: (r) => s(r.nominee_relation), norm: (v) => s(v).toLowerCase() },
  { field: "pan", label: "PAN", rec: (r) => s(r.pan).toUpperCase(), norm: (v) => s(v).toUpperCase(), applicable: false },
];
const LEAD_FIELDS: FieldDef[] = [
  { field: "mobile", label: "Mobile", rec: (r) => s(r.phone), norm: digits },
  { field: "email", label: "Email", rec: (r) => s(r.email), norm: (v) => s(v).toLowerCase() },
  { field: "city", label: "City", rec: (r) => s(r.city), norm: (v) => s(v).toLowerCase() },
  { field: "pan", label: "PAN", rec: (r) => s(r.pan).toUpperCase(), norm: (v) => s(v).toUpperCase(), applicable: false },
];

/**
 * The record as the CRM's `loadRecord` selects it (snake_case columns), from
 * the row GET /api/investors/[id] (`.investor`) or GET /api/leads/[id] returns.
 */
export function recordFromApi(subjectType: string, row: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!row) return null;
  if (subjectType === "lead") return { phone: row.phone, email: row.email, city: row.city, pan: row.pan };
  return {
    phone: row.phone,
    email: row.email,
    dob: row.dob,
    address: row.address,
    occupation: row.occupation,
    nominee_name: row.nomineeName ?? row.nominee_name,
    nominee_relation: row.nomineeRelation ?? row.nominee_relation,
    pan: row.pan,
  };
}

/**
 * Every identity field where the fact-find holds a value that differs from the
 * record. A blank in the fact-find is never a change — clearing a field is not
 * something a client does by leaving a box empty.
 */
export function recordDiffs(rec: Record<string, any> | null, subjectType: string, data: DiscoveryData): RecordDiff[] {
  if (!rec) return [];
  const ident = (data.identification ?? {}) as Record<string, unknown>;
  const out: RecordDiff[] = [];
  for (const f of subjectType === "lead" ? LEAD_FIELDS : INVESTOR_FIELDS) {
    const ff = s(ident[f.field]);
    if (!ff || ff.includes("*")) continue;
    if (f.norm(ff) === f.norm(f.rec(rec))) continue;
    out.push({ field: f.field, label: f.label, record: f.rec(rec), factFind: ff, applicable: f.applicable !== false });
  }
  return out;
}
