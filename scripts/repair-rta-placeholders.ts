/**
 * Settle the PAN-less placeholder clients an RTA import left behind.
 *
 * A registrar report with no PAN column (CAMS WBR22, the monthly AUM
 * statement) stands up a placeholder client keyed on the investor's name
 * (rta_nopan_key 'NOPAN:…') when it meets a folio the book does not hold yet.
 * The folio master later moves that folio to the real, PAN-keyed client — and,
 * before lib/rta/former-owners.ts, left the placeholder behind with its AUM.
 * On Nimesh C Shah Financial Services that was 645 empty placeholders and
 * Rs 52.87 Cr counted twice (AUM read Rs 190.84 Cr against ~Rs 138 Cr).
 *
 * A placeholder here = no PAN, a NOPAN key, not merged, not deleted, and no
 * folio and no transaction left. For each one:
 *   - exactly ONE live client with the same name (letters and digits, any case) who
 *     holds folios → merge the placeholder into it (the ordinary merge: logged
 *     in investor_merges and reversible from Merge Clients);
 *   - otherwise (no such client, or several) → set its AUM to 0. Nothing
 *     backs that figure, and choosing between namesakes is a person's call.
 *
 * Dry run by default; --apply writes. One transaction per batch of 50.
 *
 * USAGE:
 *   tsx scripts/repair-rta-placeholders.ts --tenant <uuid> [--tenant <uuid> …]
 *   tsx scripts/repair-rta-placeholders.ts --tenant <uuid> --apply
 */

import { refuseIfRtaWritesStopped } from "./lib/rta-script-guard";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { mergeInvestors } from "../src/lib/investors/merge";

const args = process.argv.slice(2);
const TENANTS = args.flatMap((a, i) => (a === "--tenant" && args[i + 1] ? [args[i + 1]] : []));
const APPLY = args.includes("--apply");
const BATCH = 50;

type Plan = { id: string; name: string; aum: number; survivorId: string | null; namesakes: number };

const cr = (n: number) => `Rs ${(n / 1e7).toFixed(2)} Cr`;

async function firmTotals(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const r = (await tx.execute(sql`
      SELECT COALESCE(SUM(aum), 0)::numeric AS aum, COUNT(*)::int AS clients
        FROM investors
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
         AND COALESCE(status, '') NOT IN ('closed', 'exited')
    `)).rows[0] as { aum: string; clients: number };
    const t = (await tx.execute(sql`SELECT COALESCE(display_name, legal_name) AS name FROM tenants WHERE id = ${tenantId}::uuid`)).rows[0] as { name: string } | undefined;
    return { name: t?.name ?? tenantId, aum: Number(r.aum), clients: r.clients };
  });
}

async function planFor(tenantId: string): Promise<Plan[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = (await tx.execute(sql`
      WITH ph AS (
        SELECT i.id, i.name, COALESCE(i.aum, 0)::numeric AS aum,
               upper(regexp_replace(i.name, '[^A-Za-z0-9]', '', 'g')) AS nk
          FROM investors i
         WHERE i.tenant_id = ${tenantId}::uuid
           AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
           AND i.pan IS NULL AND i.rta_nopan_key LIKE 'NOPAN:%'
           AND NOT EXISTS (SELECT 1 FROM folios f WHERE f.investor_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.investor_id = i.id)
      )
      SELECT ph.id, ph.name, ph.aum,
             (SELECT array_agg(c.id::text) FROM investors c
               WHERE c.tenant_id = ${tenantId}::uuid AND c.id <> ph.id
                 AND c.deleted_at IS NULL AND c.merged_into_id IS NULL
                 AND ph.nk <> ''
                 AND upper(regexp_replace(c.name, '[^A-Za-z0-9]', '', 'g')) = ph.nk
                 AND EXISTS (SELECT 1 FROM folios f WHERE f.investor_id = c.id)) AS namesakes
        FROM ph
       ORDER BY ph.aum DESC
    `)).rows as Array<{ id: string; name: string; aum: string; namesakes: string[] | null }>;
    return rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      aum: Number(r.aum),
      namesakes: r.namesakes?.length ?? 0,
      survivorId: r.namesakes?.length === 1 ? r.namesakes[0] : null,
    }));
  });
}

async function applyBatch(tenantId: string, batch: Plan[]) {
  let merged = 0, zeroed = 0, skipped = 0;
  await withTenant(tenantId, async (tx) => {
    for (const p of batch) {
      // Re-check inside the transaction: still a placeholder, still empty.
      const still = (await tx.execute(sql`
        SELECT 1 FROM investors i
         WHERE i.id = ${p.id}::uuid AND i.tenant_id = ${tenantId}::uuid
           AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND i.pan IS NULL
           AND NOT EXISTS (SELECT 1 FROM folios f WHERE f.investor_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.investor_id = i.id)
      `)).rows.length;
      if (!still) { skipped++; continue; }
      if (p.survivorId) {
        const res = await mergeInvestors(tx, {
          tenantId,
          survivorId: p.survivorId,
          loserId: p.id,
          byUserId: null,
          source: "import",
          reason: "Placeholder from a registrar report with no PAN; same client by name, who holds the folios",
        });
        if ("ok" in res) { merged++; continue; }
      }
      const z = await tx.execute(sql`
        UPDATE investors SET aum = 0, updated_at = now()
         WHERE id = ${p.id}::uuid AND tenant_id = ${tenantId}::uuid AND COALESCE(aum, 0) <> 0
        RETURNING id
      `);
      if (z.rows.length) zeroed++; else skipped++;
    }
  });
  return { merged, zeroed, skipped };
}

async function main() {
  if (!TENANTS.length) throw new Error("Pass --tenant <uuid> (repeatable). Add --apply to write.");
  console.log(APPLY ? "APPLY — writing changes" : "DRY RUN — nothing is written (add --apply)");

  if (APPLY) for (const tenantId of TENANTS) await refuseIfRtaWritesStopped(tenantId, "repair-rta-placeholders");
  for (const tenantId of TENANTS) {
    const before = await firmTotals(tenantId);
    const plan = await planFor(tenantId);
    const toMerge = plan.filter((p) => p.survivorId);
    const toZero = plan.filter((p) => !p.survivorId && p.aum !== 0);
    const stale = plan.reduce((s, p) => s + p.aum, 0);
    console.log(`\n${before.name} (${tenantId})`);
    console.log(`  now:          ${cr(before.aum)} · ${before.clients} clients`);
    console.log(`  placeholders: ${plan.length} (carrying ${cr(stale)})`);
    console.log(`    merge into the one same-name client:  ${toMerge.length} (${cr(toMerge.reduce((s, p) => s + p.aum, 0))})`);
    console.log(`    AUM to 0 (no namesake / several):     ${toZero.length} (${cr(toZero.reduce((s, p) => s + p.aum, 0))}) — ${plan.filter((p) => p.namesakes > 1).length} with several namesakes`);
    console.log(`  expected:     ${cr(before.aum - stale)} · ${before.clients - toMerge.length} clients`);
    for (const p of plan.slice(0, 5)) {
      console.log(`    e.g. ${p.name} — ${cr(p.aum)} → ${p.survivorId ? `merge into ${p.survivorId.slice(0, 8)}` : `AUM 0 (${p.namesakes} namesakes)`}`);
    }
    if (!APPLY) continue;

    let merged = 0, zeroed = 0, skipped = 0;
    const work = plan.filter((p) => p.survivorId || p.aum !== 0);
    for (let i = 0; i < work.length; i += BATCH) {
      const r = await applyBatch(tenantId, work.slice(i, i + BATCH));
      merged += r.merged; zeroed += r.zeroed; skipped += r.skipped;
      console.log(`  … ${Math.min(i + BATCH, work.length)}/${work.length}`);
    }
    const after = await firmTotals(tenantId);
    console.log(`  done:         merged ${merged}, AUM zeroed ${zeroed}, skipped ${skipped}`);
    console.log(`  after:        ${cr(after.aum)} · ${after.clients} clients`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
