/**
 * Why does a firm's headline AUM / client count / folio count not match the
 * registrar's own totals? Read-only, one tenant at a time.
 *
 *   npx tsx scripts/diag-tenant-duplication.ts --tenant "Ahpal" \
 *     --expect-aum 7645606209 --expect-clients 2656 --expect-folios 10796
 *
 * (Ahpal's own figures, stated 2026-10-08: 2,656 clients, 10,796 folios,
 * Rs 764.56 Cr.)
 *
 * The three numbers a dashboard shows come from three different places, and
 * each inflates for its own reason:
 *
 *   clients  - investors rows. Inflates when the SAME person landed twice: a
 *              PAN-less RTA row, a second spelling of the name, or a row whose
 *              dedup_pan flag is off so the PAN upsert skipped it.
 *   folios   - folios rows, unique per (amc_code, folio_number). Inflates when
 *              one real folio arrives under two spellings of the AMC code, so
 *              the unique index doesn't see them as the same folio.
 *   AUM      - investors.aum, which is folio value plus a transaction fallback.
 *              Inflates for BOTH reasons above (each duplicate row carries its
 *              own value) and for a third: a scheme leg repeated inside one
 *              folio's `schemes` array.
 *
 * Nothing here writes. Requires DATABASE_URL and ALLOW_SYSTEM_TX=1.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const TENANT_Q = arg("tenant");
const EXP_AUM = arg("expect-aum") ? Number(arg("expect-aum")) : null;
const EXP_CLIENTS = arg("expect-clients") ? Number(arg("expect-clients")) : null;
const EXP_FOLIOS = arg("expect-folios") ? Number(arg("expect-folios")) : null;

const n = (v: unknown) => Number(v ?? 0);
const cr = (v: unknown) => `${(n(v) / 1e7).toFixed(2)} Cr`;
const pad = (s: string | number, w: number) => String(s).padStart(w);
const padr = (s: string | number, w: number) => String(s).padEnd(w);
const rule = (w = 72) => console.log("  " + "-".repeat(w));
const head = (t: string) => console.log(`\n${t}\n${"=".repeat(t.length)}`);

/** "9,102   expected 8,641   +461 (+5.3%)" */
function delta(label: string, actual: number, expected: number | null, fmt: (v: unknown) => string = String) {
  if (expected == null) {
    console.log(`  ${padr(label, 26)} ${fmt(actual)}`);
    return;
  }
  const d = actual - expected;
  const pct = expected === 0 ? "" : ` (${d >= 0 ? "+" : ""}${((d / expected) * 100).toFixed(1)}%)`;
  const verdict = d === 0 ? "matches" : `${d > 0 ? "+" : ""}${fmt(d)}${pct}`;
  console.log(`  ${padr(label, 26)} ${padr(fmt(actual), 16)} expected ${padr(fmt(expected), 16)} ${verdict}`);
}

async function main() {
  if (!TENANT_Q) {
    console.error("Usage: npx tsx scripts/diag-tenant-duplication.ts --tenant <uuid|name> [--expect-aum N --expect-clients N --expect-folios N]");
    process.exit(1);
  }

  const tenants = await withSystem(async (tx) => {
    const isUuid = /^[0-9a-f-]{36}$/i.test(TENANT_Q);
    const r = await tx.execute(
      isUuid
        ? sql`SELECT id, COALESCE(display_name, legal_name) AS name, arn FROM tenants WHERE id = ${TENANT_Q}::uuid`
        : sql`SELECT id, COALESCE(display_name, legal_name) AS name, arn FROM tenants
                WHERE display_name ILIKE ${"%" + TENANT_Q + "%"} OR legal_name ILIKE ${"%" + TENANT_Q + "%"}
                ORDER BY created_at LIMIT 10`
    );
    return r.rows as Array<{ id: string; name: string; arn: string | null }>;
  });
  if (!tenants.length) {
    console.error(`No tenant matched "${TENANT_Q}".`);
    process.exit(1);
  }
  if (tenants.length > 1) {
    console.error(`"${TENANT_Q}" matched ${tenants.length} tenants - re-run with the exact id:`);
    for (const t of tenants) {
      const size = await withSystem(async (tx) =>
        (
          await tx.execute(sql`
            SELECT (SELECT COUNT(*) FROM investors WHERE tenant_id = ${t.id}::uuid AND deleted_at IS NULL)::int AS clients,
                   (SELECT COUNT(*) FROM folios    WHERE tenant_id = ${t.id}::uuid)::int                        AS folios
          `)
        ).rows[0] as Record<string, unknown>
      );
      console.error(`   ${t.id}  ${padr(t.name ?? "(unnamed)", 34)} ARN ${padr(t.arn ?? "-", 14)} ${pad(n(size.clients), 7)} clients  ${pad(n(size.folios), 7)} folios`);
    }
    process.exit(1);
  }
  const tenant = tenants[0];
  console.log(`\n${tenant.name}   [${tenant.id}]   ARN ${tenant.arn ?? "(none)"}`);

  await withTenant(
    tenant.id,
    async (tx) => {
      // 1. Headline vs the registrar's own totals.
      //
      // "Alive" is the exact predicate the dashboard uses (firm-pulse.ts): not
      // deleted, not merged away, not closed. The clients LIST is looser - it
      // does not exclude 'closed' - so the two legitimately differ.
      const h = (
        await tx.execute(sql`
          SELECT
            COUNT(*)::int                                                   AS rows_total,
            COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int             AS deleted,
            COUNT(*) FILTER (WHERE merged_into_id IS NOT NULL)::int         AS merged,
            COUNT(*) FILTER (WHERE status = 'closed' AND deleted_at IS NULL AND merged_into_id IS NULL)::int AS closed,
            COUNT(*) FILTER (WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed')::int AS alive,
            COALESCE(SUM(aum::numeric) FILTER (WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed'), 0) AS aum_alive,
            -- A firm's own "clients" figure usually counts people holding
            -- money, not every record its client list ever loaded.
            COUNT(*) FILTER (WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed' AND COALESCE(aum::numeric, 0) > 0)::int AS alive_with_aum,
            COUNT(*) FILTER (WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed'
                               AND EXISTS (SELECT 1 FROM folios fo WHERE fo.investor_id = investors.id))::int AS alive_with_folio,
            COALESCE(SUM(aum::numeric) FILTER (WHERE merged_into_id IS NOT NULL AND deleted_at IS NULL), 0) AS aum_merged_stale
          FROM investors
        `)
      ).rows[0] as Record<string, unknown>;

      const f = (
        await tx.execute(sql`
          SELECT COUNT(*)::int AS folios,
                 COUNT(*) FILTER (WHERE fo.aum::numeric > 0)::int AS valued,
                 COALESCE(SUM(fo.aum::numeric), 0) AS aum
            FROM folios fo JOIN investors i ON i.id = fo.investor_id
           WHERE i.deleted_at IS NULL AND i.merged_into_id IS NULL
        `)
      ).rows[0] as Record<string, unknown>;

      head("1. What the CRM shows vs what the registrar says");
      delta("Clients (alive)", n(h.alive), EXP_CLIENTS);
      delta("  holding AUM > 0", n(h.alive_with_aum), EXP_CLIENTS);
      delta("  holding a folio", n(h.alive_with_folio), EXP_CLIENTS);
      delta("Folios", n(f.folios), EXP_FOLIOS);
      delta("AUM (investors.aum)", n(h.aum_alive), EXP_AUM, cr);
      console.log(`\n  Folio register sums to ${cr(f.aum)} across ${f.valued} valued of ${f.folios} folios.`);
      const gap = n(h.aum_alive) - n(f.aum);
      if (Math.abs(gap) > 1) {
        console.log(`  Headline is ${gap > 0 ? "ABOVE" : "below"} the folio register by ${cr(Math.abs(gap))} - that`);
        console.log("  difference is the transaction fallback (schemes no folio covers).");
      }

      head("2. Client row census - where the extra rows are");
      console.log(`  ${padr("rows in investors", 26)}${pad(n(h.rows_total), 8)}`);
      console.log(`  ${padr("  soft-deleted", 26)}${pad(n(h.deleted), 8)}   excluded everywhere`);
      console.log(`  ${padr("  merged away", 26)}${pad(n(h.merged), 8)}   excluded from dashboards`);
      console.log(`  ${padr("  closed", 26)}${pad(n(h.closed), 8)}   excluded from dashboards, SHOWN in the clients list`);
      console.log(`  ${padr("  alive", 26)}${pad(n(h.alive), 8)}`);
      if (n(h.aum_merged_stale) > 0) {
        console.log(`\n  ! ${cr(h.aum_merged_stale)} of stale AUM still sits on merged-away rows.`);
        console.log("    Dashboards filter them out; any surface that only checks deleted_at counts it twice.");
      }

      // 3. Duplicate clients, by the four keys the Find Duplicates page uses.
      //
      // "extra rows" is what the count would drop by if every group collapsed to
      // one survivor; "AUM on extras" is the AUM those extra rows carry, i.e. the
      // headline overstatement attributable to that key.
      head("3. Duplicate clients (alive rows only)");
      const dupKeys: Array<[string, string, string]> = [
        ["PAN", "upper(trim(pan))", "pan IS NOT NULL AND trim(pan) <> ''"],
        ["Phone", "regexp_replace(phone, '\\D', '', 'g')", "phone IS NOT NULL AND length(regexp_replace(phone, '\\D', '', 'g')) >= 10"],
        ["Email", "lower(trim(email))", "email IS NOT NULL AND trim(email) <> ''"],
        ["Name", "lower(trim(name))", "name IS NOT NULL AND trim(name) <> ''"],
        ["Name + DOB", "lower(trim(name)) || '|' || COALESCE(dob::text, '')", "name IS NOT NULL AND trim(name) <> '' AND dob IS NOT NULL"],
      ];
      console.log("  " + padr("key", 12) + pad("groups", 8) + pad("rows", 8) + pad("extra rows", 12) + pad("AUM on extras", 18));
      rule();
      for (const [label, expr, where] of dupKeys) {
        const r = (
          await tx.execute(sql`
            WITH base AS (
              SELECT ${sql.raw(expr)} AS gkey, aum::numeric AS aum,
                     row_number() OVER (PARTITION BY ${sql.raw(expr)} ORDER BY aum::numeric DESC NULLS LAST, created_at ASC) AS rn,
                     count(*)  OVER (PARTITION BY ${sql.raw(expr)}) AS grp
                FROM investors
               WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed' AND ${sql.raw(where)}
            )
            SELECT COUNT(DISTINCT gkey) FILTER (WHERE grp > 1)::int AS groups,
                   COUNT(*) FILTER (WHERE grp > 1)::int             AS rows,
                   COUNT(*) FILTER (WHERE grp > 1 AND rn > 1)::int  AS extra_rows,
                   COALESCE(SUM(aum) FILTER (WHERE grp > 1 AND rn > 1), 0) AS aum_on_extras
              FROM base
          `)
        ).rows[0] as Record<string, unknown>;
        console.log("  " + padr(label, 12) + pad(n(r.groups), 8) + pad(n(r.rows), 8) + pad(n(r.extra_rows), 12) + pad(cr(r.aum_on_extras), 18));
      }
      console.log("\n  These overlap - one duplicate pair usually matches on several keys, so");
      console.log("  do NOT add the columns up. PAN is the only one that is proof on its own.");

      // The PAN upsert only dedupes rows with dedup_pan = true. A row with the
      // flag off will be re-created by every subsequent import.
      const bypass = (
        await tx.execute(sql`
          SELECT COUNT(*)::int AS rows,
                 COUNT(*) FILTER (WHERE pan IS NULL OR trim(pan) = '')::int AS no_pan
            FROM investors
           WHERE deleted_at IS NULL AND merged_into_id IS NULL AND dedup_pan = false
        `)
      ).rows[0] as Record<string, unknown>;
      const noPan = (
        await tx.execute(sql`
          SELECT COUNT(*)::int AS rows, COALESCE(SUM(aum::numeric), 0) AS aum
            FROM investors
           WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed'
             AND (pan IS NULL OR trim(pan) = '')
        `)
      ).rows[0] as Record<string, unknown>;
      console.log(`\n  PAN-less clients:   ${pad(n(noPan.rows), 6)}  holding ${cr(noPan.aum)}`);
      console.log("    Deduped on rta_nopan_key, not PAN - a second spelling of the name makes a second client.");
      console.log(`  dedup_pan = false:  ${pad(n(bypass.rows), 6)}  (${n(bypass.no_pan)} of them also PAN-less)`);
      console.log("    These rows are SKIPPED by the import's PAN upsert, so each import can re-add them.");

      // 4. Folio duplication.
      //
      // The unique index is (tenant, amc_code, folio_number). Anything that makes
      // the same real folio carry two different amc_codes defeats it.
      head("4. Duplicate folios");
      const folioDup = (
        await tx.execute(sql`
          WITH live AS (
            SELECT fo.folio_number, fo.amc_code, fo.investor_id
              FROM folios fo JOIN investors i ON i.id = fo.investor_id
             WHERE i.deleted_at IS NULL AND i.merged_into_id IS NULL
          )
          SELECT
            (SELECT COUNT(*)::int FROM (SELECT folio_number FROM live GROUP BY 1 HAVING COUNT(DISTINCT amc_code) > 1) x)   AS num_multi_amc,
            (SELECT COUNT(*)::int FROM (SELECT folio_number FROM live GROUP BY 1 HAVING COUNT(DISTINCT investor_id) > 1) x) AS num_multi_investor,
            (SELECT COUNT(*)::int FROM live) - (SELECT COUNT(DISTINCT folio_number)::int FROM live)                          AS extra_rows
        `)
      ).rows[0] as Record<string, unknown>;
      console.log(`  folio rows                                   ${pad(n(f.folios), 8)}`);
      console.log(`  distinct folio numbers                       ${pad(n(f.folios) - n(folioDup.extra_rows), 8)}`);
      console.log(`  folio numbers under >1 AMC code              ${pad(n(folioDup.num_multi_amc), 8)}   <- inflates BOTH folio count and AUM`);
      console.log(`  folio numbers under >1 client                ${pad(n(folioDup.num_multi_investor), 8)}   <- the duplicate-client fingerprint`);

      if (n(folioDup.num_multi_amc) > 0) {
        const sample = (
          await tx.execute(sql`
            WITH live AS (
              SELECT fo.folio_number, fo.amc_code, fo.amc_name, fo.aum::numeric AS aum
                FROM folios fo JOIN investors i ON i.id = fo.investor_id
               WHERE i.deleted_at IS NULL AND i.merged_into_id IS NULL
            ), d AS (SELECT folio_number FROM live GROUP BY 1 HAVING COUNT(DISTINCT amc_code) > 1)
            SELECT l.folio_number, string_agg(DISTINCT l.amc_code || ' (' || l.amc_name || ')', ' | ') AS codes,
                   SUM(l.aum) AS aum
              FROM live l JOIN d ON d.folio_number = l.folio_number
             GROUP BY l.folio_number ORDER BY SUM(l.aum) DESC LIMIT 10
          `)
        ).rows as Array<Record<string, unknown>>;
        console.log("\n  Worst offenders - same folio number, two AMC codes:");
        for (const s of sample) console.log("    " + padr(String(s.folio_number), 22) + padr(cr(s.aum), 14) + String(s.codes));
      }

      // 5. Scheme legs inside a folio.
      //
      // A folio's holding in one scheme may legitimately split across the firm's
      // own ARNs (one leg per ARN). The same (scheme, ARN) twice is not a split -
      // it is the same holding counted twice.
      head("5. Repeated scheme legs inside a folio");
      const legs = (
        await tx.execute(sql`
          WITH legs AS (
            SELECT fo.id AS folio_id,
                   s->>'schemeCode' AS scheme_code, COALESCE(s->>'arn', '') AS arn,
                   COALESCE((s->>'value')::numeric, 0) AS value
              FROM folios fo
              JOIN investors i ON i.id = fo.investor_id
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(fo.schemes, '[]'::jsonb)) s
             WHERE i.deleted_at IS NULL AND i.merged_into_id IS NULL
          ), dup AS (
            SELECT folio_id, scheme_code, arn, COUNT(*) AS c, SUM(value) AS v
              FROM legs GROUP BY 1,2,3 HAVING COUNT(*) > 1
          )
          SELECT (SELECT COUNT(*)::int FROM legs)                    AS total_legs,
                 (SELECT COUNT(*)::int FROM dup)                     AS dup_groups,
                 (SELECT COALESCE(SUM(c - 1), 0)::int FROM dup)      AS extra_legs,
                 (SELECT COALESCE(SUM(v * (c - 1) / c), 0) FROM dup) AS aum_on_extras,
                 (SELECT COALESCE(SUM(value), 0) FROM legs)          AS legs_value
        `)
      ).rows[0] as Record<string, unknown>;
      console.log(`  scheme legs                      ${pad(n(legs.total_legs), 8)}`);
      console.log(`  repeated (scheme, ARN) pairs     ${pad(n(legs.dup_groups), 8)}`);
      console.log(`  extra legs                       ${pad(n(legs.extra_legs), 8)}   carrying ~${cr(legs.aum_on_extras)}`);
      console.log(`  scheme-leg value sum             ${pad(cr(legs.legs_value), 14)}  vs folio register ${cr(f.aum)}`);

      // Per-ARN split - if the firm holds several ARNs, a holding reported under
      // two of them doubles unless the registrar really did split it.
      const byArn = (
        await tx.execute(sql`
          SELECT COALESCE(NULLIF(s->>'arn', ''), '(no ARN)') AS arn,
                 COUNT(*)::int AS legs, COALESCE(SUM((s->>'value')::numeric), 0) AS value
            FROM folios fo
            JOIN investors i ON i.id = fo.investor_id
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(fo.schemes, '[]'::jsonb)) s
           WHERE i.deleted_at IS NULL AND i.merged_into_id IS NULL
           GROUP BY 1 ORDER BY value DESC
        `)
      ).rows as Array<Record<string, unknown>>;
      console.log("\n  Value by ARN:");
      for (const a of byArn) console.log("    " + padr(String(a.arn), 16) + pad(n(a.legs), 8) + pad(cr(a.value), 16));

      // 6. Bottom line.
      head("6. Bottom line");
      const panDup = (
        await tx.execute(sql`
          WITH base AS (
            SELECT aum::numeric AS aum,
                   row_number() OVER (PARTITION BY upper(trim(pan)) ORDER BY aum::numeric DESC NULLS LAST, created_at ASC) AS rn
              FROM investors
             WHERE deleted_at IS NULL AND merged_into_id IS NULL AND status <> 'closed' AND pan IS NOT NULL AND trim(pan) <> ''
          )
          SELECT COUNT(*) FILTER (WHERE rn > 1)::int AS extra, COALESCE(SUM(aum) FILTER (WHERE rn > 1), 0) AS aum FROM base
        `)
      ).rows[0] as Record<string, unknown>;
      console.log("  Collapsing every exact-PAN duplicate would give:");
      delta("  clients", n(h.alive) - n(panDup.extra), EXP_CLIENTS);
      delta("  AUM", n(h.aum_alive) - n(panDup.aum), EXP_AUM, cr);
      console.log("\n  If that still overshoots, the remainder is PAN-less duplicates (section 3)");
      console.log("  and split folios (section 4) - neither is visible to a PAN-only merge.");
      console.log("");
    },
    { userId: "00000000-0000-0000-0000-000000000000", roles: ["owner"] }
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nfailed:", e?.message ?? e);
    process.exit(1);
  });
