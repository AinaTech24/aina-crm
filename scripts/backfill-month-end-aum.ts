/**
 * Backfill one month's row in aum_month_end (migration 0240): the firm's AUM
 * at that month's last NAV, for a month that ended before the nightly
 * recorder existed.
 *
 * Each holding is valued today (the same valuation the dashboard stores), then
 * repriced to the month end by its own scheme's NAV ratio — AMFI's published
 * NAV for the month's last NAV day over the NAV in use now — and the money that
 * moved after the month end (purchases in, redemptions out, from the ledger) is
 * taken back out. Holdings with no month-end NAV keep today's value.
 *
 * Ahpal, 30 Sep 2026: ~Rs 725.9 Cr against the firm's Rs 726 Cr, while the live
 * book read Rs 727.8 Cr at 7 Oct NAV.
 *
 *   tsx scripts/backfill-month-end-aum.ts --tenant <uuid> --month 2026-09            # dry run
 *   tsx scripts/backfill-month-end-aum.ts --tenant <uuid> --month 2026-09 --apply
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { withTenant } from "../src/db/client";
import { computeInvestorValuation, loadValuationRows } from "../src/lib/finance/valuation";
import { loadNavIndex, lookupNav } from "../src/lib/finance/scheme-match";

const args = process.argv.slice(2);
const T = args[args.indexOf("--tenant") + 1];
const MONTH = args[args.indexOf("--month") + 1];
const APPLY = args.includes("--apply");
const cr = (n: number) => `Rs ${(n / 1e7).toFixed(2)} Cr`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** AMFI's NAV history for one day: scheme code → NAV. Empty on a holiday. */
async function amfiNavs(day: Date): Promise<Map<string, number>> {
  const d = `${String(day.getUTCDate()).padStart(2, "0")}-${MON[day.getUTCMonth()]}-${day.getUTCFullYear()}`;
  const res = await fetch(`https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=${d}&todt=${d}`);
  if (!res.ok) throw new Error(`AMFI NAV history ${d}: HTTP ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/);
  const header = lines.find((l) => /scheme code/i.test(l) && /net asset value/i.test(l));
  const out = new Map<string, number>();
  if (!header) return out;
  const cols = header.split(";").map((c) => c.trim().toLowerCase());
  const iCode = cols.indexOf("scheme code"), iNav = cols.findIndex((c) => c.startsWith("net asset value"));
  for (const l of lines) {
    const v = l.split(";");
    if (v.length < cols.length || !/^\d+$/.test((v[iCode] ?? "").trim())) continue;
    const nav = Number(v[iNav]);
    if (nav > 0) out.set(v[iCode].trim(), nav);
  }
  return out;
}

async function main() {
  if (!T || T.startsWith("--") || !/^\d{4}-\d{2}$/.test(MONTH ?? "")) throw new Error("Pass --tenant <uuid> --month YYYY-MM [--apply]");
  const [y, m] = MONTH.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0));
  // The month's last NAV day: step back from the month end over weekends and holidays.
  let navDay = new Date(monthEnd), navs = new Map<string, number>();
  for (let i = 0; i < 7 && !navs.size; i++) {
    navs = await amfiNavs(navDay);
    if (!navs.size) navDay = new Date(navDay.getTime() - 864e5);
  }
  if (!navs.size) throw new Error(`no AMFI NAVs in the week before ${monthEnd.toISOString().slice(0, 10)}`);
  const navDate = navDay.toISOString().slice(0, 10), monthEndIso = monthEnd.toISOString().slice(0, 10);
  console.log(`${APPLY ? "APPLY" : "DRY RUN (add --apply)"} · month end ${monthEndIso} · AMFI NAVs of ${navDate}: ${navs.size} schemes`);

  const { ids, index } = await withTenant(T, async (tx) => ({
    ids: ((await tx.execute(sql`SELECT id FROM investors WHERE tenant_id = ${T}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL
            AND COALESCE(status, '') NOT IN ('closed', 'exited') AND COALESCE(aum, 0) > 0 ORDER BY id`)).rows as any[]).map((r) => String(r.id)),
    index: await loadNavIndex(tx),
  }));
  let today = 0, atMonthEnd = 0, repriced = 0, kept = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    await withTenant(T, async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
      const { transactions, snapshots } = await loadValuationRows(tx, part);
      const group = <X extends { investor_id?: string | null }>(rows: X[]) => {
        const g = new Map<string, X[]>();
        for (const r of rows) if (r.investor_id) g.set(r.investor_id, [...(g.get(r.investor_id) ?? []), r]);
        return g;
      };
      const txns = group(transactions as any[]), snaps = group(snapshots as any[]);
      for (const id of part) {
        const v = computeInvestorValuation((txns.get(id) ?? []) as any, (snaps.get(id) ?? []) as any);
        today += v.currentValue + v.unpricedInvested;
        atMonthEnd += v.unpricedInvested;
        for (const h of v.holdings) {
          const val = h.currentValue ?? 0;
          if (!val) continue;
          const hit = h.latestNav ? lookupNav(index, h.schemeCode, h.schemeName, h.latestNav) : null;
          const then = hit ? navs.get(hit.code) : undefined;
          if (then && h.latestNav) { atMonthEnd += val * (then / h.latestNav); repriced += val; }
          else { atMonthEnd += val; kept += val; }
        }
      }
    });
  }
  // Money that moved after the month end is in today's units; take it back out.
  const flows = await withTenant(T, async (tx) => (await tx.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN t.direction = 'inflow' THEN t.amount ELSE -t.amount END), 0)::numeric AS net
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${T}::uuid AND t.order_date > ${monthEndIso}::date AND t.type <> 'dividend_payout'
       AND i.deleted_at IS NULL AND i.merged_into_id IS NULL AND COALESCE(i.status, '') NOT IN ('closed', 'exited') AND COALESCE(i.aum, 0) > 0`)).rows[0] as any);
  const net = Number(flows?.net ?? 0);
  const result = atMonthEnd - net;
  console.log(`today ${cr(today)} · repriced ${cr(repriced)} by NAV, ${cr(kept)} kept at today's value`);
  console.log(`at ${navDate} NAV ${cr(atMonthEnd)} · less net flows after ${monthEndIso} ${cr(net)} · month-end AUM ${cr(result)}`);
  if (!APPLY) return;
  await withTenant(T, async (tx) => tx.execute(sql`
    INSERT INTO aum_month_end (tenant_id, month_end, aum, nav_date, source, updated_at)
    VALUES (${T}::uuid, ${monthEndIso}::date, round(${result}::numeric, 2), ${navDate}::date, 'backfill', now())
    ON CONFLICT (tenant_id, month_end) DO UPDATE SET aum = EXCLUDED.aum, nav_date = EXCLUDED.nav_date, source = 'backfill', updated_at = now()`));
  console.log("written");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.cause?.message ?? e?.message ?? e); process.exit(1); });
