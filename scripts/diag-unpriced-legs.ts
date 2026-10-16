/**
 * Which stored holdings does the NAV matcher still not price, per firm?
 *
 *   npx tsx scripts/diag-unpriced-legs.ts                 # every firm, current matcher
 *   npx tsx scripts/diag-unpriced-legs.ts --legacy        # the matcher as it was: AMFI only, no ISIN
 *   npx tsx scripts/diag-unpriced-legs.ts --tenant 55610354 --list 40
 *
 * Counts folio legs with units > 0 for which `lookupNav` (what revalueAllFolios
 * calls) finds no NAV, with their last stored value, and says how each priced
 * leg got its price (code / isin / name / nav / mfapi). `--legacy` indexes the
 * NAV master without mfapi's names, without the mfapi second source, and never
 * offers the leg's ISIN — a stand-in for "before" (the fuzzy-match tightening is
 * not undone; for an exact before, run this file's counterpart on the previous
 * commit).
 *
 * Read-only: one SELECT per tenant. Needs DATABASE_URL and ALLOW_SYSTEM_TX=1.
 * In prod the master URL lives only in the migrate service
 * (docker compose run --rm migrate npx tsx scripts/diag-unpriced-legs.ts).
 */
import "dotenv/config";
process.env.ALLOW_SYSTEM_TX = process.env.ALLOW_SYSTEM_TX ?? "1";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { buildNavIndex, loadNavIndex, lookupNav, type NavIndex, type NavSourceRow } from "@/lib/finance/scheme-match";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const LEGACY = process.argv.includes("--legacy");
const ONLY = arg("tenant");
const LIST = Number(arg("list") ?? 0);

type Leg = { schemeCode?: string; schemeName?: string; isin?: string; units?: number; nav?: number; value?: number };

const cr = (v: number) => `Rs ${(v / 1e7).toFixed(2)} Cr`;

async function main() {
  {
    const { index, tenants } = await withSystem(async (tx) => {
    let index: NavIndex;
    if (LEGACY) {
      const res = await tx.execute(sql`SELECT scheme_code, scheme_name, nav, nav_date FROM scheme_nav WHERE nav IS NOT NULL`);
      index = buildNavIndex(res.rows as NavSourceRow[]);
    } else {
      index = await loadNavIndex(tx);
    }
      const tenants = (await tx.execute(sql`SELECT id, name FROM tenants ORDER BY name`)).rows as Array<{ id: string; name: string }>;
      return { index, tenants };
    });
    console.log(`NAV index: ${index.size} AMFI schemes${index.fallback ? `, +${index.fallback.size} from mfapi` : ""}${LEGACY ? " (legacy)" : ""}`);

    let grand = { legs: 0, unpriced: 0, value: 0 };
    for (const t of tenants) {
      if (ONLY && !(t.id.startsWith(ONLY) || t.name.toLowerCase().includes(ONLY.toLowerCase()))) continue;
      // folios are tenant-scoped (RLS): read them inside the tenant, naming it as well.
      const rows = await withTenant(t.id, async (tx) =>
        (await tx.execute(sql`
          SELECT f.schemes FROM folios f
           WHERE f.tenant_id = ${t.id}::uuid AND jsonb_array_length(COALESCE(f.schemes, '[]'::jsonb)) > 0
        `)).rows as Array<{ schemes: Leg[] }>,
      );
      const via: Record<string, number> = {};
      const left = new Map<string, { name: string; code: string; n: number; value: number }>();
      let legs = 0, unpriced = 0, value = 0;
      for (const r of rows) {
        for (const s of r.schemes ?? []) {
          const units = Number(s.units ?? 0);
          if (!(units > 0)) continue;
          legs++;
          const hint = Number(s.nav) > 0 ? Number(s.nav) : null;
          const hit = lookupNav(index, s.schemeCode, s.schemeName, hint, LEGACY ? null : s.isin);
          if (hit) { via[hit.via] = (via[hit.via] ?? 0) + 1; continue; }
          unpriced++;
          value += Number(s.value ?? 0);
          const k = `${s.schemeCode}|${s.schemeName}`;
          const e = left.get(k) ?? { name: String(s.schemeName ?? ""), code: String(s.schemeCode ?? ""), n: 0, value: 0 };
          e.n++; e.value += Number(s.value ?? 0);
          left.set(k, e);
        }
      }
      grand = { legs: grand.legs + legs, unpriced: grand.unpriced + unpriced, value: grand.value + value };
      if (!legs) continue;
      console.log(
        `${t.id.slice(0, 8)} ${t.name.padEnd(34)} legs ${String(legs).padStart(6)}  unpriced ${String(unpriced).padStart(5)} ${cr(value).padStart(14)}   priced via ${JSON.stringify(via)}`,
      );
      if (LIST > 0) {
        for (const e of [...left.values()].sort((a, b) => b.value - a.value).slice(0, LIST)) {
          console.log(`    ${cr(e.value).padStart(12)}  x${String(e.n).padStart(3)}  [${e.code}] ${e.name}`);
        }
      }
    }
    console.log(`TOTAL legs ${grand.legs}  unpriced ${grand.unpriced}  ${cr(grand.value)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
