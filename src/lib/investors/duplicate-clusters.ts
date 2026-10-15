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
 *                   record that tells them apart;
 *   • SimilarName — a record WITHOUT a PAN beside a PAN client whose name is
 *                   another spelling of it (similarNames): what a registrar
 *                   report with no PAN column leaves behind when it spells
 *                   the name its own way. Added 14 Oct 2026 — Nimesh C Shah
 *                   had "Behnaz Porus Dastur" beside "BEHNAZ PORAS DASTUR",
 *                   "KIRITKUMAR MOHANLAL SHAH" beside "KIRIT KUMAR MOHANLAL
 *                   SHAH", none of which an exact name could pair. Only a
 *                   suggestion: a person merges.
 *   • PanTypo     — two valid PANs one character apart on the same person
 *                   (a shared email, mobile or date of birth, and one name
 *                   containing or respelling the other): a registrar's
 *                   mistyped PAN. The one exception to "two valid PANs are
 *                   two people" below. Added 15 Oct 2026. Only a suggestion.
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

export type ClusterKind = "PAN" | "NameDob" | "NameContact" | "Name" | "SimilarName" | "PanTypo" | "Phone" | "Email";
export type DuplicateCluster = { kind: ClusterKind; gkey: string; members: ClusterMember[] };

/** The duplicate rules in order, with the label each page shows. */
export const DUPLICATE_RULES = [
  ["PAN", "Same PAN"],
  ["NameDob", "Same name + date of birth"],
  ["NameContact", "Same name + phone / email"],
  ["Name", "Same name"],
  ["SimilarName", "Similar name, one without PAN"],
  ["PanTypo", "PAN one character apart"],
] as const;

const VALID_PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const RULE_ORDER: Record<ClusterKind, number> = { PAN: 0, NameDob: 1, NameContact: 2, Name: 3, SimilarName: 4, PanTypo: 5, Email: 6, Phone: 7 };

/** Valid PANs that differ in exactly one character. */
export function panOneApart(a: string, b: string): boolean {
  if (a.length !== 10 || b.length !== 10 || a === b) return false;
  let diff = 0;
  for (let i = 0; i < 10; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return diff === 1;
}

/** One name is the other with words left out, in order of writing ignored:
 *  "DIPAK RANA" and "DIPAK KASHIRAM RANA". At least two words on the shorter
 *  side, so one shared word ("RANA") is never enough. */
function nameContained(a: string | null | undefined, b: string | null | undefined): boolean {
  const wa = nameWords(a), wb = nameWords(b);
  const [s, l] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return s.length >= 2 && s.every((w) => l.includes(w));
}

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

/** A name's words for spelling comparison, in the order written, each once
 *  (an AUM statement writes "Dipak Kashiram Rana Huf (Huf)"). */
function nameWords(name: string | null | undefined): string[] {
  const words = String(name ?? "").toUpperCase().replace(/[^A-Z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const kept = new Set(nameMatchKey(words.join(" ")).split(" "));
  return [...new Set(words.filter((w) => kept.has(w)))];
}

/** At most one letter inserted, removed or changed. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Two spellings of one person's name, as a registrar and a firm write it:
 *  - the same letters with the spaces moved — "KIRITKUMAR MOHANLAL SHAH" and
 *    "Kirit Kumar Mohanlal Shah";
 *  - or word for word the same, at least two words identical, the rest each
 *    one letter off ("Porus" / "Poras", "Natvarlal" / "Natwarlal") or an
 *    initial standing for a word ("Nital J Mehta" / "Nital Jignesh Mehta").
 * A different first name is a different person ("Anila Bhupendra Shah" and
 * "Tejas Bhupendra Shah"), so that never matches. Pure; exported for tests.
 */
export function similarNames(a: string | null | undefined, b: string | null | undefined): boolean {
  const wa = nameWords(a), wb = nameWords(b);
  if (!wa.length || !wb.length) return false;
  const compact = (w: string[]) => w.join("");
  if (compact(wa).length >= 8 && compact(wa) === compact(wb)) return true;
  if (compact([...wa].sort()) === compact([...wb].sort()) && wa.length >= 2) return true;
  if (wa.length !== wb.length || wa.length < 2) return false;
  const rest = [...wb];
  let exact = 0;
  const pending: string[] = [];
  for (const w of wa) {
    const k = rest.indexOf(w);
    if (k >= 0) { rest.splice(k, 1); exact++; } else pending.push(w);
  }
  if (exact < 2) return false;
  for (const w of pending) {
    const k = rest.findIndex((o) =>
      (w.length === 1 && o.length > 1 && o[0] === w) || (o.length === 1 && w.length > 1 && w[0] === o) ||
      (w.length >= 4 && o.length >= 4 && w[0] === o[0] && oneEditApart(w, o)));
    if (k < 0) return false;
    rest.splice(k, 1);
  }
  return true;
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

  // Similar name: a record with no PAN beside a PAN client spelt another way.
  // Candidates share a whole word, or the same letters run together.
  {
    const withPan = recs.filter((r) => r.vpan && r.nkey);
    const byWord = new Map<string, Rec[]>();
    const byCompact = new Map<string, Rec[]>();
    for (const r of withPan) {
      const ws = nameWords(r.name);
      for (const w of ws) if (w.length >= 3) byWord.set(w, [...(byWord.get(w) ?? []), r]);
      byCompact.set(ws.join(""), [...(byCompact.get(ws.join("")) ?? []), r]);
    }
    for (const r of recs) {
      if (r.vpan || !r.nkey || String(r.pan ?? "").trim()) continue;
      const ws = nameWords(r.name);
      const cands = new Map<string, Rec>();
      for (const c of byCompact.get(ws.join("")) ?? []) cands.set(c.id, c);
      for (const w of ws) if (w.length >= 3) for (const c of byWord.get(w) ?? []) cands.set(c.id, c);
      for (const c of cands.values()) {
        if (c.is_minor !== r.is_minor || c.nkey === r.nkey) continue;
        if (!similarNames(r.name, c.name) || !compatible([r, c])) continue;
        push("SimilarName", `${String(c.name ?? "").trim()} · ${String(r.name ?? "").trim()}`, [c, r]);
      }
    }
  }

  // PAN one character apart: one registrar's mistyped PAN made a second client
  // ("DIPAK KASHIRAM RANA" AAUPR8108G, KYC-verified, ₹1.09 Cr, and "DIPAK
  // RANA" AAUPR8108Q from a KFintech folio, one mobile and email between them —
  // Nimesh C Shah, 15 Oct 2026). Two different valid PANs are otherwise two
  // people, so this needs the same person on every other count: a shared
  // email, mobile or date of birth, one name containing or respelling the
  // other, no conflicting date of birth, and no minor. Only a suggestion.
  {
    const adults = recs.filter((r) => r.vpan && r.nkey && !r.is_minor);
    const byMask = new Map<string, Rec[]>();
    for (const r of adults) for (let k = 0; k < 10; k++) {
      const m = `${k}:${r.vpan!.slice(0, k)}_${r.vpan!.slice(k + 1)}`;
      byMask.set(m, [...(byMask.get(m) ?? []), r]);
    }
    for (const rs of byMask.values()) {
      if (rs.length < 2) continue;
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (!panOneApart(a.vpan!, b.vpan!)) continue;
        if (a.dob && b.dob && a.dob !== b.dob) continue;
        const contact = (a.emailKey && a.emailKey === b.emailKey) || a.mobiles.some((m) => b.mobiles.includes(m)) || (!!a.dob && a.dob === b.dob);
        const names = a.nkey === b.nkey || nameContained(a.name, b.name) || similarNames(a.name, b.name);
        if (contact && names) push("PanTypo", `${String(a.name ?? "").trim()} · ${a.vpan} / ${b.vpan}`, [a, b]);
      }
    }
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
