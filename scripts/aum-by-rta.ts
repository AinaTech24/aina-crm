/**
 * Where a firm's AUM actually comes from — split by registrar (CAMS vs KFintech).
 *
 *   npx tsx scripts/aum-by-rta.ts --tenant "VSN"
 *
 * Reports three things, because they answer three different questions and they
 * are NOT interchangeable:
 *
 *   1. Folio AUM by RTA      — `folios.aum` grouped by `folios.rta`. This is the
 *                              real answer to "how much came from CAMS vs KFin",
 *                              because the folio register is what a master /
 *                              holdings import writes.
 *   2. Coverage by RTA       — how many folios carry a value at all. A folio at
 *                              zero came from a MASTER file (which carries no
 *                              valuation) or from a scheme with no live NAV, so
 *                              a big zero-count is the signal that a valuation
 *                              file (KFintech MFSD203 / CAMS R9) is missing.
 *   3. Headline vs folio sum — `investors.aum` is what every dashboard reads. It
 *                              is the folio sum PLUS transaction value for
 *                              schemes the folios don't cover, so a gap between
 *                              the two is expected — but a LARGE gap usually
 *                              means the nightly revaluation hasn't run, or
 *                              merged-away clients are still holding stale AUM.
 *
 * Read-only. Requires DATABASE_URL and ALLOW_SYSTEM_TX=1.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const TENANT_Q = arg("tenant");

const n = (v: unknown) => Number(v ?? 0);
const cr = (v: unknown) => `₹${(n(v) / 1e7).toFixed(2)} Cr`;
const pad = (s: string | number, w: number) => String(s).padStart(w);
const padr = (s: string | number, w: number) => String(s).padEnd(w);

async function main() {
  if (!TENANT_Q) {
    console.error('Usage: npx tsx scripts/aum-by-rta.ts --tenant <uuid|name>');
    process.exit(1);
  }

  const tenants = await withSystem(async (tx) => {
    const isUuid = /^[0-9a-f-]{36}$/i.test(TENANT_Q);
    const r = await tx.execute(
      isUuid
        ? sql`SELECT id, name, arn FROM tenants WHERE id = ${TENANT_Q}::uuid`
        : sql`SELECT id, name, arn FROM tenants WHERE name ILIKE ${"%" + TENANT_Q + "%"} ORDER BY created_at LIMIT 10`
    );
    return r.rows as Array<{ id: string; name: string; arn: string | null }>;
  });
  if (!tenants.length) {
    console.error(`No tenant matched "${TENANT_Q}".`);
    process.exit(1);
  }
  if (tenants.length > 1) {
    console.error(`"${TENANT_Q}" matched ${tenants.length} tenants — re-run with the exact id:`);
    for (const t of tenants) console.error(`   ${t.id}  ${t.name}`);
    process.exit(1);
  }
  const tenant = tenants[0];
  console.log(`\n${tenant.name}   [${tenant.id}]   ARN ${tenant.arn ?? "(none)"}\n`);

  await withTenant(tenant.id, async (tx) => {
    // ── 1 + 2. Folio AUM and coverage, by registrar. Excludes soft-deleted
    //          clients so the total lines up with what the UI shows.
    const byRta = (await tx.execute(sql`
      SELECT COALESCE(f.rta::text, 'unknown')                       AS rta,
             count(*)::int                                          AS folios,
             count(*) FILTER (WHERE f.aum::numeric > 0)::int        AS valued,
             count(DISTINCT f.investor_id)::int                     AS clients,
             COALESCE(SUM(f.aum::numeric), 0)                       AS aum
        FROM folios f
        JOIN investors i ON i.id = f.investor_id
       WHERE i.deleted_at IS NULL
       GROUP BY 1
       ORDER BY aum DESC
    `)).rows as any[];

    const total = byRta.reduce((a, r) => a + n(r.aum), 0);
    console.log("AUM BY REGISTRAR (from the folio register)");
    console.log("  " + padr("RTA", 10) + pad("folios", 8) + pad("valued", 8) + pad("clients", 9) + pad("AUM", 16) + pad("share", 8));
    console.log("  " + "-".repeat(59));
    for (const r of byRta) {
      const share = total > 0 ? ((n(r.aum) / total) * 100).toFixed(1) + "%" : "—";
      console.log(
        "  " + padr(r.rta, 10) + pad(r.folios, 8) + pad(r.valued, 8) + pad(r.clients, 9) + pad(cr(r.aum), 16) + pad(share, 8)
      );
    }
    console.log("  " + "-".repeat(59));
    console.log("  " + padr("TOTAL", 10) + pad(byRta.reduce((a, r) => a + n(r.folios), 0), 8) + pad(byRta.reduce((a, r) => a + n(r.valued), 0), 8) + pad("", 9) + pad(cr(total), 16));

    // A folio at zero is the fingerprint of a master-only import.
    for (const r of byRta) {
      const zero = n(r.folios) - n(r.valued);
      if (zero > 0) {
        console.log(
          `\n  ⚠ ${r.rta}: ${zero} of ${r.folios} folios carry NO value. That is what a MASTER-only` +
          `\n    import looks like — import the valuation report (${r.rta === "kfintech" ? "KFintech MFSD203" : "CAMS R9/WBR9"}) to value them.`
        );
      }
    }

    // ── 3. Headline (what the dashboards read) vs the folio sum.
    const head = (await tx.execute(sql`
      SELECT COALESCE(SUM(aum::numeric), 0)                                  AS headline,
             count(*) FILTER (WHERE aum::numeric > 0)::int                   AS with_aum,
             count(*)::int                                                   AS clients,
             COALESCE(SUM(aum::numeric) FILTER (WHERE merged_into_id IS NOT NULL), 0) AS merged_stale,
             count(*) FILTER (WHERE merged_into_id IS NOT NULL AND aum::numeric > 0)::int AS merged_rows
        FROM investors WHERE deleted_at IS NULL
    `)).rows[0] as any;

    console.log(`\nHEADLINE (investors.aum — what the dashboard shows)`);
    console.log(`  ${cr(head.headline)}   across ${head.with_aum} of ${head.clients} clients`);
    const gap = n(head.headline) - total;
    if (Math.abs(gap) > 1) {
      console.log(`  gap vs folio sum: ${gap > 0 ? "+" : ""}${cr(gap)}`);
      console.log(`    Some gap is expected — the headline adds transaction-derived value for`);
      console.log(`    schemes the folios don't cover. A large one usually means the nightly`);
      console.log(`    revaluation hasn't run since the last import.`);
    }
    if (n(head.merged_rows) > 0) {
      console.log(`\n  ⚠ ${head.merged_rows} merged-away client(s) still hold ${cr(head.merged_stale)} of stale AUM.`);
      console.log(`    Their folios moved to the survivor, so this is counted twice on any`);
      console.log(`    surface that filters only on deleted_at (the main dashboard does).`);
    }

    // ── Per-AMC split within each registrar — the actionable detail when one
    //    registrar looks short: it names which AMCs are missing valuation.
    const byAmc = (await tx.execute(sql`
      SELECT COALESCE(f.rta::text, 'unknown') AS rta, f.amc_name,
             count(*)::int AS folios, COALESCE(SUM(f.aum::numeric), 0) AS aum
        FROM folios f
        JOIN investors i ON i.id = f.investor_id
       WHERE i.deleted_at IS NULL
       GROUP BY 1, 2
       ORDER BY 1, aum DESC
    `)).rows as any[];
    for (const rta of [...new Set(byAmc.map((r) => r.rta))]) {
      const rows = byAmc.filter((r) => r.rta === rta);
      console.log(`\n${String(rta).toUpperCase()} — top AMCs (${rows.length} total)`);
      for (const r of rows.slice(0, 10)) {
        console.log("  " + padr(r.amc_name ?? "(unnamed)", 42) + pad(r.folios, 7) + pad(cr(r.aum), 16));
      }
    }
    console.log("");
  }, { userId: "00000000-0000-0000-0000-000000000000", roles: ["owner"] });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ failed:", e?.message ?? e);
    process.exit(1);
  });
