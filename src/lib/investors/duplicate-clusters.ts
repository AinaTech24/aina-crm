/**
 * Suspected-duplicate client clusters — the "Unmerged Suggestion List".
 * SERVER-ONLY.
 *
 * Groups LIVE clients (not merged away) that share an exact PAN, a normalised
 * mobile, an email, or a normalised name. Pairs the firm has marked "not
 * duplicates" (ignored_duplicates) drop a cluster once every pair in it is
 * ignored. Same rules and ordering as the Find Duplicates page, so the two
 * surfaces never disagree about what is a suggestion.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type ClusterMember = {
  id: string;
  name: string;
  pan: string | null;
  phone: string | null;
  email: string | null;
  aum: number;
  rm_name: string | null;
};

export type DuplicateCluster = { kind: "PAN" | "Phone" | "Email" | "Name"; gkey: string; members: ClusterMember[] };

const RULE_ORDER: Record<string, number> = { PAN: 0, Email: 1, Phone: 2, Name: 3 };

export async function loadClientDuplicateClusters(
  tx: Tx,
  tenantId: string
): Promise<{ clusters: DuplicateCluster[]; ruleCounts: Record<string, number> }> {
  const r = await tx.execute(sql`
    WITH base AS (
      SELECT i.id, i.name, i.pan, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.tenant_id = ${tenantId}::uuid AND i.merged_into_id IS NULL AND i.deleted_at IS NULL
    ),
    pan_g AS (SELECT 'PAN' AS kind, upper(pan) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY upper(pan)) AS grp FROM base WHERE pan IS NOT NULL AND pan <> ''),
    phone_g AS (SELECT 'Phone' AS kind, regexp_replace(phone,'\D','','g') AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY regexp_replace(phone,'\D','','g')) AS grp FROM base WHERE phone IS NOT NULL AND length(regexp_replace(phone,'\D','','g')) >= 10),
    email_g AS (SELECT 'Email' AS kind, lower(email) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY lower(email)) AS grp FROM base WHERE email IS NOT NULL AND email <> ''),
    name_g AS (SELECT 'Name' AS kind, lower(trim(name)) AS gkey, id, name, pan, phone, email, aum, rm_name, count(*) OVER (PARTITION BY lower(trim(name))) AS grp FROM base WHERE name IS NOT NULL AND trim(name) <> '')
    SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM pan_g WHERE grp > 1
    UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM phone_g WHERE grp > 1
    UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM email_g WHERE grp > 1
    UNION ALL SELECT kind, gkey, id, name, pan, phone, email, aum, rm_name FROM name_g WHERE grp > 1
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

  const groups = new Map<string, { kind: DuplicateCluster["kind"]; gkey: string; members: Map<string, ClusterMember> }>();
  for (const row of r.rows as any[]) {
    const key = `${row.kind}::${row.gkey}`;
    if (!groups.has(key)) groups.set(key, { kind: row.kind, gkey: String(row.gkey), members: new Map() });
    groups.get(key)!.members.set(String(row.id), {
      id: String(row.id),
      name: row.name ?? "—",
      pan: row.pan ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      aum: Number(row.aum ?? 0),
      rm_name: row.rm_name ?? null,
    });
  }
  const clusters = [...groups.values()]
    .map((g) => ({ kind: g.kind, gkey: g.gkey, members: [...g.members.values()] }))
    .filter((g) => g.members.length > 1 && !clusterIgnored(g.members))
    .sort((a, b) => (RULE_ORDER[a.kind] ?? 9) - (RULE_ORDER[b.kind] ?? 9) || b.members.length - a.members.length);
  const ruleCounts = clusters.reduce((m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {} as Record<string, number>);
  return { clusters, ruleCounts };
}
