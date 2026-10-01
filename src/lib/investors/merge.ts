/**
 * Client merge engine — the ONE place a duplicate client is folded into a
 * survivor. SERVER-ONLY.
 *
 * Three callers, identical semantics:
 *   · POST /api/investors/merge        — an operator merging a pair (source 'manual')
 *   · POST /api/investors/merge/auto   — exact-PAN groups merged unattended (source 'system')
 *   · the N-way "Merge Client" tool     — several losers into one survivor, one call each
 *
 * What a merge does, in one transaction:
 *   1. re-points every child row referencing the loser (auto-discovered from
 *      information_schema: any table with an `investor_id` column, minus a
 *      denylist) to the survivor, RECORDING the moved ids so it can be undone;
 *   2. fixes the special columns the generic pass misses (lead referrals,
 *      family head, activity subject);
 *   3. fills the survivor's blank contact fields from the loser;
 *   4. retires the loser (status 'inactive', merged_into_id, provenance) and
 *      ZEROES its cached AUM/SIP so nothing double-counts;
 *   5. logs the merge in investor_merges with everything the un-merge needs;
 *   6. recomputes the survivor's headline figures + health; audits.
 *
 * Extracted from the merge route so the system path cannot drift from the
 * manual one — a "system merge" that moved rows differently from a manual merge
 * would be impossible to un-merge with the same code.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { recomputeInvestorAum } from "@/lib/finance/aum-persist";
import { recomputeInvestorHealth } from "@/lib/investors/health-persist";

export type MergeSource = "manual" | "system" | "import";

/** Above this many moved rows we log counts only and mark the merge irreversible. */
const MOVED_ID_CAP = 20_000;

/** investor_id on these participates in a uniqueness / one-per-investor rule, or
 *  is consent/PII that shouldn't silently move; rows stay on the (inactive) loser. */
const DENYLIST = new Set(["investors", "consents", "communications", "campaigns", "risk_profiles", "onboarding"]);

/** Survivor columns an operator may take from the loser when the two disagree.
 *  Deliberately excludes `pan` — a merge must never change who the surviving
 *  record legally is. */
export const MERGEABLE_FIELDS = ["name", "phone", "email", "whatsapp_phone", "dob"] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];

export const FIELD_LABELS: Record<MergeableField, string> = {
  name: "Name",
  phone: "Mobile",
  email: "Email",
  whatsapp_phone: "WhatsApp number",
  dob: "Date of birth",
};

/** snake_case table name -> something an operator can read. */
export function tableLabel(table: string): string {
  const words = table.replace(/_/g, " ").trim();
  const cased = words.charAt(0).toUpperCase() + words.slice(1);
  return cased
    .replace(/\baum\b/gi, "AUM")
    .replace(/\bsip\b/gi, "SIP")
    .replace(/\bsips\b/gi, "SIPs")
    .replace(/\bkyc\b/gi, "KYC")
    .replace(/\bpan\b/gi, "PAN")
    .replace(/\bnav\b/gi, "NAV")
    .replace(/\brta\b/gi, "RTA");
}

/** Tables carrying investor_id, split into the ones a merge moves and the ones
 *  it deliberately leaves behind. Shared by the merge and its preview so the
 *  two can never describe different things. */
async function investorChildTables(tx: Tx): Promise<{ moves: string[]; stays: string[] }> {
  const cols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'investor_id'
    ORDER BY table_name
  `);
  const all = (cols.rows as Array<{ table_name: string }>).map((r) => r.table_name);
  return {
    moves: all.filter((t) => !DENYLIST.has(t)),
    // "investors" is the record itself, not a child row anyone thinks about.
    stays: all.filter((t) => DENYLIST.has(t) && t !== "investors"),
  };
}

export type MergeInput = {
  tenantId: string;
  survivorId: string;
  loserId: string;
  /** The user performing (or triggering) the merge. Null only for scheduled system runs. */
  byUserId: string | null;
  source: MergeSource;
  /** Matched key ("PAN") or an operator's note — shown in the merged-clients audit. */
  reason?: string | null;
  /** Request metadata for the audit row (ip / user agent), when available. */
  auditMeta?: Record<string, unknown>;
  /**
   * Take these survivor fields from the loser. Without this a merge only fills
   * fields the survivor left BLANK, so when both records hold a value the
   * loser's is discarded silently — including when the loser's is the current
   * one. Only MERGEABLE_FIELDS are honoured.
   */
  fieldOverrides?: Partial<Record<MergeableField, boolean>>;
  /**
   * Proceed even though the two records carry DIFFERENT PANs. A PAN is one
   * legal person, so this normally means two different people and the merge is
   * refused; the caller must consciously override it.
   */
  allowPanMismatch?: boolean;
};

export type MergeError =
  | "one or both clients not found"
  | "a selected record is already merged"
  | "survivor and loser must differ"
  | "different PAN";

export type MergeResult =
  | { ok: true; reassigned: number; skipped: string[]; reversible: boolean }
  | { error: MergeError; survivorPan?: string; loserPan?: string };

export async function mergeInvestors(tx: Tx, input: MergeInput): Promise<MergeResult> {
  const { tenantId, survivorId, loserId, byUserId, source } = input;
  const mergeReason = input.reason?.trim() || null;
  if (survivorId === loserId) return { error: "survivor and loser must differ" };

  const both = await tx.execute(sql`
    SELECT id, name, merged_into_id, status, upper(nullif(trim(pan), '')) AS pan,
           COALESCE(aum::numeric, 0) AS aum,
           COALESCE(active_sip_amount::numeric, 0) AS sip
      FROM investors
     WHERE tenant_id = ${tenantId}::uuid AND id IN (${survivorId}::uuid, ${loserId}::uuid)
  `);
  if (both.rows.length !== 2) return { error: "one or both clients not found" };
  if (both.rows.some((r: any) => r.merged_into_id)) return { error: "a selected record is already merged" };

  // A PAN is one legal person in India. Two records holding DIFFERENT PANs are
  // two different people, and folding one into the other moves their folios and
  // transactions onto a stranger — the one mistake this tool must not make
  // quietly. Refuse unless the caller has explicitly acknowledged it.
  const survivorPan = (both.rows as any[]).find((r) => String(r.id) === survivorId)?.pan ?? null;
  const loserPanValue = (both.rows as any[]).find((r) => String(r.id) === loserId)?.pan ?? null;
  if (survivorPan && loserPanValue && survivorPan !== loserPanValue && !input.allowPanMismatch) {
    return { error: "different PAN", survivorPan, loserPan: loserPanValue };
  }

  // Snapshot the loser as it stands — its aum / sip are zeroed below, so
  // without this an un-merge could only restore the record at 0.
  const loserRow = (both.rows as any[]).find((r) => String(r.id) === loserId);
  const loserAum = Number(loserRow?.aum ?? 0);
  const loserSip = Number(loserRow?.sip ?? 0);
  const loserStatus = loserRow?.status ?? null;

  // Tables that carry a tenant_id — a cheap second line of defence on the reassignment.
  const tcols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
  `);
  const hasTenant = new Set((tcols.rows as Array<{ table_name: string }>).map((r) => r.table_name));
  const tf = (table: string) => (hasTenant.has(table) ? sql` AND tenant_id = ${tenantId}::uuid` : sql``);

  // Child tables that reference investor_id, and which of them have an `id` we
  // can RETURN (needed to record exactly what moved). The discovery is shared
  // with previewMerge so the preview can't advertise a different set.
  const { moves: moveTables } = await investorChildTables(tx);
  const idCols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id'
  `);
  const hasId = new Set((idCols.rows as Array<{ table_name: string }>).map((r) => r.table_name));

  let reassigned = 0;
  const skipped: string[] = [];
  const moved: Record<string, string[]> = {};
  const movedCounts: Record<string, number> = {};
  let movedIdTotal = 0;
  let reversible = true;

  for (const tbl of moveTables) {
    // Per-table SAVEPOINT: a uniqueness collision skips THAT table (its rows
    // stay on the inactive loser) instead of aborting the whole merge.
    await tx.execute(sql`SAVEPOINT merge_child`);
    try {
      const canReturn = hasId.has(tbl);
      const r = await tx.execute(
        canReturn
          ? sql`UPDATE ${sql.raw(`"${tbl}"`)} SET investor_id = ${survivorId}::uuid WHERE investor_id = ${loserId}::uuid${tf(tbl)} RETURNING id`
          : sql`UPDATE ${sql.raw(`"${tbl}"`)} SET investor_id = ${survivorId}::uuid WHERE investor_id = ${loserId}::uuid${tf(tbl)}`
      );
      const ids = canReturn ? (r.rows as Array<{ id: string }>).map((x) => String(x.id)) : [];
      const n = canReturn ? ids.length : ((r as any).rowCount ?? 0);
      reassigned += n;
      if (!canReturn && n > 0) reversible = false;
      if (n > 0) {
        movedCounts[tbl] = n;
        if (movedIdTotal + ids.length <= MOVED_ID_CAP) {
          moved[tbl] = ids;
          movedIdTotal += ids.length;
        } else {
          reversible = false;
        }
      }
      await tx.execute(sql`RELEASE SAVEPOINT merge_child`);
    } catch {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT merge_child`);
      skipped.push(tbl);
    }
  }

  // Special columns the generic pass misses.
  await tx.execute(sql`UPDATE leads SET referred_by_investor_id = ${survivorId}::uuid WHERE referred_by_investor_id = ${loserId}::uuid${tf("leads")}`);
  await tx.execute(sql`UPDATE leads SET converted_investor_id = ${survivorId}::uuid WHERE converted_investor_id = ${loserId}::uuid${tf("leads")}`);
  // A family headed by the loser is headed by the survivor only if the
  // survivor is IN that family; otherwise it has no head until someone picks
  // one (it used to point at a person who belonged to another family).
  await tx.execute(sql`
    UPDATE families f
       SET primary_investor_id = CASE
             WHEN EXISTS (SELECT 1 FROM investors s WHERE s.id = ${survivorId}::uuid AND s.family_id = f.id)
             THEN ${survivorId}::uuid ELSE NULL END
     WHERE f.primary_investor_id = ${loserId}::uuid${tf("families")}`);
  await tx.execute(sql`UPDATE activities SET subject_id = ${survivorId}::uuid WHERE subject_type = 'investor' AND subject_id = ${loserId}::uuid${tf("activities")}`);

  // Snapshot the survivor's mergeable fields BEFORE anything writes to them.
  // The fill below (and any operator override) changes the surviving record,
  // and un-merge has to be able to put it back exactly as it was.
  const survivorBeforeRow = (
    await tx.execute(sql`
      SELECT name, phone, email, whatsapp_phone, dob::text AS dob
        FROM investors WHERE id = ${survivorId}::uuid
    `)
  ).rows[0] as Record<string, unknown> | undefined;
  const survivorBefore = survivorBeforeRow
    ? Object.fromEntries(MERGEABLE_FIELDS.map((f) => [f, survivorBeforeRow[f] ?? null]))
    : null;

  // Fill the survivor's blank contact fields from the loser.
  await tx.execute(sql`
    UPDATE investors s SET
      phone = COALESCE(s.phone, l.phone),
      email = COALESCE(s.email, l.email),
      whatsapp_phone = COALESCE(s.whatsapp_phone, l.whatsapp_phone),
      dob = COALESCE(s.dob, l.dob),
      updated_at = now()
    FROM investors l
    WHERE s.id = ${survivorId}::uuid AND l.id = ${loserId}::uuid
  `);

  // Then apply the operator's explicit picks, which OVERWRITE a value the
  // survivor already had (the COALESCE above can only fill blanks). This is how
  // "the duplicate has their current mobile" gets resolved.
  const picked = (Object.keys(input.fieldOverrides ?? {}) as MergeableField[]).filter(
    (f) => input.fieldOverrides?.[f] && (MERGEABLE_FIELDS as readonly string[]).includes(f)
  );
  if (picked.length) {
    // Each field falls back to the survivor's own value when the loser's is
    // blank, so picking two fields where only one is populated can never blank
    // out the other.
    const assignments = picked.map((f) => {
      const col = sql.raw(`"${f}"`);
      return f === "dob"
        ? sql`${col} = COALESCE(l.${col}, s.${col})`
        : sql`${col} = COALESCE(NULLIF(trim(l.${col}), ''), s.${col})`;
    });
    await tx.execute(sql`
      UPDATE investors s SET ${sql.join(assignments, sql`, `)}, updated_at = now()
      FROM investors l
      WHERE s.id = ${survivorId}::uuid AND l.id = ${loserId}::uuid
    `);
  }

  // Retire the loser and ZERO its cached headline figures — its folios and SIPs
  // now belong to the survivor, so leaving them would double-count the money.
  await tx.execute(sql`
    UPDATE investors
       SET status = 'inactive', merged_into_id = ${survivorId}::uuid, merged_at = now(),
           merged_by_id = ${byUserId ? sql`${byUserId}::uuid` : sql`NULL`}, merge_source = ${source},
           merge_reason = ${mergeReason},
           aum = 0, active_sip_amount = 0, updated_at = now()
     WHERE id = ${loserId}::uuid
  `);

  // Log the merge with everything needed to undo it.
  await tx.execute(sql`
    INSERT INTO investor_merges (
      tenant_id, survivor_id, loser_id, merged_by_id, source, reason,
      loser_aum, loser_sip_amount, loser_status,
      moved, moved_counts, reversible, survivor_before
    ) VALUES (
      ${tenantId}::uuid, ${survivorId}::uuid, ${loserId}::uuid,
      ${byUserId ? sql`${byUserId}::uuid` : sql`NULL`}, ${source}, ${mergeReason},
      ${loserAum}, ${loserSip}, ${loserStatus},
      ${JSON.stringify(moved)}::jsonb, ${JSON.stringify(movedCounts)}::jsonb, ${reversible},
      ${survivorBefore ? sql`${JSON.stringify(survivorBefore)}::jsonb` : sql`NULL`}
    )
  `);

  // The survivor just absorbed folios / transactions / SIPs — refresh its
  // cached figures + health so lists and KPIs don't lag until the nightly run.
  await recomputeInvestorAum(tx, survivorId);
  await recomputeInvestorHealth(tx, survivorId);

  await recordAudit(tx, {
    tenantId,
    actorUserId: byUserId ?? undefined,
    action: source === "manual" ? "investor.merge" : "investor.merge.system",
    entityType: "investor",
    entityId: survivorId,
    after: { survivorId, loserId, source, reason: mergeReason, childRowsReassigned: reassigned, skippedTables: skipped } as any,
    ...(input.auditMeta ?? {}),
  } as any);

  return { ok: true, reassigned, skipped, reversible };
}

/* ─────────────────────────── Dry-run preview ─────────────────────────── */

export type MergePreview = {
  survivor: { id: string; name: string; pan: string | null };
  losers: Array<{ id: string; name: string; pan: string | null }>;
  /** Child rows that WILL be re-pointed at the survivor. */
  moves: Array<{ table: string; label: string; count: number }>;
  /** Child rows deliberately left on the retired record (see DENYLIST). */
  stays: Array<{ table: string; label: string; count: number }>;
  /** Fields where the records disagree and the operator must choose. */
  conflicts: Array<{
    field: MergeableField;
    label: string;
    survivorValue: string | null;
    loserValues: Array<{ id: string; name: string; value: string }>;
  }>;
  /** Non-empty PANs that differ — almost always two different people. */
  panMismatch: boolean;
  totals: { moving: number; staying: number };
};

/**
 * What a merge would do, without doing it.
 *
 * Runs the SAME table discovery and denylist as mergeInvestors, so the preview
 * cannot promise something the merge won't do. Counting is a `count(*)` per
 * child table for the losers — cheap enough for a handful of records, and the
 * only honest way to say "12 transactions and 3 folios move".
 */
export async function previewMerge(
  tx: Tx,
  args: { tenantId: string; survivorId: string; loserIds: string[] }
): Promise<MergePreview | { error: "one or both clients not found" }> {
  const { tenantId, survivorId } = args;
  const loserIds = args.loserIds.filter((id) => id !== survivorId);
  const ids = [survivorId, ...loserIds];

  const people = await tx.execute(sql`
    SELECT id, name, upper(nullif(trim(pan), '')) AS pan, phone, email, whatsapp_phone, dob
      FROM investors
     WHERE tenant_id = ${tenantId}::uuid
       AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
  `);
  const byId = new Map((people.rows as any[]).map((r) => [String(r.id), r]));
  const survivorRow = byId.get(survivorId);
  if (!survivorRow || loserIds.some((id) => !byId.has(id))) return { error: "one or both clients not found" };

  const { moves: moveTables, stays: stayTables } = await investorChildTables(tx);

  const tcols = await tx.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
  `);
  const hasTenant = new Set((tcols.rows as Array<{ table_name: string }>).map((r) => r.table_name));
  const loserList = sql.join(loserIds.map((i) => sql`${i}::uuid`), sql`, `);

  async function countFor(tables: string[]) {
    const out: Array<{ table: string; label: string; count: number }> = [];
    if (!loserIds.length) return out;
    for (const tbl of tables) {
      try {
        const r = await tx.execute(sql`
          SELECT count(*)::int AS n FROM ${sql.raw(`"${tbl}"`)}
           WHERE investor_id IN (${loserList})
             ${hasTenant.has(tbl) ? sql`AND tenant_id = ${tenantId}::uuid` : sql``}
        `);
        const n = Number((r.rows[0] as any)?.n ?? 0);
        if (n > 0) out.push({ table: tbl, label: tableLabel(tbl), count: n });
      } catch {
        // A table we can't read (permissions, odd shape) simply isn't reported;
        // the merge itself skips it the same way.
      }
    }
    return out.sort((a, b) => b.count - a.count);
  }

  const moves = await countFor(moveTables);
  const stays = await countFor(stayTables);

  // Field disagreements the operator should resolve deliberately.
  const conflicts: MergePreview["conflicts"] = [];
  for (const field of MERGEABLE_FIELDS) {
    const norm = (v: unknown) => (v == null ? "" : String(v).trim());
    const survivorValue = norm(survivorRow[field]);
    const loserValues = loserIds
      .map((id) => ({ id, name: String(byId.get(id)?.name ?? "—"), value: norm(byId.get(id)?.[field]) }))
      .filter((l) => l.value && l.value.toLowerCase() !== survivorValue.toLowerCase());
    // Only a real disagreement is a conflict: a blank survivor field is filled
    // automatically and needs no decision.
    if (survivorValue && loserValues.length) {
      conflicts.push({ field, label: FIELD_LABELS[field], survivorValue, loserValues });
    }
  }

  const survivorPan = survivorRow.pan ?? null;
  const panMismatch = loserIds.some((id) => {
    const p = byId.get(id)?.pan ?? null;
    return !!survivorPan && !!p && p !== survivorPan;
  });

  return {
    survivor: { id: survivorId, name: String(survivorRow.name ?? "—"), pan: survivorPan },
    losers: loserIds.map((id) => ({
      id,
      name: String(byId.get(id)?.name ?? "—"),
      pan: byId.get(id)?.pan ?? null,
    })),
    moves,
    stays,
    conflicts,
    panMismatch,
    totals: {
      moving: moves.reduce((n, m) => n + m.count, 0),
      staying: stays.reduce((n, m) => n + m.count, 0),
    },
  };
}

/**
 * Exact-PAN duplicate groups among LIVE clients (not merged, not closed),
 * excluding any pair the firm has marked "not duplicates". The only rule the
 * system is allowed to merge on unattended: a PAN is one legal person in
 * India, so two live records with the same PAN are the same client by
 * definition — phone / email / address are shared across a household and
 * must stay human-reviewed.
 *
 * Survivor per group = the record with the most AUM, then the most folios,
 * then the oldest — the one with the most to lose if retired.
 */
export type PanGroup = {
  pan: string;
  survivorId: string;
  survivorName: string;
  losers: Array<{ id: string; name: string }>;
};

export async function loadExactPanGroups(tx: Tx, tenantId: string, cap = 500): Promise<PanGroup[]> {
  const r = await tx.execute(sql`
    WITH live AS (
      SELECT i.id, i.name, upper(trim(i.pan)) AS pan, i.created_at,
             COALESCE(i.aum::numeric, 0) AS aum,
             (SELECT count(*) FROM folios f WHERE f.investor_id = i.id)::int AS folios
        FROM investors i
       WHERE i.tenant_id = ${tenantId}::uuid
         AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.status <> 'closed'
         AND NULLIF(trim(i.pan), '') IS NOT NULL
    ),
    dup AS (SELECT pan FROM live GROUP BY pan HAVING count(*) > 1)
    SELECT l.id, l.name, l.pan, l.aum, l.folios, l.created_at
      FROM live l
     WHERE l.pan IN (SELECT pan FROM dup)
     ORDER BY l.pan, l.aum DESC, l.folios DESC, l.created_at ASC
     LIMIT ${cap}
  `);
  const ignored = await tx.execute(sql`
    SELECT key1_id, key2_id FROM ignored_duplicates
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'client'
  `);
  const ignoredPairs = new Set(
    (ignored.rows as Array<{ key1_id: string; key2_id: string }>).map((p) =>
      [String(p.key1_id), String(p.key2_id)].sort().join("|")
    )
  );
  const isIgnored = (a: string, b: string) => ignoredPairs.has([a, b].sort().join("|"));

  const byPan = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of r.rows as any[]) {
    const arr = byPan.get(row.pan) ?? [];
    arr.push({ id: String(row.id), name: row.name ?? "—" });
    byPan.set(row.pan, arr);
  }
  const groups: PanGroup[] = [];
  for (const [pan, members] of byPan) {
    if (members.length < 2) continue;
    const [survivor, ...rest] = members; // already ordered: biggest book first
    const losers = rest.filter((m) => !isIgnored(survivor.id, m.id));
    if (!losers.length) continue;
    groups.push({ pan, survivorId: survivor.id, survivorName: survivor.name, losers });
  }
  return groups;
}
