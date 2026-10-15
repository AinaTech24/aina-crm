/**
 * Merge client records that are certainly the same person, and list the ones
 * a person must decide.
 *
 * Merged (the ordinary merge: logged, reversible from Merge Clients):
 *   1. a no-PAN registrar placeholder holding NO money, with the same name
 *      (any word order, at least two words) as exactly one client with a PAN
 *      → into that client;
 *   2. two live records with the same PAN AND the same name;
 *   3. the same MINOR filed under each guardian's PAN (keys "MINOR:<pan>:…"):
 *      same name AND the same date of birth, mobile or email → one record;
 *   4. one adult under two valid PANs ONE character apart (a registrar's typo)
 *      with a shared mobile, email or date of birth, one name containing or
 *      respelling the other, and no conflicting date of birth → the record whose
 *      PAN reads as a person (4th letter P), then the KYC-verified one, survives
 *      (15 Oct 2026: Nimesh's DIPAK KASHIRAM RANA AAUPR8108G beside DIPAK RANA
 *      AAUPR8108Q; the same in four firms).
 * Listed only (never merged here): one PAN on records with DIFFERENT names
 * (often a guardian's PAN on a child's record), and one name under DIFFERENT
 * real PANs (two people, or a mistyped PAN) — both need a person.
 *
 * The survivor is the record holding the most money, then the most folios,
 * then the oldest. Dry run by default; --apply writes, 25 merges per
 * transaction. Run it while no RTA import is in progress.
 *
 *   tsx scripts/repair-client-duplicates.ts --tenant <uuid> [--only "PAN one character"] [--apply]
 *
 * --only keeps the merges whose rule contains that text (the listing is unchanged).
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { mergeInvestors } from "../src/lib/investors/merge";
import { nameMatchKey } from "../src/lib/rta/client-match";
import { panOneApart, similarNames } from "../src/lib/investors/duplicate-clusters";

const args = process.argv.slice(2);
const T = args[args.indexOf("--tenant") + 1];
const APPLY = args.includes("--apply");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

type Row = {
  id: string; name: string | null; pan: string | null; rta_nopan_key: string | null; dob: string | null;
  mob: string; email: string; aum: number; folios: number; created_at: string; kyc: string | null; is_minor: boolean;
};
type Pair = { survivor: Row; loser: Row; rule: string; mismatch: boolean };

const rank = (a: Row, b: Row) => b.aum - a.aum || b.folios - a.folios || String(a.created_at).localeCompare(String(b.created_at));
const nk = (r: Row) => { const k = nameMatchKey(r.name); return k && k.split(" ").length >= 2 ? k : null; };
const day = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
const lakh = (n: number) => `₹${(n / 1e5).toFixed(1)}L`;

async function load(): Promise<Row[]> {
  return withTenant(T, async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    const rows = (await tx.execute(sql`
      SELECT i.id, i.name, upper(nullif(trim(i.pan), '')) AS pan, i.rta_nopan_key, i.dob, i.created_at, i.kyc_status AS kyc, COALESCE(i.is_minor, false) AS is_minor,
             right(regexp_replace(COALESCE(i.phone, ''), '[^0-9]', '', 'g'), 10) AS mob, lower(trim(COALESCE(i.email, ''))) AS email,
             COALESCE(i.aum, 0)::numeric AS aum,
             (SELECT count(*) FROM folios f WHERE f.tenant_id = i.tenant_id AND f.investor_id = i.id)::int AS folios
        FROM investors i
       WHERE i.tenant_id = ${T}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
         AND COALESCE(i.status, '') NOT IN ('closed', 'exited')`)).rows as any[];
    return rows.map((r) => ({ ...r, id: String(r.id), aum: Number(r.aum), dob: day(r.dob) })) as Row[];
  });
}

function plan(rows: Row[]) {
  const pairs: Pair[] = [];
  const review: string[] = [];
  const used = new Set<string>();
  const add = (survivor: Row, loser: Row, rule: string, mismatch = false) => {
    // A record goes away at most once, and never into one that goes away.
    if (survivor.id === loser.id || used.has(loser.id) || used.has(survivor.id)) return;
    used.add(loser.id);
    pairs.push({ survivor, loser, rule, mismatch });
  };
  const byName = new Map<string, Row[]>();
  for (const r of rows) { const k = nk(r); if (k) byName.set(k, [...(byName.get(k) ?? []), r]); }

  // 1. empty placeholders → the one PAN client of that name
  for (const g of byName.values()) {
    const panClients = g.filter((r) => r.pan && !r.pan.startsWith("MINOR:"));
    const people = new Set(panClients.map((r) => r.pan));
    const minors = g.filter((r) => r.pan?.startsWith("MINOR:"));
    for (const ph of g.filter((r) => !r.pan && (r.rta_nopan_key ?? "").startsWith("NOPAN:") && r.aum <= 0)) {
      // the one real person of that name: a single PAN, or (no PAN client) a single minor
      const target = people.size === 1 ? [...panClients].sort(rank)[0] : people.size === 0 && minors.length === 1 ? minors[0] : null;
      if (target) add(target, ph, "empty placeholder → same-name client");
    }
  }
  // 2. same PAN + same name
  const byPan = new Map<string, Row[]>();
  for (const r of rows) if (r.pan) byPan.set(r.pan, [...(byPan.get(r.pan) ?? []), r]);
  for (const [pan, g] of byPan) {
    if (g.length < 2) continue;
    const names = new Map<string, Row[]>();
    for (const r of g) { const k = nk(r) ?? `?${r.id}`; names.set(k, [...(names.get(k) ?? []), r]); }
    for (const same of names.values()) {
      if (same.length < 2) continue;
      const [s, ...rest] = [...same].sort(rank);
      for (const l of rest) add(s, l, "same PAN + same name");
    }
    if (names.size > 1 && !pan.startsWith("MINOR:")) review.push(`one PAN, different names: ${pan} → ${g.map((r) => `${r.name} ${lakh(r.aum)}`).join(" | ")}`);
  }
  // 3. the same minor under each guardian
  for (const g of byName.values()) {
    const minors = g.filter((r) => r.pan?.startsWith("MINOR:") && !used.has(r.id));
    if (minors.length < 2) continue;
    const sorted = [...minors].sort(rank);
    const s = sorted[0];
    for (const l of sorted.slice(1)) {
      const same = (s.dob && l.dob && s.dob === l.dob) || (s.mob.length === 10 && s.mob === l.mob) || (s.email && s.email === l.email);
      const conflict = s.dob && l.dob && s.dob !== l.dob;
      if (same && !conflict) add(s, l, "same minor under another guardian", true);
    }
  }
  // 4. one adult, two PANs one character apart
  const VALID = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const words = (n: string | null) => (nk({ name: n } as Row) ?? "").split(" ").filter(Boolean);
  const contained = (a: string | null, b: string | null) => {
    const wa = words(a), wb = words(b); const [sh, lo] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    return sh.length >= 2 && sh.every((w) => lo.includes(w));
  };
  const adults = rows.filter((r) => r.pan && VALID.test(r.pan) && !r.is_minor && !used.has(r.id));
  const byMask = new Map<string, Row[]>();
  for (const r of adults) for (let k = 0; k < 10; k++) { const m = `${k}:${r.pan!.slice(0, k)}_${r.pan!.slice(k + 1)}`; byMask.set(m, [...(byMask.get(m) ?? []), r]); }
  const personFirst = (a: Row, b: Row) =>
    (b.pan![3] === "P" ? 1 : 0) - (a.pan![3] === "P" ? 1 : 0) ||
    (b.kyc === "verified" ? 1 : 0) - (a.kyc === "verified" ? 1 : 0) || rank(a, b);
  for (const g of byMask.values()) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const a = g[i], b = g[j];
      if (!panOneApart(a.pan!, b.pan!) || (a.dob && b.dob && a.dob !== b.dob)) continue;
      const contact = (a.mob.length === 10 && a.mob === b.mob) || (!!a.email && a.email === b.email) || (!!a.dob && a.dob === b.dob);
      const names = (nk(a) && nk(a) === nk(b)) || contained(a.name, b.name) || similarNames(a.name, b.name);
      if (!contact || !names) continue;
      const [s, l] = [a, b].sort(personFirst);
      add(s, l, "one person, PAN one character apart", true);
    }
  }
  // listed: one name, several real PANs
  for (const g of byName.values()) {
    const pans = [...new Set(g.map((r) => r.pan).filter((p): p is string => !!p && !p.startsWith("MINOR:")))];
    if (pans.length > 1) review.push(`one name, ${pans.length} PANs: ${g[0].name} → ${g.filter((r) => r.pan && !r.pan.startsWith("MINOR:")).map((r) => `${r.pan} ${lakh(r.aum)}`).join(" | ")}`);
  }
  return { pairs, review };
}

async function main() {
  if (!T || T.startsWith("--")) throw new Error("Pass --tenant <uuid>. Add --apply to write.");
  console.log(APPLY ? "APPLY" : "DRY RUN (add --apply)");
  const rows = await load();
  const planned = plan(rows);
  const review = planned.review;
  const pairs = ONLY ? planned.pairs.filter((p) => p.rule.includes(ONLY)) : planned.pairs;
  if (ONLY) console.log(`only: rules containing "${ONLY}" (${pairs.length} of ${planned.pairs.length} merges)`);
  const funded = (rs: Row[]) => rs.filter((r) => r.aum > 0).length;
  const losers = new Set(pairs.map((p) => p.loser.id));
  console.log(`now: ${rows.length} live records · ${funded(rows)} holding money`);
  const byRule = new Map<string, number>();
  for (const p of pairs) byRule.set(p.rule, (byRule.get(p.rule) ?? 0) + 1);
  for (const [r, n] of byRule) console.log(`  merge — ${r}: ${n}`);
  for (const p of pairs.slice(0, 8)) console.log(`    e.g. ${p.loser.name} [${p.loser.pan ?? "placeholder"}] ${lakh(p.loser.aum)} → ${p.survivor.name} [${p.survivor.pan}] ${lakh(p.survivor.aum)}`);
  const after = rows.filter((r) => !losers.has(r.id));
  const survivorsGaining = new Set(pairs.filter((p) => p.loser.aum > 0).map((p) => p.survivor.id));
  console.log(`after: ${after.length} live records · about ${funded(after) - 0} holding money (${survivorsGaining.size} survivors absorb money)`);
  console.log(`\nfor a person to decide (${review.length}):`);
  for (const line of review.slice(0, 30)) console.log("  " + line);
  if (!APPLY) return;

  let merged = 0, failed = 0;
  for (let i = 0; i < pairs.length; i += 25) {
    await withTenant(T, async (tx) => {
      for (const p of pairs.slice(i, i + 25)) {
        await tx.execute(sql`SAVEPOINT dup_pair`);
        try {
          const res = await mergeInvestors(tx, {
            tenantId: T, survivorId: p.survivor.id, loserId: p.loser.id, byUserId: null, source: "system",
            reason: `Duplicate client (${p.rule})`, allowPanMismatch: p.mismatch,
          });
          if (!("ok" in res)) throw new Error(res.error);
          await tx.execute(sql`RELEASE SAVEPOINT dup_pair`);
          merged++;
        } catch (e) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT dup_pair`);
          failed++;
          console.error(`  ! ${p.loser.name}: ${(e as Error).message}`);
        }
      }
    });
  }
  const final = await load();
  console.log(`\nmerged ${merged}, failed ${failed} · now ${final.length} live records · ${funded(final)} holding money`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
