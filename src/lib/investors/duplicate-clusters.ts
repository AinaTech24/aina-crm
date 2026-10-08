/**
 * Suspected-duplicate client clusters — Find Duplicates and the Merge Clients
 * "Unmerged Suggestion List" both read this, so the two never disagree.
 * SERVER-ONLY.
 *
 * Four rules, strongest first. Names compare as a matching key — case,
 * punctuation, honorifics and word order ignored ("SHAH NIMESH C" is
 * "Mr. Nimesh C Shah", lib/rta/client-match nameMatchKey):
 *
 *   • PAN         — the same valid PAN (a PAN identifies one person);
 *   • NameDob     — the same name and date of birth;
 *   • NameContact — the same name and a shared email or mobile (phone,
 *                   alternate or WhatsApp, last ten digits);
 *   • Name        — the same name (two words or more) with nothing on either
 *                   record that tells them apart.
 *
 * Until 8 Oct 2026 only the first two existed. A registrar import that left a
 * placeholder beside the real client ("RAMILABEN NARENDRAKUMAR SHAH" twice,
 * one PAN-less, no date of birth on either) showed twice in the client search
 * while Find Duplicates said there was nothing to find.
 *
 * What can never be a duplicate, whatever else is shared: two DIFFERENT valid
 * PANs (two people), two different dates of birth. A shared phone or email
 * under DIFFERENT names (a family on one household email, an HUF and its
 * karta, one office running several accounts) comes back separately as
 * `shared` — information, not a merge suggestion.
 *
 * Minors are left out of PAN matching: RTA feeds often carry the guardian's PAN
 * on a minor's folio. Their duplicates still surface by name.
 *
 * Only LIVE clients (not merged away, not deleted). A cluster drops out once
 * every pair in it is marked "not duplicates" (ignored_duplicates).
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { nameMatchKey } from "@/lib/rta/client-match";

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

export type ClusterKind = "PAN" | "NameDob" | "NameContact" | "Name" | "Phone" | "Email";
export type DuplicateCluster = { kind: ClusterKind; gkey: string; members: ClusterMember[] };

/** The duplicate rules in order, with the label each page shows. */
export const DUPLICATE_RULES = [
  ["PAN", "Same PAN"],
  ["NameDob", "Same name + date of birth"],
  ["NameContact", "Same name + phone / email"],
  ["Name", "Same name"],
] as const;

const VALID_PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const RULE_ORDER: Record<ClusterKind, number> = { PAN: 0, NameDob: 1, NameContact: 2, Name: 3, Email: 4, Phone: 5 };

type Row = {
  id: string; name: string | null; pan: string | null; phone: string | null; alternate_phone: string | null;
  whatsapp_phone: string | null; email: string | null; dob: string | null; is_minor: boolean;
  aum: string | number | null; rm_name: string | null;
};
type Rec = Row & { vpan: string | null; nkey: string; emailKey: string | null; mobiles: string[] };

/** A stand-in an import writes when the file had no name ("Unnamed (no PAN)",
 *  "UNKNOWN") says nothing about who the client is, so it never matches. */
const PLACEHOLDER_NAME = /\b(UNNAMED|UNKNOWN|NONAME)\b/;

/** Last ten digits of a real mobile number, else null. */
function mobileKey(v: string | null): string | null {
  const d = String(v ?? "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(d) && !/^(\d)\1{9}$/.test(d) ? d : null;
}
function emailKey(v: string | null): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** Nothing on the records tells them apart: at most one valid PAN, at most one date of birth. */
function compatible(rs: Rec[]): boolean {
  return new Set(rs.map((r) => r.vpan).filter(Boolean)).size <= 1 && new Set(rs.map((r) => r.dob).filter(Boolean)).size <= 1;
}

/** Group by a key; groups of two or more. */
function groupBy(rs: Rec[], key: (r: Rec) => string | null | Array<string | null>): Map<string, Rec[]> {
  const m = new Map<string, Rec[]>();
  for (const r of rs) {
    const ks = key(r);
    for (const k of Array.isArray(ks) ? ks : [ks]) if (k) m.set(k, [...(m.get(k) ?? []), r]);
  }
  for (const [k, v] of m) if (new Set(v.map((r) => r.id)).size < 2) m.delete(k);
  return m;
}

/** Pure — the four rules over loaded records. Exported for tests. */
export function findClusters(rows: Row[]): Array<{ kind: ClusterKind; gkey: string; ids: string[] }> {
  const recs: Rec[] = rows.map((r) => {
    const pan = String(r.pan ?? "").trim().toUpperCase();
    return {
      ...r,
      vpan: VALID_PAN.test(pan) ? pan : null,
      nkey: PLACEHOLDER_NAME.test(String(r.name ?? "").toUpperCase()) ? "" : nameMatchKey(r.name),
      emailKey: emailKey(r.email),
      mobiles: [...new Set([r.phone, r.alternate_phone, r.whatsapp_phone].map(mobileKey).filter(Boolean) as string[])],
    };
  });
  const out: Array<{ kind: ClusterKind; gkey: string; ids: string[] }> = [];
  const covered: Array<Set<string>> = [];
  const already = (ids: string[]) => covered.some((s) => ids.every((id) => s.has(id)));
  const push = (kind: ClusterKind, gkey: string, rs: Rec[]) => {
    const ids = [...new Set(rs.map((r) => r.id))];
    if (ids.length < 2 || already(ids)) return;
    out.push({ kind, gkey, ids });
    covered.push(new Set(ids));
  };
  const label = (rs: Rec[]) => String(rs[0].name ?? "").trim();

  // PAN
  for (const [pan, rs] of groupBy(recs.filter((r) => !r.is_minor), (r) => r.vpan)) push("PAN", pan, rs);

  // Name + date of birth
  for (const [, rs] of groupBy(recs, (r) => (r.nkey && r.dob ? `${r.nkey}|${r.dob}` : null))) {
    if (compatible(rs)) push("NameDob", `${label(rs)} · born ${rs[0].dob}`, rs);
  }

  // Name + shared email / mobile: records of one name joined by any shared contact.
  for (const [, sameName] of groupBy(recs, (r) => r.nkey || null)) {
    const parent = new Map<string, string>();
    const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
    for (const [, rs] of groupBy(sameName, (r) => [r.emailKey ? `E:${r.emailKey}` : null, ...r.mobiles.map((m) => `M:${m}`)])) {
      for (const r of rs.slice(1)) { const a = find(rs[0].id), b = find(r.id); if (a !== b) parent.set(b, a); }
    }
    const comps = new Map<string, Rec[]>();
    for (const r of sameName) comps.set(find(r.id), [...(comps.get(find(r.id)) ?? []), r]);
    for (const rs of comps.values()) {
      if (rs.length < 2 || !compatible(rs)) continue;
      const shared = rs.find((r) => rs.some((o) => o.id !== r.id && ((r.emailKey && r.emailKey === o.emailKey) || r.mobiles.some((m) => o.mobiles.includes(m)))));
      const how = shared ? (shared.emailKey && rs.some((o) => o.id !== shared.id && o.emailKey === shared.emailKey) ? shared.emailKey : shared.mobiles.find((m) => rs.some((o) => o.id !== shared.id && o.mobiles.includes(m)))) : "";
      push("NameContact", `${label(rs)} · ${how}`, rs);
    }
  }

  // Name alone: two words or more, nothing telling them apart.
  for (const [nk, rs] of groupBy(recs, (r) => r.nkey || null)) {
    if (nk.split(" ").length < 2 || !compatible(rs)) continue;
    push("Name", label(rs), rs);
  }

  // Shared contact under different names: information only.
  const dupSets = out.map((c) => new Set(c.ids));
  for (const [k, rs] of groupBy(recs, (r) => [r.emailKey ? `Email:${r.emailKey}` : null, ...r.mobiles.map((m) => `Phone:${m}`)])) {
    const ids = [...new Set(rs.map((r) => r.id))];
    if (dupSets.some((s) => ids.every((id) => s.has(id)))) continue;
    const [kind, key] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)] as [ClusterKind, string];
    out.push({ kind, gkey: key, ids });
  }
  return out;
}

export async function loadClientDuplicateClusters(
  tx: Tx,
  tenantId: string,
  /** The viewer's client data scope over alias `i` (investorScopeSql); default unrestricted. */
  scope: SQL = sql`TRUE`
): Promise<{ clusters: DuplicateCluster[]; shared: DuplicateCluster[]; ruleCounts: Record<string, number> }> {
  const rows = (await tx.execute(sql`
    SELECT i.id::text AS id, i.name, i.pan, i.phone, i.alternate_phone, i.whatsapp_phone, i.email,
           to_char(i.dob, 'YYYY-MM-DD') AS dob, COALESCE(i.is_minor, false) AS is_minor,
           COALESCE(i.aum, 0)::numeric AS aum, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
     WHERE i.tenant_id = ${tenantId}::uuid AND i.merged_into_id IS NULL AND i.deleted_at IS NULL
       AND ${scope}
  `)).rows as Row[];
  const found = findClusters(rows);

  const ignored = await tx.execute(sql`
    SELECT key1_id, key2_id FROM ignored_duplicates
     WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'client'
  `);
  const ignoredPairs = new Set(
    (ignored.rows as Array<{ key1_id: string; key2_id: string }>).map((p) =>
      [String(p.key1_id), String(p.key2_id)].sort().join("|")
    )
  );
  const clusterIgnored = (ids: string[]) => {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) if (!ignoredPairs.has([ids[i], ids[j]].sort().join("|"))) return false;
    return true;
  };
  const live = found.filter((c) => !clusterIgnored(c.ids));

  const memberIds = [...new Set(live.flatMap((c) => c.ids))];
  const folioCount = new Map<string, number>();
  if (memberIds.length) {
    const fc = await tx.execute(sql`
      SELECT investor_id::text AS id, count(*)::int AS n FROM folios
       WHERE tenant_id = ${tenantId}::uuid
         AND investor_id = ANY(${`{${memberIds.join(",")}}`}::uuid[])
       GROUP BY 1
    `);
    for (const r of fc.rows as Array<{ id: string; n: number }>) folioCount.set(r.id, r.n);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const member = (id: string): ClusterMember => {
    const r = byId.get(id)!;
    const pan = String(r.pan ?? "").trim().toUpperCase();
    return {
      id, name: r.name ?? "—", pan: r.pan ?? null, pan_valid: VALID_PAN.test(pan),
      phone: r.phone ?? null, email: r.email ?? null, dob: r.dob ?? null,
      aum: Number(r.aum ?? 0), folios: folioCount.get(id) ?? 0, rm_name: r.rm_name ?? null,
    };
  };
  const all: DuplicateCluster[] = live
    .map((c) => ({ kind: c.kind, gkey: c.gkey, members: c.ids.map(member) }))
    .sort((a, b) => RULE_ORDER[a.kind] - RULE_ORDER[b.kind] || b.members.length - a.members.length);

  const clusters = all.filter((g) => g.kind !== "Phone" && g.kind !== "Email");
  const shared = all.filter((g) => g.kind === "Phone" || g.kind === "Email");
  const ruleCounts = clusters.reduce((m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {} as Record<string, number>);
  return { clusters, shared, ruleCounts };
}
