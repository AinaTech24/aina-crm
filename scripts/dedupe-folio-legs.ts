/**
 * Remove scheme legs that repeat another leg of the same folio.
 *
 * The CAMS monthly AUM statement names a holding by the registrar's own code
 * ("D157", "G203", "L021G") and no scheme name; the folio master and holdings
 * files name it by AMFI code and scheme name. The merge matched a leg by code
 * or by name, so neither matched and the folio kept both — same units, valued
 * twice. On Nimesh C Shah (8 Oct 2026) 408 blank-name legs held Rs 7.87 Cr,
 * almost all of it a repeat of a named leg:
 *
 *   folio 2305113/82  D157    ""                                  25,862.605 u
 *                     105989  "DSP Small Cap Fund - Regular - G"  25,862.605 u
 *
 * Two legs of one folio are one holding when their units agree to 0.001 AND
 *   - one of them has no scheme name, or
 *   - one carries no real ARN (none, "0", "NOT PROVIDED") — a report with no
 *     broker column restating the holding.
 * Two NAMED legs under the same real ARN are left alone (two options of one
 * scheme can hold equal units), and so are two different real ARNs (the halves
 * of a split holding, which add up).
 *
 * The leg kept is the named one with an AMFI (numeric) code — what live-NAV
 * revaluation prices — taking the real ARN from the dropped leg when it had
 * none. Folio aum is re-summed from the kept legs. Clients' investors.aum is
 * NOT recomputed here; the valuation already pairs these twins by units.
 *
 * Dry run by default; --apply writes, one transaction per 500 folios.
 *   tsx scripts/dedupe-folio-legs.ts --tenant <uuid> [--apply]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";

const args = process.argv.slice(2);
const T = args[args.indexOf("--tenant") + 1];
const APPLY = args.includes("--apply");
const cr = (n: number) => `Rs ${(n / 1e7).toFixed(2)} Cr`;

type Leg = { schemeCode?: string; schemeName?: string; arn?: string; units?: number | string; value?: number | string; [k: string]: unknown };

const realArn = (a: unknown) => {
  const s = String(a ?? "").trim().toUpperCase();
  return s && s !== "0" && s !== "NOT PROVIDED" ? s : null;
};
const named = (l: Leg) => String(l.schemeName ?? "").trim() !== "";
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The legs to keep, and the value removed. Pure. */
export function dedupeLegs(legs: Leg[]): { kept: Leg[]; dropped: number; droppedValue: number } {
  const kept: Leg[] = [];
  let dropped = 0, droppedValue = 0;
  for (const leg of legs) {
    const u = num(leg.units);
    const twinAt = u > 0.001
      ? kept.findIndex((k) => {
          if (Math.abs(num(k.units) - u) > 0.001) return false;
          const a = realArn(k.arn), b = realArn(leg.arn);
          if (!named(k) || !named(leg)) return !(a && b && a !== b);
          return (a == null) !== (b == null);
        })
      : -1;
    if (twinAt < 0) { kept.push({ ...leg }); continue; }
    const k = kept[twinAt];
    // Prefer the named leg with an AMFI code; carry a real ARN across.
    const score = (l: Leg) => Number(named(l)) * 2 + Number(/^\d+$/.test(String(l.schemeCode ?? "")));
    const [win, lose] = score(leg) > score(k) ? [leg, k] : [k, leg];
    const merged: Leg = { ...win };
    if (!realArn(win.arn) && realArn(lose.arn)) merged.arn = lose.arn;
    kept[twinAt] = merged;
    dropped++;
    droppedValue += num(lose.value);
  }
  return { kept, dropped, droppedValue };
}

async function main() {
  if (!T || T.startsWith("--")) throw new Error("Pass --tenant <uuid>. Add --apply to write.");
  console.log(APPLY ? "APPLY — writing changes" : "DRY RUN — nothing is written (add --apply)");
  const folios = await withTenant(T, async (tx) =>
    (await tx.execute(sql`
      SELECT id, folio_number, schemes, COALESCE(aum, 0)::numeric AS aum FROM folios
       WHERE tenant_id = ${T}::uuid AND jsonb_array_length(COALESCE(schemes, '[]'::jsonb)) > 1
    `)).rows as Array<{ id: string; folio_number: string; schemes: Leg[]; aum: string }>,
  );
  const before = folios.reduce((t, f) => t + Number(f.aum), 0);
  const changes: Array<{ id: string; schemes: Leg[]; aum: number }> = [];
  let legs = 0, value = 0;
  for (const f of folios) {
    const r = dedupeLegs(f.schemes ?? []);
    if (!r.dropped) continue;
    legs += r.dropped;
    value += r.droppedValue;
    changes.push({ id: String(f.id), schemes: r.kept, aum: Math.round(r.kept.reduce((t, l) => t + num(l.value), 0) * 100) / 100 });
  }
  console.log(`folios with more than one leg: ${folios.length} (${cr(before)})`);
  console.log(`repeated legs to drop: ${legs} in ${changes.length} folios, ${cr(value)}`);
  if (!APPLY) return;
  for (let i = 0; i < changes.length; i += 500) {
    await withTenant(T, async (tx) => {
      for (const c of changes.slice(i, i + 500)) {
        await tx.execute(sql`
          UPDATE folios SET schemes = ${JSON.stringify(c.schemes)}::jsonb, aum = ${c.aum}::numeric, updated_at = now()
           WHERE id = ${c.id}::uuid AND tenant_id = ${T}::uuid
        `);
      }
    });
    console.log(`  ${Math.min(i + 500, changes.length)}/${changes.length}`);
  }
  const after = await withTenant(T, async (tx) =>
    ((await tx.execute(sql`
      SELECT COALESCE(sum(f.aum), 0)::numeric AS s FROM folios f JOIN investors i ON i.id = f.investor_id
       WHERE f.tenant_id = ${T}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
    `)).rows[0] as { s: string }).s,
  );
  console.log(`folio register (live clients) after: ${cr(Number(after))}`);
}

if (process.argv[1]?.includes("dedupe-folio-legs")) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
