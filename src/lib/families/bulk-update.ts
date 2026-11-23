/**
 * "Update a field" for many families — SERVER-ONLY (imports DB).
 *
 * The same rules as changing ONE family (PATCH /api/families/[id]):
 *   · RM — the family's RM is the head's and every member's (setFamilyRm);
 *     clearing it removes only the family's own RM.
 *   · Review frequency / first meeting — the next review is worked out again
 *     (nextFamilyReview) and a new frequency reaches the members
 *     (applyFamilySharedDetails).
 *   · Anything that moves the RM or a review date re-scores the family's health.
 *
 * Only families whose value actually changes are written, and each gets its own
 * audit row with the previous value — one row per family, because a single row
 * holding 500 ids and values is cut to a preview by the audit payload cap.
 *
 * Like the Clients bulk actions this raises no family.updated events: a mass
 * edit must not fire hundreds of automations.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { nextFamilyReview } from "./cadence";
import { setFamilyRm } from "./head-rm";
import { applyFamilySharedDetails } from "./shared-details";
import { recomputeFamilyHealth } from "./health-persist";
import { FAMILY_BULK_FIELD_BY_KEY, FAMILY_BULK_TAG_MAX, type FamilyBulkField } from "./bulk-fields";

export class FamilyBulkError extends Error {
  status = 400;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fields whose change can move the family's health score. */
const HEALTH_KEYS = new Set(["rm", "nextReview", "reviewFrequency", "firstMeeting"]);

/** Validate and normalise; returns the value to write (null = clear). */
async function normalise(tx: Tx, tenantId: string, f: FamilyBulkField, raw: unknown): Promise<string | null> {
  if (raw === null || raw === undefined) {
    if (!f.nullable) throw new FamilyBulkError(`${f.label} can't be left empty.`);
    return null;
  }
  if (typeof raw !== "string") throw new FamilyBulkError("Invalid value.");
  const v = raw.trim();
  switch (f.kind) {
    case "enum":
      if (!f.options?.some((o) => o.value === v)) throw new FamilyBulkError(`Choose a ${f.label.toLowerCase()} from the list.`);
      return v;
    case "date": {
      // The calendar sends YYYY-MM-DD; an ISO timestamp is cut to its date.
      const d = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
      if (!d || Number.isNaN(new Date(`${d}T00:00:00Z`).getTime())) throw new FamilyBulkError("Enter a valid date.");
      return d;
    }
    case "branch": {
      if (!UUID.test(v)) throw new FamilyBulkError("Choose a branch.");
      const found = await tx.execute(sql`SELECT 1 FROM branches WHERE id = ${v}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`);
      if (found.rows.length === 0) throw new FamilyBulkError("That branch is not in this firm.");
      return v;
    }
    case "rm": {
      // A stranger's uuid would orphan the households under someone who can't
      // see them, and an offboarded person has no desk to see them on.
      if (!UUID.test(v)) throw new FamilyBulkError("Choose a relationship manager.");
      const found = await tx.execute(sql`
        SELECT 1 FROM users WHERE id = ${v}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'active' LIMIT 1
      `);
      if (found.rows.length === 0) throw new FamilyBulkError("That person is not an active member of this firm.");
      return v;
    }
    case "text":
    case "tag": {
      const max = f.maxLength ?? FAMILY_BULK_TAG_MAX;
      if (!v) throw new FamilyBulkError(f.kind === "tag" ? "Enter a tag." : `Enter ${f.label.toLowerCase()}, or choose to clear it.`);
      if (v.length > max) throw new FamilyBulkError(`Keep it under ${max} characters.`);
      return v;
    }
  }
}

type FamilyRow = {
  id: string;
  rm_id: string | null;
  branch_id: string | null;
  family_category: string | null;
  review_frequency: string | null;
  first_meeting: string | null;
  last_review_at: string | null;
  next_review: string | null;
  notes: string | null;
  tags: unknown;
  created_at: string;
};

const tagList = (r: FamilyRow): string[] => (Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : []);

/** The field's current value on a row, as text — for the "did it change" test and the audit. */
function currentValue(key: string, r: FamilyRow): string | null {
  switch (key) {
    case "rm": return r.rm_id;
    case "branch": return r.branch_id;
    case "category": return r.family_category;
    case "reviewFrequency": return r.review_frequency;
    case "nextReview": return r.next_review;
    case "firstMeeting": return r.first_meeting;
    case "notes": return r.notes;
    case "tagAdd":
    case "tagRemove": return tagList(r).join(", ") || null;
    default: throw new FamilyBulkError("Unknown field.");
  }
}

/** Would setting `value` change this family? (A no-op is neither written nor audited.) */
function changes(key: string, r: FamilyRow, value: string | null): boolean {
  if (key === "tagAdd") return !tagList(r).includes(value as string);
  if (key === "tagRemove") return tagList(r).includes(value as string);
  return (currentValue(key, r) ?? null) !== (value ?? null);
}

export async function applyFamilyBulkField(
  tx: Tx,
  args: {
    tenantId: string;
    actorUserId: string;
    ids: string[];
    field: string;
    value: unknown;
    clientMeta?: Record<string, unknown>;
  }
): Promise<{ updated: number; unchanged: number; value: string | null }> {
  const f = FAMILY_BULK_FIELD_BY_KEY.get(args.field);
  if (!f) throw new FamilyBulkError("That field can't be updated in bulk.");
  const value = await normalise(tx, args.tenantId, f, args.value);
  const idList = sql.join(args.ids.map((id) => sql`${id}::uuid`), sql`, `);

  // Tenant predicate as defence-in-depth (RLS already scopes). Dates are read
  // as text in India's calendar so they compare and audit the way people read them.
  const rows = (await tx.execute(sql`
    SELECT id, rm_id, branch_id, family_category, review_frequency,
           to_char(first_meeting_date, 'YYYY-MM-DD') AS first_meeting,
           last_review_at,
           to_char(next_review_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS next_review,
           notes, tags, created_at
      FROM families
     WHERE tenant_id = ${args.tenantId}::uuid AND id IN (${idList})
  `)).rows as unknown as FamilyRow[];

  const todo = rows.filter((r) => changes(f.key, r, value));
  const unchanged = rows.length - todo.length;
  if (todo.length === 0) return { updated: 0, unchanged, value };

  const todoIds = sql.join(todo.map((r) => sql`${r.id}::uuid`), sql`, `);
  const scope = sql`tenant_id = ${args.tenantId}::uuid AND id IN (${todoIds})`;

  switch (f.key) {
    // ── set-based ───────────────────────────────────────────────────────
    case "branch":
      await tx.execute(sql`UPDATE families SET branch_id = ${value}::uuid, updated_at = now() WHERE ${scope}`);
      break;
    case "category":
      await tx.execute(sql`UPDATE families SET family_category = ${value}, updated_at = now() WHERE ${scope}`);
      break;
    case "nextReview":
      await tx.execute(sql`UPDATE families SET next_review_at = ${value}::date::timestamptz, updated_at = now() WHERE ${scope}`);
      break;
    case "notes":
      await tx.execute(sql`UPDATE families SET notes = ${value}, updated_at = now() WHERE ${scope}`);
      break;
    case "tagAdd":
      await tx.execute(sql`UPDATE families SET tags = COALESCE(tags, '[]'::jsonb) || jsonb_build_array(${value}::text), updated_at = now() WHERE ${scope}`);
      break;
    case "tagRemove":
      await tx.execute(sql`UPDATE families SET tags = COALESCE(tags, '[]'::jsonb) - ${value}::text, updated_at = now() WHERE ${scope}`);
      break;

    // ── per family: each one runs the same rule as editing it alone ───────
    case "rm":
      for (const r of todo) {
        if (value) {
          // The head and every live member take the new RM, and the family row.
          await setFamilyRm(tx, {
            tenantId: args.tenantId,
            familyId: r.id,
            rmId: value,
            actorUserId: args.actorUserId,
            clientMeta: args.clientMeta,
          });
        } else {
          // Clearing an RM does not propagate to the members.
          await tx.execute(sql`UPDATE families SET rm_id = NULL, updated_at = now() WHERE id = ${r.id}::uuid AND tenant_id = ${args.tenantId}::uuid`);
        }
      }
      break;
    case "reviewFrequency":
    case "firstMeeting":
      for (const r of todo) {
        const frequency = f.key === "reviewFrequency" ? value : r.review_frequency;
        const firstMeeting = f.key === "firstMeeting" ? value : r.first_meeting;
        const next = nextFamilyReview({ frequency, firstMeeting, lastReview: r.last_review_at, since: r.created_at });
        await tx.execute(sql`
          UPDATE families
             SET ${f.key === "reviewFrequency" ? sql`review_frequency = ${value}` : sql`first_meeting_date = ${value}::date`},
                 ${next ? sql`next_review_at = ${next.toISOString()}::timestamptz,` : sql``}
                 updated_at = now()
           WHERE id = ${r.id}::uuid AND tenant_id = ${args.tenantId}::uuid
        `);
        // A new frequency reaches the members: the family's cadence is everyone's.
        if (f.key === "reviewFrequency" && value) {
          await applyFamilySharedDetails(tx, {
            tenantId: args.tenantId,
            familyId: r.id,
            actorUserId: args.actorUserId,
            reason: "family_review_changed",
            clientMeta: args.clientMeta,
          });
        }
      }
      break;
    default:
      throw new FamilyBulkError("Unknown field.");
  }

  // Keep the stored score (what "Health" sorts and filters by) equal to the
  // family's real state after a change that can move it.
  if (HEALTH_KEYS.has(f.key)) {
    for (const r of todo) await recomputeFamilyHealth(tx, r.id);
  }

  for (const r of todo) {
    await recordAudit(tx, {
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      action: "family.bulk_field",
      entityType: "family",
      entityId: r.id,
      before: { field: f.key, value: currentValue(f.key, r) },
      after: { field: f.key, value, bulk: true },
      ...(args.clientMeta ?? {}),
    });
  }

  return { updated: todo.length, unchanged, value };
}
