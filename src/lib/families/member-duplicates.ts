/**
 * The same person listed twice among a family's members.
 *
 * Mapping a household means ticking people from the client list, and the list
 * shows a person twice whenever the registrar and the firm spelt them
 * differently — once with a PAN, once without ("Dilip Manilal Modi Huf" and
 * "Dilip Manilal Modi Huf (Huf)" in Nimesh C Shah's Modi family, 15 Oct 2026).
 * Both get ticked, both join the family, and the family's tables list the
 * person twice.
 *
 * This reads only the family's own members, by the same rules as Find
 * Duplicates (lib/investors/duplicate-clusters.findClusters): same PAN, same
 * name and date of birth, same name and a shared contact, the same name, a
 * registrar's spelling of it. A phone or email shared between members is a
 * household, not a duplicate, so those two rules are not used here. A group
 * marked "not duplicates" stays hidden.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { findClusters, type ClusterMember, type DuplicateCluster } from "@/lib/investors/duplicate-clusters";

type MemberRow = {
  id: string; name?: string | null; pan?: string | null; phone?: string | null; alternatePhone?: string | null;
  whatsappPhone?: string | null; email?: string | null; dob?: unknown; isMinor?: boolean | null; aum?: unknown;
};

const day = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
const arr = (ids: string[]) => `{${ids.join(",")}}`;

export async function loadFamilyMemberDuplicates(tx: Tx, tenantId: string, members: MemberRow[]): Promise<DuplicateCluster[]> {
  if (members.length < 2) return [];
  const found = findClusters(
    members.map((m) => ({
      id: m.id, name: m.name ?? null, pan: m.pan ?? null, phone: m.phone ?? null,
      alternate_phone: m.alternatePhone ?? null, whatsapp_phone: m.whatsappPhone ?? null, email: m.email ?? null,
      dob: day(m.dob), is_minor: !!m.isMinor, aum: Number(m.aum ?? 0), rm_name: null,
    })),
  ).filter((c) => c.kind !== "Phone" && c.kind !== "Email");
  if (!found.length) return [];

  const ids = [...new Set(found.flatMap((c) => c.ids))];
  const [ignored, folios] = await Promise.all([
    tx.execute(sql`
      SELECT key1_id::text AS a, key2_id::text AS b FROM ignored_duplicates
       WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'client' AND key1_id::text = ANY(${arr(ids)}::text[])
    `),
    tx.execute(sql`
      SELECT investor_id::text AS id, count(*)::int AS n FROM folios
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ANY(${arr(ids)}::uuid[]) GROUP BY 1
    `),
  ]);
  const ignoredPairs = new Set((ignored.rows as Array<{ a: string; b: string }>).map((r) => [r.a, r.b].sort().join("|")));
  const folioCount = new Map((folios.rows as Array<{ id: string; n: number }>).map((r) => [r.id, r.n]));
  const byId = new Map(members.map((m) => [m.id, m]));
  const allIgnored = (list: string[]) => {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) if (!ignoredPairs.has([list[i], list[j]].sort().join("|"))) return false;
    return true;
  };
  const VALID_PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const member = (id: string): ClusterMember => {
    const m = byId.get(id)!;
    return {
      id, name: m.name ?? "—", pan: m.pan ?? null, pan_valid: VALID_PAN.test(String(m.pan ?? "").trim().toUpperCase()),
      phone: m.phone ?? null, email: m.email ?? null, dob: day(m.dob), aum: Number(m.aum ?? 0),
      folios: folioCount.get(id) ?? 0, rm_name: null,
    };
  };
  return found.filter((c) => !allIgnored(c.ids)).map((c) => ({ kind: c.kind, gkey: c.gkey, members: c.ids.map(member) }));
}
