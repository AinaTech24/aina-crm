/**
 * Merged-client history. SERVER-ONLY.
 *
 * `merged_into_id` records that a client was folded into another, but until now
 * nothing listed those merges back. Two questions need answering after a bulk
 * RTA import, and they are different questions:
 *
 *   "show me every merge"        → the audit trail
 *   "which did the SYSTEM do?"   → the set nobody reviewed
 *
 * The second is the one that matters. A manual merge had a human looking at two
 * records and deciding; a system merge (PAN-dedup during an RTA import) happened
 * unattended, so it is the set worth spot-checking — and the only set where an
 * un-merge is likely to be needed.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type MergeSource = "manual" | "system" | "import";

export type MergedClient = {
  /** investor_merges row — null for merges performed before that log existed,
   *  which therefore cannot be undone (nothing recorded what moved). */
  mergeId: string | null;
  reversible: boolean;
  loserId: string;
  loserName: string;
  loserPan: string | null;
  loserEmail: string | null;
  loserPhone: string | null;
  survivorId: string;
  survivorName: string;
  survivorPan: string | null;
  /** AUM the survivor carries today — the merged record's own is zeroed. */
  survivorAum: number;
  mergedAt: string | null;
  mergedByName: string | null;
  source: MergeSource;
  reason: string | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function loadMergedClients(
  tx: Tx,
  opts: { source?: MergeSource | "all"; q?: string; limit?: number } = {}
): Promise<MergedClient[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  // A merge performed before migration 0201 has no recorded source. Those were
  // all done through the manual API (its only writer), so COALESCE to 'manual'
  // rather than inventing an "unknown" bucket the UI would have to explain.
  const sourceFilter =
    opts.source && opts.source !== "all"
      ? sql` AND COALESCE(l.merge_source, 'manual') = ${opts.source}`
      : sql``;
  const q = (opts.q ?? "").trim();
  const search = q
    ? sql` AND (l.name ILIKE ${"%" + q + "%"} OR l.pan ILIKE ${"%" + q + "%"}
                OR l.email ILIKE ${"%" + q + "%"} OR l.phone ILIKE ${"%" + q + "%"}
                OR s.name ILIKE ${"%" + q + "%"})`
    : sql``;

  const rows = (await tx.execute(sql`
    SELECT m.id            AS merge_id,
           COALESCE(m.reversible, false) AS reversible,
           l.id            AS loser_id,
           l.name          AS loser_name,
           l.pan           AS loser_pan,
           l.email         AS loser_email,
           l.phone         AS loser_phone,
           s.id            AS survivor_id,
           s.name          AS survivor_name,
           s.pan           AS survivor_pan,
           COALESCE(s.aum::numeric, 0) AS survivor_aum,
           l.merged_at     AS merged_at,
           u.name          AS merged_by_name,
           COALESCE(l.merge_source, 'manual') AS source,
           l.merge_reason  AS reason
      FROM investors l
      JOIN investors s ON s.id = l.merged_into_id
      LEFT JOIN users u ON u.id = l.merged_by_id
      LEFT JOIN investor_merges m ON m.loser_id = l.id AND m.reversed_at IS NULL
     WHERE l.merged_into_id IS NOT NULL
       AND l.deleted_at IS NULL${sourceFilter}${search}
     ORDER BY l.merged_at DESC NULLS LAST
     LIMIT ${limit}
  `)).rows as any[];

  return rows.map((r) => ({
    mergeId: r.merge_id ? String(r.merge_id) : null,
    reversible: !!r.reversible && !!r.merge_id,
    loserId: String(r.loser_id),
    loserName: r.loser_name ?? "—",
    loserPan: r.loser_pan ?? null,
    loserEmail: r.loser_email ?? null,
    loserPhone: r.loser_phone ?? null,
    survivorId: String(r.survivor_id),
    survivorName: r.survivor_name ?? "—",
    survivorPan: r.survivor_pan ?? null,
    survivorAum: num(r.survivor_aum),
    mergedAt: r.merged_at ? String(r.merged_at) : null,
    mergedByName: r.merged_by_name ?? null,
    source: (r.source as MergeSource) ?? "manual",
    reason: r.reason ?? null,
  }));
}

/** Counts per source, for the tab badges. */
export async function loadMergeCounts(tx: Tx): Promise<{ all: number; manual: number; system: number }> {
  const r = (await tx.execute(sql`
    SELECT count(*)::int AS all,
           count(*) FILTER (WHERE COALESCE(merge_source, 'manual') = 'manual')::int AS manual,
           count(*) FILTER (WHERE COALESCE(merge_source, 'manual') IN ('system', 'import'))::int AS system
      FROM investors
     WHERE merged_into_id IS NOT NULL AND deleted_at IS NULL
  `)).rows[0] as any;
  return { all: num(r?.all), manual: num(r?.manual), system: num(r?.system) };
}

/**
 * Free-text client search for the manual merge picker.
 *
 * Matches name / PAN / email / mobile / address — the same keys the duplicate
 * detector groups on, plus address, so an operator who can SEE two records are
 * the same can act on it even when no automatic rule fired. Already-merged rows
 * are excluded: merging into a record that is itself merged away would create a
 * chain the un-merge path cannot unwind.
 */
export type MergeCandidate = {
  id: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  /** Exchange UCC when the firm has one — the human-readable "Client ID". */
  ucc: string | null;
  /** "line1, city" for the summary table's Address column. */
  address: string | null;
  aum: number;
  status: string | null;
  folios: number;
};

export async function searchMergeCandidates(tx: Tx, q: string, limit = 25): Promise<MergeCandidate[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  // Digits-only comparison for mobile, so "98765 43210" and "+919876543210"
  // both match. Only added when the term ACTUALLY contains digits — otherwise
  // the pattern collapses to '%%', which matches every row with a phone number
  // and turns a name search into "the whole book".
  const digits = term.replace(/\D/g, "");
  const phoneClause =
    digits.length >= 4
      ? sql` OR regexp_replace(COALESCE(i.phone, ''), '\\D', '', 'g') LIKE ${"%" + digits + "%"}`
      : sql``;
  const rows = (await tx.execute(sql`
    SELECT i.id, i.name, i.pan, i.email, i.phone, i.status,
           COALESCE(i.aum::numeric, 0) AS aum,
           i.address->>'city' AS city,
           i.address->>'line1' AS line1,
           i.bse_ucc_code AS ucc,
           (SELECT count(*) FROM folios f WHERE f.investor_id = i.id)::int AS folios
      FROM investors i
     WHERE i.deleted_at IS NULL
       AND i.merged_into_id IS NULL
       AND (
         i.name ILIKE ${like} OR i.pan ILIKE ${like} OR i.email ILIKE ${like}
         OR i.address->>'line1' ILIKE ${like} OR i.address->>'city' ILIKE ${like}${phoneClause}
       )
     ORDER BY i.aum::numeric DESC NULLS LAST
     LIMIT ${limit}
  `)).rows as any[];

  return rows.map((r) => ({
    id: String(r.id),
    name: r.name ?? "—",
    pan: r.pan ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    city: r.city ?? null,
    ucc: r.ucc ?? null,
    address: [r.line1, r.city].filter(Boolean).join(", ") || null,
    aum: num(r.aum),
    status: r.status ?? null,
    folios: num(r.folios),
  }));
}
