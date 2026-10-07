/**
 * Which reconciliation breaks "Sync to CRM" can fix, in one place for the bulk
 * route and the page's "Sync all to CRM (N)" count: open or investigating,
 * with a client, and the feed holding more units than the CRM beyond the
 * tolerance (an additive break — the sync posts the missing units). Narrowed
 * by the page's own status / severity / type filter. Over alias `e`
 * (reconciliation_exceptions).
 */

import { sql, type SQL } from "drizzle-orm";

/** Unit difference below which a break is rounding, not missing units. */
export const RECON_TOLERANCE = 0.5;

export type ReconFilter = { status?: string[]; severity?: string[]; type?: string[] };

export function syncableWhere(tenantId: string, filter: ReconFilter): SQL {
  const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
  const status = (filter.status?.length ? filter.status : ["open", "investigating"]).filter((x) => x === "open" || x === "investigating");
  const conds: SQL[] = [
    sql`e.tenant_id = ${tenantId}::uuid`,
    status.length ? sql`e.status IN (${list(status)})` : sql`FALSE`,
    sql`e.investor_id IS NOT NULL`,
    sql`COALESCE(e.feed_units, 0) - COALESCE(e.crm_units, 0) > ${RECON_TOLERANCE}`,
    // A break the sync already refused waits for a person (checkSyncable).
    sql`POSITION(${SYNC_REFUSED} IN COALESCE(e.notes, '')) = 0`,
  ];
  if (filter.severity?.length) conds.push(sql`e.severity IN (${list(filter.severity)})`);
  if (filter.type?.length) conds.push(sql`e.exception_type IN (${list(filter.type)})`);
  return sql.join(conds, sql` AND `);
}

/** Marker a refused break carries in its notes, so "Sync all" skips it. */
export const SYNC_REFUSED = "[sync refused:";

/** Words that differ between the AMFI master's and the RTA's spelling of one scheme. */
const NAME_FILLER = new Set(["plan", "option", "opt", "fund", "scheme", "the", "of", "and", "an", "a"]);
const NAME_ALIAS: Record<string, string> = { reg: "regular", dir: "direct", gr: "growth", grth: "growth", g: "growth" };

/** One scheme, however the AMFI master or the RTA spelled it. */
export function schemeNameKey(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !NAME_FILLER.has(w))
    .map((w) => NAME_ALIAS[w] ?? w)
    .sort()
    .join(" ");
}

type SyncBreak = {
  investorId: string | null;
  folioNumber: string | null;
  schemeCode: string | null;
  schemeName: string | null;
};

/**
 * Whether posting this break's missing units would be TRUE, not a duplicate.
 *
 * The engine compares the CRM's transactions with the RTA's folios by
 * (client, scheme code) with no folio, so a break is "missing in CRM" whenever
 * the two sides spell the scheme differently — the AMFI code on a transaction
 * (105989), the RTA's own on the folio (D157). Posting the feed's units then
 * doubles a holding the CRM already has. So the sync posts only when:
 *   - exactly one of the client's folios holds the feed's scheme code (the
 *     transaction needs a folio, and two candidates is a guess); and
 *   - the CRM holds no processed transaction in the same scheme under a
 *     different code.
 * Anything else is for a person to look at, and the reason says why.
 */
export async function checkSyncable(
  tx: any,
  tenantId: string,
  ex: SyncBreak,
): Promise<{ ok: true; folioNumber: string } | { ok: false; reason: string }> {
  if (!ex.investorId) return { ok: false, reason: "no client linked" };
  if (!ex.schemeCode) return { ok: false, reason: "the feed gives no scheme code" };

  let folioNumber = ex.folioNumber?.trim() || null;
  if (!folioNumber) {
    const folioRows = (await tx.execute(sql`
      SELECT DISTINCT f.folio_number
        FROM folios f
       WHERE f.tenant_id = ${tenantId}::uuid
         AND f.investor_id = ${ex.investorId}::uuid
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(f.schemes, '[]'::jsonb)) s
                      WHERE s->>'schemeCode' = ${ex.schemeCode})
    `)).rows as Array<{ folio_number: string }>;
    if (folioRows.length === 0) return { ok: false, reason: "no folio of this client holds the scheme" };
    if (folioRows.length > 1) return { ok: false, reason: `the scheme sits in ${folioRows.length} folios — pick one by hand` };
    folioNumber = folioRows[0].folio_number;
  }

  const key = schemeNameKey(ex.schemeName);
  if (key) {
    const others = (await tx.execute(sql`
      SELECT DISTINCT t.scheme_code, t.scheme_name
        FROM transactions t
       WHERE t.tenant_id = ${tenantId}::uuid
         AND t.investor_id = ${ex.investorId}::uuid
         AND t.status IN ('processed', 'successful')
         AND t.scheme_code IS DISTINCT FROM ${ex.schemeCode}
         AND t.scheme_name IS NOT NULL
    `)).rows as Array<{ scheme_code: string | null; scheme_name: string }>;
    const twin = others.find((o) => schemeNameKey(o.scheme_name) === key);
    if (twin) {
      return { ok: false, reason: `the CRM already records this scheme under code ${twin.scheme_code ?? "(none)"}` };
    }
  }
  return { ok: true, folioNumber };
}
