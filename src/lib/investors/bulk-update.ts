/**
 * "Update a field" for many clients — SERVER-ONLY (imports DB).
 *
 * Validates the value against the field registry (lib/investors/bulk-fields),
 * snapshots each client's CURRENT value of that field, then applies one
 * set-based UPDATE. The snapshot goes into the audit row, so a mistaken mass
 * update can be traced and put back client by client.
 *
 * Like the other bulk actions, this writes no investor.updated events: a mass
 * edit of thousands of clients must not fire thousands of automations.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { BULK_FIELD_BY_KEY, BULK_TEXT_MAX, type BulkField } from "./bulk-fields";

export class BulkFieldError extends Error {
  status = 400;
}

/** Plain columns: registry key → investors column. */
const COLUMN: Record<string, string> = {
  branch: "branch_id",
  status: "status",
  segment: "segment_tag",
  category: "client_category",
  investorType: "investor_category",
  residency: "residency_status",
  tier: "service_tier",
  statementCadence: "statement_cadence",
  language: "language_pref",
  nextReview: "next_review_at",
  onboardedAt: "onboarded_at",
  occupation: "occupation",
  incomeRange: "income_range",
  taxStatus: "tax_status",
};

const ADDRESS_KEYS = new Set(["city", "state", "country"]);
const REVIEW_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

/** Validate and normalise; returns the value to write (null = clear). */
async function normalise(tx: Tx, tenantId: string, f: BulkField, raw: unknown): Promise<string | null> {
  if (raw === null || raw === undefined) {
    if (!f.nullable) throw new BulkFieldError(`${f.label} can't be left empty.`);
    return null;
  }
  if (typeof raw !== "string") throw new BulkFieldError("Invalid value.");
  const v = raw.trim();
  switch (f.kind) {
    case "enum":
      if (!f.options?.some((o) => o.value === v)) throw new BulkFieldError(`Choose a ${f.label.toLowerCase()} from the list.`);
      return v;
    case "date": {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
      if (!ok) throw new BulkFieldError("Enter a valid date.");
      return v;
    }
    case "branch": {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new BulkFieldError("Choose a branch.");
      const found = await tx.execute(sql`SELECT 1 FROM branches WHERE id = ${v}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`);
      if (found.rows.length === 0) throw new BulkFieldError("That branch is not in this firm.");
      return v;
    }
    case "text":
    case "tag":
      if (!v) throw new BulkFieldError(f.nullable ? `Enter a ${f.label.toLowerCase()}, or choose to clear it.` : "Enter a tag.");
      if (v.length > BULK_TEXT_MAX) throw new BulkFieldError(`Keep it under ${BULK_TEXT_MAX} characters.`);
      return v;
  }
}

/** The SQL that reads the field's current value (for the audit snapshot). */
function currentValueSql(key: string): SQL {
  if (COLUMN[key]) return sql.raw(`${COLUMN[key]}::text`);
  if (ADDRESS_KEYS.has(key)) return sql.raw(`address->>'${key}'`);
  if (key === "reviewFrequency") return sql.raw(`jsonb_build_object('review_frequency', review_frequency, 'review_frequency_days', review_frequency_days, 'next_review_at', next_review_at)::text`);
  if (key === "tagAdd" || key === "tagRemove") return sql.raw(`tags::text`);
  throw new BulkFieldError("Unknown field.");
}

/** The SET clause for the field. `v` is already validated. */
function setSql(key: string, v: string | null): SQL {
  if (key === "branch") return sql`branch_id = ${v}::uuid`;
  if (key === "nextReview") return sql`next_review_at = ${v}::date::timestamptz`;
  if (key === "onboardedAt") return sql`onboarded_at = ${v}::date::timestamptz`;
  if (COLUMN[key]) return sql`${sql.raw(COLUMN[key])} = ${v}`;
  if (ADDRESS_KEYS.has(key)) {
    // Only this key of the jsonb address changes; line1 / pincode etc. stay.
    return v == null
      ? sql`address = CASE WHEN address IS NULL THEN NULL ELSE address - ${key}::text END`
      : sql`address = jsonb_set(COALESCE(address, '{}'::jsonb), ${`{${key}}`}::text[], to_jsonb(${v}::text), true)`;
  }
  if (key === "reviewFrequency") {
    if (v == null) return sql`review_frequency = NULL`;
    // Mirrors computeNextReview(): the preset replaces any custom day count,
    // and the next review runs from the client's own last review (else
    // onboarding, else today).
    const months = REVIEW_MONTHS[v];
    return sql`review_frequency = ${v}, review_frequency_days = NULL,
      next_review_at = COALESCE(last_review_at, onboarded_at, now()) + make_interval(months => ${months}::int)`;
  }
  if (key === "tagAdd") {
    return sql`tags = CASE WHEN COALESCE(tags, '[]'::jsonb) @> jsonb_build_array(${v}::text)
      THEN tags ELSE COALESCE(tags, '[]'::jsonb) || jsonb_build_array(${v}::text) END`;
  }
  if (key === "tagRemove") return sql`tags = COALESCE(tags, '[]'::jsonb) - ${v}::text`;
  throw new BulkFieldError("Unknown field.");
}

export async function applyBulkField(
  tx: Tx,
  args: { tenantId: string; ids: string[]; field: string; value: unknown }
): Promise<{ updated: number; value: string | null; before: Record<string, string | null> }> {
  const f = BULK_FIELD_BY_KEY.get(args.field);
  if (!f) throw new BulkFieldError("That field can't be updated in bulk.");
  const value = await normalise(tx, args.tenantId, f, args.value);

  // Tenant predicate as defence-in-depth (RLS already scopes); clients in the
  // Trash are never touched.
  const scope = sql`tenant_id = ${args.tenantId}::uuid AND deleted_at IS NULL
    AND id IN (${sql.join(args.ids.map((id) => sql`${id}::uuid`), sql`, `)})`;

  const beforeRows = (await tx.execute(sql`
    SELECT id, ${currentValueSql(f.key)} AS v FROM investors WHERE ${scope}
  `)).rows as Array<{ id: string; v: string | null }>;

  const res = await tx.execute(sql`
    UPDATE investors SET ${setSql(f.key, value)}, updated_at = now()
     WHERE ${scope}
    RETURNING id
  `);

  return {
    updated: res.rows.length,
    value,
    before: Object.fromEntries(beforeRows.map((r) => [String(r.id), r.v ?? null])),
  };
}
