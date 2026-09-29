/**
 * Suspected-duplicate client clusters — Find Duplicates and the Merge Clients
 * "Unmerged Suggestion List" both read this, so the two never disagree.
 * SERVER-ONLY.
 *
 * What counts as a duplicate is deliberately narrow, because a merge moves one
 * person's money onto another record:
 *
 *   • the same valid PAN (a PAN identifies one person), or
 *   • the same name AND date of birth, provided their PANs don't disagree.
 *
 * Two records with DIFFERENT valid PANs are two people, whatever else they
 * share. A shared phone or email (a family, an HUF and its karta, one office
 * running several accounts) comes back separately as `shared` — information,
 * not a merge suggestion.
 *
 * Minors are left out of PAN matching: RTA feeds often carry the guardian's PAN
 * on a minor's folio. Their duplicates still surface on name + date of birth.
 *
 * Only LIVE clients (not merged away, not deleted). A cluster drops out once
 * every pair in it is marked "not duplicates" (ignored_duplicates).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type ClusterMember = {
  id: string;
  name: string;
  pan: string | null;
  /** The PAN is well-formed (AAAAA9999A) — only these can tell people apart. */
  pan_valid: boolean;
  phone: string | null;
  email: string | null;
  dob: string | null;
  aum: number;
  folios: number;
  rm_name: string | null;
};

export type ClusterKind = "PAN" | "NameDob" | "Phone" | "Email";
export type DuplicateCluster = { kind: ClusterKind; gkey: string; members: ClusterMember[] };

const VALID_PAN = "^[A-Z]{5}[0-9]{4}[A-Z]$";
const RULE_ORDER: Record<ClusterKind, number> = { PAN: 0, NameDob: 1, Email: 2, Phone: 3 };

export async function loadClientDuplicateClusters(
  tx: Tx,
  tenantId: string
): Promise<{ clusters: DuplicateCluster[]; shared: DuplicateCluster[]; ruleCounts: Record<string, number> }> {
  // "\\s" / "\\D" reach Postgres as \s / \D. Phones compare on their last ten
  // digits so +91 and 0 prefixes still match.
  const r = await tx.execute(sql`
    WITH base AS (
      SELECT i.id, i.name, i.pan, i.phone, i.email, i.dob, COALESCE(i.is_minor, false) AS is_minor,
             COALESCE(i.aum, 0)::numeric AS aum, u.name AS rm_name,
             CASE WHEN upper(trim(i.pan)) ~ ${VALID_PAN} THEN upper(trim(i.pan)) END AS vpan,
             lower(regexp_replace(trim(i.name), '\\s+', ' ', 'g')) AS nkey,
             right(regexp_replace(COALESCE(i.phone, ''), '\\D', '', 'g'), 10) AS pkey,
             lower(trim(i.email)) AS ekey
        FROM investors i LEFT JOIN users u ON u.id = i.rm_id
       WHERE i.tenant_id = ${tenantId}::uuid AND i.merged_into_id IS NULL AND i.deleted_at IS NULL
    ),
    pan_keys AS (
      SELECT vpan FROM base WHERE vpan IS NOT NULL AND NOT is_minor GROUP BY vpan HAVING count(*) > 1
    ),
    dob_keys AS (
      SELECT nkey, dob FROM base
       WHERE dob IS NOT NULL AND nkey <> ''
       GROUP BY nkey, dob
      HAVING count(*) > 1
         AND count(DISTINCT vpan) <= 1
         -- Every member already on the one PAN: the PAN group says it.
         AND NOT (count(vpan) = count(*) AND count(DISTINCT vpan) = 1)
    ),
    phone_keys AS (SELECT pkey FROM base WHERE length(pkey) = 10 GROUP BY pkey HAVING count(*) > 1),
    email_keys AS (SELECT ekey FROM base WHERE ekey LIKE '%@%' GROUP BY ekey HAVING count(*) > 1),
    hits AS (
      SELECT 'PAN' AS kind, b.vpan AS gkey, b.id FROM base b JOIN pan_keys k ON k.vpan = b.vpan WHERE NOT b.is_minor
      UNION ALL
      SELECT 'NameDob', b.nkey || ' · ' || to_char(b.dob, 'DD Mon YYYY'), b.id FROM base b JOIN dob_keys k ON k.nkey = b.nkey AND k.dob = b.dob
      UNION ALL
      SELECT 'Phone', b.pkey, b.id FROM base b JOIN phone_keys k ON k.pkey = b.pkey
      UNION ALL
      SELECT 'Email', b.ekey, b.id FROM base b JOIN email_keys k ON k.ekey = b.ekey
    )
    SELECT h.kind, h.gkey, b.id, b.name, b.pan, (b.vpan IS NOT NULL) AS pan_valid, b.phone, b.email,
           to_char(b.dob, 'YYYY-MM-DD') AS dob, b.aum, b.rm_name,
           (SELECT count(*)::int FROM folios f WHERE f.investor_id = b.id) AS folios
      FROM hits h JOIN base b ON b.id = h.id
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
  const clusterIgnored = (members: ClusterMember[]) => {
    if (members.length < 2) return true;
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++) if (!isIgnored(members[i].id, members[j].id)) return false;
    return true;
  };

  const groups = new Map<string, { kind: ClusterKind; gkey: string; members: Map<string, ClusterMember> }>();
  for (const row of r.rows as any[]) {
    const key = `${row.kind}::${row.gkey}`;
    if (!groups.has(key)) groups.set(key, { kind: row.kind, gkey: String(row.gkey), members: new Map() });
    groups.get(key)!.members.set(String(row.id), {
      id: String(row.id),
      name: row.name ?? "—",
      pan: row.pan ?? null,
      pan_valid: !!row.pan_valid,
      phone: row.phone ?? null,
      email: row.email ?? null,
      dob: row.dob ?? null,
      aum: Number(row.aum ?? 0),
      folios: Number(row.folios ?? 0),
      rm_name: row.rm_name ?? null,
    });
  }
  const all = [...groups.values()]
    .map((g) => ({ kind: g.kind, gkey: g.gkey, members: [...g.members.values()] }))
    .filter((g) => g.members.length > 1 && !clusterIgnored(g.members))
    .sort((a, b) => RULE_ORDER[a.kind] - RULE_ORDER[b.kind] || b.members.length - a.members.length);

  const clusters = all.filter((g) => g.kind === "PAN" || g.kind === "NameDob");
  // A shared phone / email whose records are already one duplicate group is
  // not news.
  const dupSets = clusters.map((g) => new Set(g.members.map((m) => m.id)));
  const shared = all
    .filter((g) => g.kind === "Phone" || g.kind === "Email")
    .filter((g) => !dupSets.some((set) => g.members.every((m) => set.has(m.id))));

  const ruleCounts = clusters.reduce((m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {} as Record<string, number>);
  return { clusters, shared, ruleCounts };
}
