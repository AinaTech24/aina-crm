/**
 * Rewrite stored folio scheme codes to their AMFI code.
 *
 * WHY
 * ---
 * The holdings/AUM importer stores the REGISTRAR's product code on each folio
 * leg (`Y1035`, `FTI047`, `RMFGFGP`). `scheme_nav` — the daily AMFI NAVAll feed
 * — is keyed by AMFI's numeric code. Everything that joins a holding to a live
 * NAV therefore misses, and the leg keeps whatever price the import gave it.
 *
 * Measured on VSN Financial Services (ARN-90577) 2026-09-30: 17,637 of 19,867
 * legs unmatched, Rs 544.98 Cr of a Rs 627.42 Cr book frozen at its imported
 * value while the firm's headline AUM drifted by a few lakh a day.
 *
 * The rich importer already normalises codes via `lib/rta/resolve-scheme.ts`
 * (ISIN, then name). Stored legs do not keep the ISIN, so this matches on the
 * canonical scheme NAME, using the same normalisation the nightly revaluation
 * now uses (`lib/finance/scheme-match.ts`) — if the two disagreed, this script
 * would write codes the runtime still could not price.
 *
 * SAFETY
 * ------
 * - Dry run unless `--apply` is passed. The dry run writes nothing and prints
 *   exactly what would change.
 * - A leg is rewritten ONLY when its resolved AMFI code is not already present
 *   on another leg of the SAME folio. A collision means the holding is stored
 *   twice under two codes — the double-counting bug recorded at
 *   `lib/rta/process.ts:1121`, which overstated this very firm by Rs 158 Cr.
 *   Merging those is a judgement call about which leg is real, so they are
 *   REPORTED and left alone.
 * - Units, values and NAVs are never touched. Only `schemeCode` changes, so the
 *   firm's AUM is identical the moment this finishes; it changes on the next
 *   nightly revaluation, which can then actually price the leg.
 * - Scoped to one tenant with `--tenant <uuid>`, or all tenants without.
 *
 * USAGE
 * -----
 *   tsx scripts/backfill-folio-scheme-codes.ts                    # dry run, all firms
 *   tsx scripts/backfill-folio-scheme-codes.ts --tenant <uuid>    # dry run, one firm
 *   tsx scripts/backfill-folio-scheme-codes.ts --tenant <uuid> --apply
 */

import { rtaGovernedTenants } from "./lib/rta-script-guard";
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db/client";
import { loadNavIndex, normSchemeName, type NavIndex } from "../src/lib/finance/scheme-match";

type Leg = {
  schemeCode?: string | null;
  schemeName?: string | null;
  units?: number | null;
  nav?: number | null;
  value?: number | null;
  [k: string]: unknown;
};

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const tenantArg = args.indexOf("--tenant");
const TENANT: string | null = tenantArg >= 0 ? args[tenantArg + 1] ?? null : null;

const lakh = (n: number) => `Rs ${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} lakh`;

async function main() {
  console.log(`[backfill] ${APPLY ? "APPLY — writing changes" : "DRY RUN — nothing will be written"}`);
  console.log(`[backfill] scope: ${TENANT ? `tenant ${TENANT}` : "ALL tenants"}`);

  // This rewrites leg codes by NAME. A firm under RTA governance (any
  // activation, a halt) keeps evidence-only scheme identity (Phase 3H): skipped.
  const governed = await rtaGovernedTenants();
  if (APPLY && governed.emergency) { console.error(`[backfill] refused: emergency shutdown — ${governed.emergency}`); process.exit(1); }
  if (TENANT && governed.skip.has(TENANT)) { console.error(`[backfill] refused: firm ${TENANT} is under RTA governance — its scheme identity changes only by evidence`); process.exit(1); }
  const skipIds = [...governed.skip];
  if (skipIds.length) console.log(`[backfill] skipping ${skipIds.length} firm(s) under RTA governance`);

  await withSystem(async (tx) => {
    const navIndex: NavIndex = await loadNavIndex(tx);
    console.log(`[backfill] NAV master: ${navIndex.size} schemes, ${navIndex.byName.size} distinct names`);
    if (navIndex.size === 0) {
      console.error("[backfill] NAV master is empty — refusing to run.");
      process.exitCode = 1;
      return;
    }

    const folios = (
      await tx.execute(sql`
        SELECT f.id, f.tenant_id, f.schemes
          FROM folios f
         WHERE f.schemes IS NOT NULL
           AND jsonb_array_length(f.schemes) > 0
           ${TENANT ? sql`AND f.tenant_id = ${TENANT}::uuid` : sql``}
           ${skipIds.length ? sql`AND f.tenant_id::text NOT IN (${sql.join(skipIds.map((t) => sql`${t}`), sql`, `)})` : sql``}
         ORDER BY f.id
      `)
    ).rows as Array<{ id: string; tenant_id: string; schemes: Leg[] }>;

    console.log(`[backfill] ${folios.length} folio(s) to inspect`);

    let legsTotal = 0;
    let alreadyOk = 0;
    let resolved = 0;
    let collided = 0;
    let unresolved = 0;
    let resolvedValue = 0;
    let unresolvedValue = 0;
    const unresolvedByCode = new Map<string, { name: string; legs: number; value: number }>();
    const collisions: Array<{ folio: string; from: string; to: string; name: string }> = [];
    const updates: Array<{ id: string; schemes: Leg[] }> = [];

    for (const f of folios) {
      const legs = Array.isArray(f.schemes) ? f.schemes : [];
      // Codes already on this folio — the target must not be one of them.
      const present = new Set(legs.map((l) => (l.schemeCode ? String(l.schemeCode) : "")).filter(Boolean));
      let folioChanged = false;

      const next = legs.map((leg) => {
        legsTotal++;
        const code = leg.schemeCode ? String(leg.schemeCode) : "";
        const value = Number(leg.value ?? 0);

        if (code && navIndex.byCode.has(code)) {
          alreadyOk++;
          return leg;
        }

        const hit = navIndex.byName.get(normSchemeName(leg.schemeName));
        if (!hit) {
          unresolved++;
          unresolvedValue += value;
          const key = code || "(no code)";
          const prev = unresolvedByCode.get(key) ?? { name: String(leg.schemeName ?? ""), legs: 0, value: 0 };
          prev.legs++;
          prev.value += value;
          unresolvedByCode.set(key, prev);
          return leg;
        }

        if (present.has(hit.code)) {
          // Same holding already stored under the AMFI code. Rewriting would
          // create two identical legs and double the folio. Leave it.
          collided++;
          if (collisions.length < 40) {
            collisions.push({ folio: f.id, from: code, to: hit.code, name: String(leg.schemeName ?? "") });
          }
          return leg;
        }

        resolved++;
        resolvedValue += value;
        present.add(hit.code);
        folioChanged = true;
        return { ...leg, schemeCode: hit.code };
      });

      if (folioChanged) updates.push({ id: f.id, schemes: next });
    }

    console.log("");
    console.log("=== what the legs look like ===");
    console.log(`  legs inspected        ${legsTotal}`);
    console.log(`  already AMFI-coded    ${alreadyOk}`);
    console.log(`  RESOLVED by name      ${resolved}   (${lakh(resolvedValue)})`);
    console.log(`  collision, left alone ${collided}`);
    console.log(`  still unresolved      ${unresolved}   (${lakh(unresolvedValue)})`);
    console.log(`  folios to update      ${updates.length}`);

    if (collisions.length) {
      console.log("");
      console.log("=== duplicate holdings (stored under BOTH codes — review by hand) ===");
      for (const c of collisions) console.log(`  folio ${c.folio}  ${c.from} -> ${c.to}  ${c.name.slice(0, 50)}`);
      if (collided > collisions.length) console.log(`  … and ${collided - collisions.length} more`);
    }

    if (unresolvedByCode.size) {
      console.log("");
      console.log("=== top codes still unresolved ===");
      const top = [...unresolvedByCode.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 20);
      for (const [code, v] of top) console.log(`  ${code.padEnd(12)} ${lakh(v.value).padStart(20)}  ${v.legs} legs  ${v.name.slice(0, 45)}`);
    }

    if (!APPLY) {
      console.log("");
      console.log("[backfill] DRY RUN — nothing written. Re-run with --apply to write.");
      return;
    }

    console.log("");
    console.log(`[backfill] writing ${updates.length} folio(s) …`);
    let written = 0;
    for (let i = 0; i < updates.length; i += 200) {
      const chunk = updates.slice(i, i + 200);
      const values = chunk.map((u) => sql`(${u.id}::uuid, ${JSON.stringify(u.schemes)}::jsonb)`);
      const res = await tx.execute(sql`
        UPDATE folios f SET schemes = v.schemes, updated_at = now()
          FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, schemes)
         WHERE f.id = v.id
        RETURNING f.id
      `);
      written += res.rows.length;
      console.log(`[backfill]   ${written}/${updates.length}`);
    }
    console.log(`[backfill] done — ${written} folio(s) rewritten.`);
    console.log("[backfill] AUM is unchanged right now; the next nightly revaluation will reprice these.");
  });
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("[backfill] fatal:", err?.message ?? err);
    process.exit(1);
  });
