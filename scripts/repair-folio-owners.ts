/**
 * Give every folio back to the client who really holds it.
 *
 * Two ways a folio ends up on the wrong client (both fixed in the importer —
 * lib/rta/client-match.ts, lib/rta/import.ts, lib/rta/kfintech.ts):
 *
 *  1. A registrar file whose PAN column was not read keyed each row on the
 *     investor's email / name instead (rta_nopan_key 'NOPAN:…') and MOVED the
 *     folio off the PAN client the master had put it on. On Ahpal Financial
 *     Services the KFintech MFSD203 of 18 Sep 2026 did this to 5,272 folios
 *     (Rs 197.90 Cr): 1,599 email-keyed "clients", each in fact a family
 *     sharing an email, and the real PAN clients left at Rs 0.
 *  2. A folio sitting on a record an operator merged away (the importer used
 *     to send folios back to the retired record): invisible in the CRM.
 *
 * The proof of ownership is folio by folio, never a name:
 *   - on a merged-away record → the record it was merged into;
 *   - on a no-PAN placeholder → the ONE live client with a PAN who owns that
 *     folio's transactions (the daily feed attaches each transaction by the
 *     row's PAN). No such client, or several, and the folio stays put.
 * The folio's transactions and SIPs move with it. A placeholder left with
 * nothing is merged into the client who took most of its folios (the ordinary
 * merge: logged, reversible from Merge Clients); every client touched is
 * revalued.
 *
 * Dry run by default; --apply writes. Self-contained on purpose (it uses only
 * withTenant, mergeInvestors and recomputeInvestorAum), so it can run against
 * an older deployed build. Every move is printed to --log (CSV) for the record.
 *
 *   tsx scripts/repair-folio-owners.ts --tenant <uuid>
 *   tsx scripts/repair-folio-owners.ts --tenant <uuid> --apply --log /tmp/folio-moves.csv
 */

import "dotenv/config";
import { refuseIfRtaWritesStopped } from "./lib/rta-script-guard";
import { appendFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { mergeInvestors } from "../src/lib/investors/merge";
import { recomputeInvestorAum } from "../src/lib/finance/aum-persist";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const T = opt("tenant");
const APPLY = args.includes("--apply");
const LOG = opt("log") ?? "/tmp/folio-moves.csv";
const cr = (n: number) => `Rs ${(n / 1e7).toFixed(2)} Cr`;

type Move = { folioId: string; folio: string; from: string; to: string; aum: number; why: "merged-away owner" | "transaction owner" };

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function totals() {
  return withTenant(T!, async (tx) => {
    const r = (await tx.execute(sql`
      SELECT count(*)::int AS clients,
             count(*) FILTER (WHERE COALESCE(aum,0) > 0)::int AS funded,
             COALESCE(sum(aum),0)::numeric AS aum
        FROM investors WHERE tenant_id = ${T}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
         AND COALESCE(status,'') NOT IN ('closed','exited')
    `)).rows[0] as any;
    const f = (await tx.execute(sql`
      SELECT count(*)::int AS folios, count(*) FILTER (WHERE f.aum > 0)::int AS valued, COALESCE(sum(f.aum),0)::numeric AS aum
        FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${T}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
    `)).rows[0] as any;
    return { clients: r.clients, funded: r.funded, aum: Number(r.aum), folios: f.folios, valued: f.valued, folioAum: Number(f.aum) };
  });
}

async function plan(): Promise<{ moves: Move[]; unproven: { folios: number; aum: number } }> {
  return withTenant(T!, async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '300s'`);
    // Every client id → the live client it ended up in (merges followed).
    const chain = (await tx.execute(sql`
      WITH RECURSIVE c AS (
        SELECT id AS origin, id, merged_into_id, deleted_at, 0 AS d FROM investors WHERE tenant_id = ${T}::uuid AND merged_into_id IS NOT NULL
        UNION ALL
        SELECT c.origin, s.id, s.merged_into_id, s.deleted_at, c.d + 1 FROM c JOIN investors s ON s.id = c.merged_into_id AND s.tenant_id = ${T}::uuid WHERE c.d < 8
      )
      SELECT DISTINCT ON (origin) origin, id, (merged_into_id IS NULL AND deleted_at IS NULL) AS live FROM c ORDER BY origin, d DESC
    `)).rows as Array<{ origin: string; id: string; live: boolean }>;
    const liveOf = new Map<string, string>();
    for (const r of chain) if (r.live) liveOf.set(String(r.origin), String(r.id));
    const people = (await tx.execute(sql`
      SELECT id, pan IS NOT NULL AS has_pan, (merged_into_id IS NULL AND deleted_at IS NULL) AS live,
             (pan IS NULL AND rta_nopan_key LIKE 'NOPAN:%') AS placeholder
        FROM investors WHERE tenant_id = ${T}::uuid
    `)).rows as Array<{ id: string; has_pan: boolean; live: boolean; placeholder: boolean }>;
    const who = new Map(people.map((p) => [String(p.id), p]));
    const live = (id: string) => (who.get(id)?.live ? id : liveOf.get(id) ?? null);

    const folios = (await tx.execute(sql`
      SELECT f.id, f.folio_number, f.investor_id, COALESCE(f.aum,0)::numeric AS aum,
             (SELECT array_agg(DISTINCT x.investor_id::text) FROM transactions x
               WHERE x.tenant_id = ${T}::uuid AND x.folio_id = f.id AND x.investor_id <> f.investor_id) AS txn_owners
        FROM folios f JOIN investors o ON o.id = f.investor_id
       WHERE f.tenant_id = ${T}::uuid
         AND (o.merged_into_id IS NOT NULL OR (o.deleted_at IS NULL AND o.pan IS NULL AND o.rta_nopan_key LIKE 'NOPAN:%'))
    `)).rows as Array<{ id: string; folio_number: string; investor_id: string; aum: string; txn_owners: string[] | null }>;

    const moves: Move[] = [];
    const unproven = { folios: 0, aum: 0 };
    for (const f of folios) {
      const owner = String(f.investor_id);
      const o = who.get(owner)!;
      const aum = Number(f.aum);
      if (!o.live) {
        const to = liveOf.get(owner);
        if (to) moves.push({ folioId: String(f.id), folio: f.folio_number, from: owner, to, aum, why: "merged-away owner" });
        else { unproven.folios++; unproven.aum += aum; }
        continue;
      }
      // A live placeholder: the one live PAN client who owns its transactions.
      const owners = new Set<string>();
      for (const t of f.txn_owners ?? []) {
        const l = live(String(t));
        if (l && l !== owner && who.get(l)?.has_pan) owners.add(l);
      }
      if (owners.size === 1) moves.push({ folioId: String(f.id), folio: f.folio_number, from: owner, to: [...owners][0], aum, why: "transaction owner" });
      else { unproven.folios++; unproven.aum += aum; }
    }
    return { moves, unproven };
  });
}

async function main() {
  if (!T) throw new Error("Pass --tenant <uuid>. Add --apply to write.");
  // A firm under RTA governance (validate-first, paused, halted, emergency) is
  // never rewritten by a script — the release's write guard (B-1 integration).
  if (APPLY) await refuseIfRtaWritesStopped(T, "repair-folio-owners");
  console.log(APPLY ? "APPLY — writing changes" : "DRY RUN — nothing is written (add --apply)");
  const before = await totals();
  console.log(`\nnow:   ${before.clients} live clients, ${before.funded} holding money, ${cr(before.aum)} (folio register ${cr(before.folioAum)}); ${before.folios} folios, ${before.valued} with a balance`);

  const { moves, unproven } = await plan();
  const merged = moves.filter((m) => m.why === "merged-away owner");
  const byTxn = moves.filter((m) => m.why === "transaction owner");
  const sum = (ms: Move[]) => ms.reduce((s, m) => s + m.aum, 0);
  console.log(`\nfolios to move:`);
  console.log(`  off merged-away records → their survivor: ${merged.length} (${cr(sum(merged))})`);
  console.log(`  off no-PAN placeholders → the PAN client who owns their transactions: ${byTxn.length} (${cr(sum(byTxn))})`);
  console.log(`  left where they are (no single proven owner): ${unproven.folios} (${cr(unproven.aum)})`);
  const losers = new Set(moves.map((m) => m.from));
  const takers = new Set(moves.map((m) => m.to));
  console.log(`  clients giving folios: ${losers.size} · receiving: ${takers.size}`);

  // What the book looks like once the moves are made (folio register view).
  const held = await withTenant(T, async (tx) =>
    (await tx.execute(sql`
      SELECT f.id, f.investor_id, COALESCE(f.aum,0)::numeric AS aum,
             (i.merged_into_id IS NULL AND i.deleted_at IS NULL) AS live
        FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${T}::uuid AND COALESCE(f.aum,0) > 0
    `)).rows as Array<{ id: string; investor_id: string; aum: string; live: boolean }>,
  );
  const moved = new Map(moves.map((m) => [m.folioId, m.to]));
  const owners = new Set<string>();
  let aumAfter = 0, foliosAfter = 0;
  for (const f of held) {
    const to = moved.get(String(f.id));
    if (!to && !f.live) continue;
    owners.add(to ?? String(f.investor_id));
    aumAfter += Number(f.aum);
    foliosAfter++;
  }
  console.log(`\nprojected: ${owners.size} clients holding money · ${foliosAfter} folios with a balance · folio register ${cr(aumAfter)}`);
  if (!APPLY) return;

  writeFileSync(LOG, "folio_id,folio_number,from_investor,to_investor,aum,why\n");
  let done = 0;
  for (const part of chunk(moves, 200)) {
    await withTenant(T, async (tx) => {
      for (const m of part) {
        const r = await tx.execute(sql`
          UPDATE folios SET investor_id = ${m.to}::uuid, updated_at = now()
           WHERE tenant_id = ${T}::uuid AND id = ${m.folioId}::uuid AND investor_id = ${m.from}::uuid RETURNING id
        `);
        if (!r.rows.length) continue; // changed since planning
        for (const table of ["transactions", "sips"]) {
          await tx.execute(sql`
            UPDATE ${sql.raw(table)} SET investor_id = ${m.to}::uuid, updated_at = now()
             WHERE tenant_id = ${T}::uuid AND folio_id = ${m.folioId}::uuid AND investor_id = ${m.from}::uuid
          `);
        }
        appendFileSync(LOG, `${m.folioId},${m.folio},${m.from},${m.to},${m.aum},${m.why}\n`);
      }
    });
    done += part.length;
    console.log(`  moved ${done}/${moves.length}`);
  }

  // Settle the clients that gave folios away.
  const tally = new Map<string, Map<string, number>>();
  for (const m of moves) {
    const t = tally.get(m.from) ?? new Map<string, number>();
    t.set(m.to, (t.get(m.to) ?? 0) + 1);
    tally.set(m.from, t);
  }
  let mergedAway = 0, zeroed = 0, revalued = 0;
  for (const part of chunk([...losers], 25)) {
    await withTenant(T, async (tx) => {
      for (const id of part) {
        const s = (await tx.execute(sql`
          SELECT i.merged_into_id IS NOT NULL AS merged, (i.pan IS NULL AND i.rta_nopan_key LIKE 'NOPAN:%') AS placeholder,
                 EXISTS (SELECT 1 FROM folios f WHERE f.investor_id = i.id) AS has_folio,
                 EXISTS (SELECT 1 FROM transactions x WHERE x.investor_id = i.id) AS has_txn
            FROM investors i WHERE i.tenant_id = ${T}::uuid AND i.id = ${id}::uuid
        `)).rows[0] as any;
        if (!s) continue;
        const empty = !s.has_folio && !s.has_txn;
        if (s.merged || empty) {
          // A retired record, or an emptied one: nothing backs its cached AUM.
          await tx.execute(sql`UPDATE investors SET aum = 0, active_sip_amount = 0, updated_at = now() WHERE tenant_id = ${T}::uuid AND id = ${id}::uuid AND (COALESCE(aum,0) <> 0 OR COALESCE(active_sip_amount,0) <> 0)`);
          zeroed++;
        }
        if (!s.merged && empty && s.placeholder) {
          const to = [...(tally.get(id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (to) {
            const res = await mergeInvestors(tx, {
              tenantId: T, survivorId: to, loserId: id, byUserId: null, source: "system",
              reason: "Placeholder from a registrar file whose PAN was not read; its folios belong to this client (proven by their transactions)",
            });
            if ("ok" in res) mergedAway++;
          }
        } else if (!s.merged && !empty) {
          await recomputeInvestorAum(tx, id);
          revalued++;
        }
      }
    });
  }
  let n = 0;
  for (const part of chunk([...takers], 25)) {
    await withTenant(T, async (tx) => {
      for (const id of part) await recomputeInvestorAum(tx, id);
    });
    n += part.length;
    if (n % 500 < 25) console.log(`  revalued receivers ${n}/${takers.size}`);
  }
  console.log(`\nplaceholders merged away: ${mergedAway} · emptied/retired zeroed: ${zeroed} · givers revalued: ${revalued} · receivers revalued: ${takers.size}`);
  console.log(`moves logged to ${LOG}`);

  const after = await totals();
  console.log(`\nafter: ${after.clients} live clients, ${after.funded} holding money, ${cr(after.aum)} (folio register ${cr(after.folioAum)}); ${after.folios} folios, ${after.valued} with a balance`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
