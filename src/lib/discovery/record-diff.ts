/**
 * What the fact-find says that the client / lead record does not.
 *
 * A client who corrects their mobile, nominee or city in the Financial Health
 * Check used to leave the CRM record on the old value — the fact-find was a
 * dead end. The discovery page now lists each difference and the RM applies
 * the ones that are right; nothing is written without that.
 *
 * The comparison is always made SERVER-side against what is stored, never
 * against values a browser sends, so applying can only copy the fact-find's
 * own text onto the record. PAN is shown but never applied here: a PAN change
 * goes through the client's edit page, which checks the format and duplicates.
 */

import { sql } from "drizzle-orm";
import type { DiscoveryData } from "./calc";

type Tx = any;

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

async function loadRecord(tx: Tx, tenantId: string, subjectType: string, subjectId: string) {
  const q = subjectType === "lead"
    ? sql`SELECT phone, email, city, pan FROM leads WHERE id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`
    : sql`SELECT phone, email, dob, address, occupation, nominee_name, nominee_relation, pan
            FROM investors WHERE id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL LIMIT 1`;
  return ((await tx.execute(q)).rows[0] as Record<string, any> | undefined) ?? null;
}

/**
 * Every identity field where the fact-find holds a value that differs from the
 * record. A blank in the fact-find is never a change — clearing a field is not
 * something a client does by leaving a box empty.
 */
export async function recordDiffs(
  tx: Tx,
  tenantId: string,
  subjectType: string,
  subjectId: string,
  data: DiscoveryData,
): Promise<RecordDiff[]> {
  const rec = await loadRecord(tx, tenantId, subjectType, subjectId);
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

/**
 * Copy the chosen fields from the fact-find onto the record. Only fields that
 * still differ and are applicable are written. Returns what changed.
 */
export async function applyRecordDiffs(
  tx: Tx,
  tenantId: string,
  subjectType: string,
  subjectId: string,
  data: DiscoveryData,
  fields: string[],
): Promise<RecordDiff[]> {
  const wanted = new Set(fields);
  const diffs = (await recordDiffs(tx, tenantId, subjectType, subjectId, data))
    .filter((d) => d.applicable && wanted.has(d.field));
  if (!diffs.length) return [];
  const v = (f: string) => diffs.find((d) => d.field === f)?.factFind;

  if (subjectType === "lead") {
    const sets = [
      v("mobile") != null ? sql`phone = ${v("mobile")}` : null,
      v("email") != null ? sql`email = ${v("email")}` : null,
      v("city") != null ? sql`city = ${v("city")}` : null,
    ].filter(Boolean);
    await tx.execute(sql`UPDATE leads SET ${sql.join(sets as any[], sql`, `)}, updated_at = now()
      WHERE id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid`);
    return diffs;
  }

  const dob = v("dob");
  const sets = [
    v("mobile") != null ? sql`phone = ${v("mobile")}` : null,
    v("email") != null ? sql`email = ${v("email")}` : null,
    dob != null && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? sql`dob = ${dob}::date` : null,
    v("city") != null ? sql`address = COALESCE(address, '{}'::jsonb) || jsonb_build_object('city', ${v("city")}::text)` : null,
    v("occupation") != null ? sql`occupation = ${v("occupation")}` : null,
    v("nomineeName") != null ? sql`nominee_name = ${v("nomineeName")}` : null,
    v("nomineeRelation") != null ? sql`nominee_relation = ${v("nomineeRelation")}` : null,
  ].filter(Boolean);
  if (!sets.length) return [];
  await tx.execute(sql`UPDATE investors SET ${sql.join(sets as any[], sql`, `)}, updated_at = now()
    WHERE id = ${subjectId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`);
  return diffs;
}
