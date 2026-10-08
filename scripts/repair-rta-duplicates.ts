/**
 * Fold the duplicate clients RTA imports created back into the firm's own
 * records, and put each PAN back on the client that should carry it.
 *
 * Why they exist (fixed in lib/rta/client-match.ts): the importer matched a
 * registrar row with a bare `pan = …`, so
 *   A. a client loaded from the firm's Excel list (dedup_pan = false) was
 *      invisible to the PAN upsert and got a same-PAN twin;
 *   B. a client the firm entered WITHOUT a PAN got a twin carrying the PAN
 *      (all 8,568 of Ahpal's 9 Sep 2026 client master are PAN-less);
 *   C. a placeholder a no-PAN report (CAMS WBR22) or a feed stood up kept its
 *      folios / history next to the real client of the same name;
 *   D. after a merge the retired record kept the PAN slot, so the next file
 *      sent the folios back to it.
 *
 * What it does, per tenant, in this order:
 *   A. live clients sharing a PAN → merged into one survivor: the firm's
 *      record first (has an RM, then loaded from Excel), then the oldest;
 *   B. a PAN-less firm record and exactly one live PAN client with the same
 *      name (letters/digits, words in any order, honorifics ignored; at least
 *      two words; no other PAN-less record or PAN client of that name; no
 *      conflicting date of birth; both minors or both adults) → the PAN client
 *      is merged into the firm's record, which then takes the PAN;
 *   C. (only with --placeholders) a no-PAN placeholder that still holds
 *      folios or transactions and exactly one live PAN client of that name →
 *      merged into it;
 *   D. every PAN's slot moved to its live client (lib/rta/client-match).
 * Every merge is the ordinary one (lib/investors/merge): logged in
 * investor_merges, reversible from Merge Clients, and pairs the firm marked
 * "not duplicates" are left alone.
 *
 * Dry run by default; --apply writes, one transaction per batch of 25.
 * HEAVY on a large book (each merge touches every child table) — run it out of
 * hours, one tenant at a time, and watch the database. --limit N caps the
 * merges per step.
 *
 *   tsx scripts/repair-rta-duplicates.ts --tenant <uuid>
 *   tsx scripts/repair-rta-duplicates.ts --tenant <uuid> --apply [--placeholders] [--limit 500]
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { mergeInvestors } from "../src/lib/investors/merge";
import { nameMatchKey, resolvePanClients } from "../src/lib/rta/client-match";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TENANT = opt("tenant");
const APPLY = args.includes("--apply");
const PLACEHOLDERS = args.includes("--placeholders");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const BATCH = 25;

type Pair = { survivorId: string; loserId: string; label: string; givePan?: string; reason: string };

const cr = (n: number) => `Rs ${(n / 1e7).toFixed(2)} Cr`;
const day = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

async function totals(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const r = (await tx.execute(sql`
      SELECT COUNT(*)::int AS clients, COALESCE(SUM(aum), 0)::numeric AS aum,
             COUNT(*) FILTER (WHERE pan IS NULL)::int AS no_pan
        FROM investors
       WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
         AND COALESCE(status, '') NOT IN ('closed', 'exited')
    `)).rows[0] as { clients: number; aum: string; no_pan: number };
    const t = (await tx.execute(sql`SELECT COALESCE(display_name, legal_name) AS name FROM tenants WHERE id = ${tenantId}::uuid`)).rows[0] as { name?: string } | undefined;
    return { name: t?.name ?? tenantId, clients: r.clients, aum: Number(r.aum), noPan: r.no_pan };
  });
}

type Row = {
  id: string; name: string | null; pan: string | null; rm_id: string | null; dedup_pan: boolean;
  rta_nopan_key: string | null; is_minor: boolean | null; dob: unknown; created_at: unknown;
  has_data: boolean;
};

async function plan(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT i.id, i.name, upper(nullif(trim(i.pan), '')) AS pan, i.rm_id, i.dedup_pan, i.rta_nopan_key,
             i.is_minor, i.dob, i.created_at,
             (EXISTS (SELECT 1 FROM folios f WHERE f.tenant_id = i.tenant_id AND f.investor_id = i.id)
              OR EXISTS (SELECT 1 FROM transactions x WHERE x.tenant_id = i.tenant_id AND x.investor_id = i.id)) AS has_data
        FROM investors i
       WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
         AND COALESCE(i.status, '') NOT IN ('closed', 'exited')
    `)).rows as Row[];
    const ignored = (await tx.execute(sql`
      SELECT key1_id, key2_id FROM ignored_duplicates
       WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'client'
    `)).rows as Array<{ key1_id: string; key2_id: string }>;
    const ignoredPairs = new Set(ignored.map((p) => [String(p.key1_id), String(p.key2_id)].sort().join("|")));
    const isIgnored = (a: string, b: string) => ignoredPairs.has([a, b].sort().join("|"));

    // A. Same PAN.
    const byPan = new Map<string, Row[]>();
    for (const r of rows) if (r.pan) byPan.set(r.pan, [...(byPan.get(r.pan) ?? []), r]);
    const samePan: Pair[] = [];
    for (const [pan, group] of byPan) {
      if (group.length < 2) continue;
      group.sort((a, b) =>
        Number(!!b.rm_id) - Number(!!a.rm_id) ||
        Number(a.dedup_pan) - Number(b.dedup_pan) ||
        new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime());
      const [survivor, ...rest] = group;
      for (const l of rest) {
        if (isIgnored(survivor.id, l.id)) continue;
        samePan.push({ survivorId: String(survivor.id), loserId: String(l.id), label: `${survivor.name} [${pan}]`, reason: "Same PAN; a registrar import created a second client for it" });
      }
    }

    // B / C. By name.
    const panClientsByName = new Map<string, Row[]>();
    const firmNoPanByName = new Map<string, Row[]>();
    const placeholdersByName = new Map<string, Row[]>();
    for (const r of rows) {
      const nk = nameMatchKey(r.name);
      if (!nk || nk.split(" ").length < 2) continue;
      const m = r.pan ? panClientsByName : r.rta_nopan_key ? ((r.rta_nopan_key ?? "").startsWith("NOPAN:") ? placeholdersByName : null) : firmNoPanByName;
      if (m) m.set(nk, [...(m.get(nk) ?? []), r]);
    }
    // One person per PAN in the name index (same-PAN twins count once).
    const distinctPans = (rs: Row[]) => [...new Map(rs.map((r) => [r.pan, r])).values()];
    const compatible = (a: Row, b: Row) => {
      if (!!a.is_minor !== !!b.is_minor) return false;
      const da = day(a.dob), db = day(b.dob);
      return !(da && db && da !== db);
    };
    const byName: Pair[] = [];
    const placeholderPairs: Pair[] = [];
    for (const [nk, firm] of firmNoPanByName) {
      const pc = distinctPans(panClientsByName.get(nk) ?? []);
      if (firm.length !== 1 || pc.length !== 1) continue;
      const survivor = firm[0];
      // The PAN client's twins (step A) fold into the PAN client first; take
      // the one step A keeps.
      const panGroup = byPan.get(pc[0].pan!)!;
      const loser = panGroup[0];
      if (!compatible(survivor, loser) || isIgnored(survivor.id, loser.id)) continue;
      byName.push({ survivorId: String(survivor.id), loserId: String(loser.id), label: `${survivor.name} ← ${loser.name} [${loser.pan}]`, givePan: loser.pan!, reason: "Same client by name; the firm's record had no PAN and a registrar import created one with it" });
    }
    for (const [nk, phs] of placeholdersByName) {
      const pc = distinctPans(panClientsByName.get(nk) ?? []);
      if (pc.length !== 1 || (firmNoPanByName.get(nk)?.length ?? 0) > 0) continue;
      const target = byPan.get(pc[0].pan!)![0];
      for (const ph of phs) {
        if (!ph.has_data || !compatible(ph, target) || isIgnored(ph.id, target.id)) continue;
        placeholderPairs.push({ survivorId: String(target.id), loserId: String(ph.id), label: `${target.name} [${target.pan}] ← placeholder ${ph.name}`, reason: "Placeholder from a registrar report with no PAN; the same client by name holds the PAN" });
      }
    }
    return { samePan, byName, placeholderPairs, pans: [...byPan.keys()] };
  });
}

async function applyPairs(tenantId: string, pairs: Pair[], step: string) {
  let merged = 0, failed = 0;
  const work = pairs.slice(0, LIMIT);
  for (let i = 0; i < work.length; i += BATCH) {
    await withTenant(tenantId, async (tx) => {
      for (const p of work.slice(i, i + BATCH)) {
        await tx.execute(sql`SAVEPOINT repair_pair`);
        try {
          // Both still live? (an earlier pair may have merged one away)
          const live = (await tx.execute(sql`
            SELECT count(*)::int AS n FROM investors
             WHERE tenant_id = ${tenantId}::uuid AND id IN (${p.survivorId}::uuid, ${p.loserId}::uuid)
               AND deleted_at IS NULL AND merged_into_id IS NULL
          `)).rows[0] as { n: number };
          if (live.n !== 2) { await tx.execute(sql`RELEASE SAVEPOINT repair_pair`); continue; }
          const res = await mergeInvestors(tx, {
            tenantId, survivorId: p.survivorId, loserId: p.loserId, byUserId: null, source: "system", reason: p.reason,
          });
          if (!("ok" in res)) throw new Error(res.error);
          if (p.givePan) {
            await tx.execute(sql`
              UPDATE investors SET dedup_pan = false, updated_at = now()
               WHERE tenant_id = ${tenantId}::uuid AND pan = ${p.givePan} AND dedup_pan AND id <> ${p.survivorId}::uuid
            `);
            await tx.execute(sql`
              UPDATE investors SET pan = ${p.givePan}, dedup_pan = true, updated_at = now()
               WHERE tenant_id = ${tenantId}::uuid AND id = ${p.survivorId}::uuid AND pan IS NULL
            `);
          }
          await tx.execute(sql`RELEASE SAVEPOINT repair_pair`);
          merged++;
        } catch (e) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT repair_pair`);
          failed++;
          console.error(`    ! ${p.label}: ${(e as Error).message}`);
        }
      }
    });
    console.log(`  ${step}: ${Math.min(i + BATCH, work.length)}/${work.length}`);
  }
  return { merged, failed };
}

function show(title: string, pairs: Pair[]) {
  console.log(`  ${title}: ${pairs.length}`);
  for (const p of pairs.slice(0, 8)) console.log(`      e.g. ${p.label}`);
}

async function main() {
  if (!TENANT) throw new Error("Pass --tenant <uuid>. Add --apply to write.");
  console.log(APPLY ? "APPLY — writing changes" : "DRY RUN — nothing is written (add --apply)");
  const before = await totals(TENANT);
  console.log(`\n${before.name} (${TENANT})`);
  console.log(`  now: ${before.clients} live clients (${before.noPan} without a PAN) · ${cr(before.aum)}`);

  const p1 = await plan(TENANT);
  show("A. same-PAN twins to merge", p1.samePan);
  show("B. PAN-less firm records matched by name", p1.byName);
  show(`C. placeholders holding data, same name as one PAN client${PLACEHOLDERS ? "" : " (skipped without --placeholders)"}`, p1.placeholderPairs);
  if (!APPLY) return;

  const a = await applyPairs(TENANT, p1.samePan, "A");
  console.log(`  A done: merged ${a.merged}, failed ${a.failed}`);
  // B and C are planned again: step A changed who survives.
  const p2 = await plan(TENANT);
  const b = await applyPairs(TENANT, p2.byName, "B");
  console.log(`  B done: merged ${b.merged}, failed ${b.failed}`);
  if (PLACEHOLDERS) {
    const p3 = await plan(TENANT);
    const c = await applyPairs(TENANT, p3.placeholderPairs, "C");
    console.log(`  C done: merged ${c.merged}, failed ${c.failed}`);
  }

  // D. Every PAN's slot on its live client.
  const pans = (await plan(TENANT)).pans;
  const retired = await withTenant(TENANT, async (tx) =>
    (await tx.execute(sql`
      SELECT DISTINCT upper(trim(pan)) AS pan FROM investors
       WHERE tenant_id = ${TENANT}::uuid AND pan IS NOT NULL AND (merged_into_id IS NOT NULL OR NOT dedup_pan)
    `)).rows.map((r) => String((r as { pan: string }).pan)),
  );
  const all = [...new Set([...pans, ...retired])];
  let claimed = 0;
  for (let i = 0; i < all.length; i += 2000) {
    claimed += await withTenant(TENANT, async (tx) => (await resolvePanClients(tx, TENANT, all.slice(i, i + 2000), { write: true })).claimed);
  }
  console.log(`  D done: ${claimed} PAN slot(s) moved to the live client`);

  const after = await totals(TENANT);
  console.log(`  after: ${after.clients} live clients (${after.noPan} without a PAN) · ${cr(after.aum)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
