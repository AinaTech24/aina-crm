/**
 * Business widgets: the KPI row, Team, Branches, Money movement, Top clients.
 * Every figure comes from lib/metrics over ctx.scope (viewer access ∩ filters).
 *
 * The KPI row is the dashboard's headline — seven numbers an owner reads
 * first: the two balances (AUM, SIP book), the money that moved (net
 * business, net SIP added), clients (new against target, live) and the other
 * line of business (insurance premium).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  getAUM, getSipBook, getNetBusiness, getNewClients, getInsurancePremium, getStockMonthAgo, getTarget,
  getBookByRm, getBookByBranch, getSipBookByRm, getNetBusinessByRm, getNetBusinessByBranch,
  getNewClientsByRm, getNewClientsByBranch, getOverdueTasksByAssignee, getTargetsByUser, getTargetsByBranch,
  getMonthlyFlows, getLedgerCoverage, clientWhere, sipMonthlySql, targetPct, getActiveClients,
  type MetricScope, inOrder,
} from "@/lib/metrics";
import { formatCount, formatDate, formatMoney, pickMoneyScale, type MoneyScale } from "@/lib/format";
import type { WidgetCtx, WidgetImpl } from "../types";
import { clientsHref, newClientsHref, qs, sipsHref, tasksHref, transactionsHref } from "../links";
import { MoneyMovementChart, type MoneyPoint } from "../MoneyMovementChart";

/* ─────────────────────────────── pieces ─────────────────────────────── */

/** "↗ 4.3%" — green only when up; a fall is not an alarm (D6: colour is a signal). */
function Change({ cur, prev, inverse = false }: { cur: number; prev: number | null | undefined; inverse?: boolean }) {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return null;
  const up = pct > 0.05;
  const down = pct < -0.05;
  const good = inverse ? down : up;
  return (
    <span className={`tabular-nums font-medium ${good ? "text-emerald-700" : "text-muted-foreground"}`}>
      {up ? "↗" : down ? "↘" : "→"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function KpiTile({
  label, value, href, info, compare, footer, empty, when,
}: {
  label: string;
  value: string;
  href?: string;
  info?: string;
  /** What the figure covers: "Today" for a balance, the period for money that moved. */
  when?: string;
  compare?: { node: ReactNode; label: string } | null;
  footer?: ReactNode;
  /** No data at all: "—" and what to do about it (or only why, when nothing can be done here). */
  empty?: { hint: string; href?: string; cta?: string } | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 min-w-0 flex flex-col">
      <div className="text-xs font-medium text-muted-foreground flex items-center gap-1" title={info}>
        {label}
        {info && <Info className="size-3.5 cursor-help" aria-label={info} />}
        {when && <span className="ml-auto whitespace-nowrap pl-2 font-normal">{when}</span>}
      </div>
      {empty ? (
        <>
          <div className="mt-1 text-2xl font-semibold text-muted-foreground" title={empty.hint}>—</div>
          {empty.href && empty.cta
            ? <Link href={empty.href} className="mt-1 text-xs font-medium text-primary hover:underline">{empty.cta}</Link>
            : <div className="mt-1 text-xs text-muted-foreground">{empty.hint}</div>}
        </>
      ) : (
        <>
          {href ? (
            <Link href={href} className="mt-1 text-xl xl:text-2xl font-semibold tabular-nums text-foreground hover:underline break-words">
              {value}
            </Link>
          ) : (
            <div className="mt-1 text-xl xl:text-2xl font-semibold tabular-nums text-foreground break-words">{value}</div>
          )}
          {compare && (
            <div className="mt-1 text-xs text-muted-foreground">
              {compare.node} <span>{compare.label}</span>
            </div>
          )}
          {footer && <div className="mt-0.5 text-xs text-muted-foreground">{footer}</div>}
        </>
      )}
    </div>
  );
}

const money = (v: number | null | undefined, scale: MoneyScale = "auto") => formatMoney(v, { scale });

/** A comparison line, or null when there is nothing to compare with (a zero or missing base). */
function vs(cur: number, prev: number | null | undefined, label: string, inverse = false) {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  return { node: <Change cur={cur} prev={prev} inverse={inverse} />, label };
}

/** The period's own name for comparisons ("vs same period last year"). */
const YOY = "vs same period last year";

/* ─────────────────────────────── KPI row ─────────────────────────────── */

async function kpiRow(tx: Tx, ctx: WidgetCtx) {
  const s = ctx.scope;
  const p = ctx.period;
  const fy = { from: p.fyStart, to: p.to };
  const [aum, sip, then, biz, newCur, newPrev, newFy, target, ins, counts] = await inOrder(
    () => getAUM(tx, s),
    () => getSipBook(tx, s),
    () => getStockMonthAgo(tx, s),
    () => getNetBusiness(tx, s, p, p.prev),
    () => getNewClients(tx, s, p),
    () => getNewClients(tx, s, p.prev),
    () => getNewClients(tx, s, fy),
    () => getTarget(tx, s, p.fiscalYear, "new_clients"),
    () => getInsurancePremium(tx, s, p, p.prev),
    () => getActiveClients(tx, s),
  );
  const cur = biz.current;
  const prev = biz.previous;
  const bizInfo = cur
    ? `Gross investment ${money(cur.gross)} · Redemption ${money(cur.redemption)}`
    : undefined;
  const pct = targetPct(newFy, target);
  const isFy = p.key === "fy";
  // Balances are as they stand today; everything else moved in the period.
  const flow = p.key === "custom" ? "Custom range" : p.name;

  return {
    body: (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="AUM"
          when="Today"
          value={money(aum.aum)}
          href={clientsHref(ctx, { sort: "aum", dir: "desc" })}
          info="Assets under management of live clients, today. Moves with the market as well as with sales."
          compare={then ? vs(aum.aum, then.aum, `vs ${formatDate(then.date, "dayMonth")}`) : null}
        />
        <KpiTile
          label="SIP book"
          when="Today"
          value={`${money(sip.monthly)}/mo`}
          href={sipsHref(ctx)}
          info="Active SIPs of live clients, converted to a monthly amount. The same total as the SIP Book page."
          compare={then ? vs(sip.monthly, then.sip, `vs ${formatDate(then.date, "dayMonth")}`) : null}
        />
        <KpiTile
          label="Net business"
          when={flow}
          value={money(cur?.net ?? null)}
          href={transactionsHref(ctx)}
          info={bizInfo ?? "Gross investment minus redemption, from imported RTA transactions."}
          empty={biz.hasData ? null : { hint: "No transactions for this period", href: "/dashboard/rta-imports", cta: "Import RTA files" }}
          compare={cur && prev ? vs(cur.net, prev.net, YOY) : null}
        />
        <KpiTile
          label="Net SIP added"
          when={flow}
          value={cur ? `${money(cur.netSip)}/mo` : "—"}
          info={cur
            ? `New SIPs ${money(cur.newSip)} a month, minus SIPs stopped ${money(cur.stoppedSip)} a month, in the period.`
            : "New SIPs registered minus SIPs stopped, as a monthly amount."}
          empty={biz.hasData ? null : { hint: "No transactions for this period", href: "/dashboard/rta-imports", cta: "Import RTA files" }}
          compare={cur && prev ? vs(cur.netSip, prev.netSip, YOY) : null}
        />
        <KpiTile
          label="New clients"
          when={flow}
          value={isFy && target ? `${formatCount(newCur)} / ${formatCount(target)}` : formatCount(newCur)}
          href={newClientsHref(ctx)}
          info="Clients whose onboarding date falls in the period. Imported records without an onboarding date are not new clients."
          compare={vs(newCur, newPrev, YOY)}
          footer={
            target
              ? isFy
                ? `${Math.round((pct ?? 0) * 100)}% of the FY target`
                : `FY so far ${formatCount(newFy)} of ${formatCount(target)} target (${Math.round((pct ?? 0) * 100)}%)`
              : null
          }
        />
        <KpiTile
          label="Clients"
          when="Today"
          value={formatCount(counts.clients)}
          href={clientsHref(ctx)}
          info="Live clients: not closed and not merged into another record. Active are active or at redemption risk; funded have AUM above zero."
          footer={`${formatCount(counts.active)} active · ${formatCount(counts.funded)} funded`}
        />
        <KpiTile
          label="Insurance premium"
          when={flow}
          value={money(ins.premium)}
          href={`/dashboard/insurance${qs({ booked_from: p.from, booked_to: p.to, owner: s.rmIds, branch: s.branchIds })}`}
          info={`Annual premium of issued policies whose cover started in the period.${ins.premium > 0 ? ` New ${money(ins.newPremium)} · Renewal ${money(ins.renewalPremium)}.` : ""}`}
          empty={ins.hasData ? null : { hint: "No policies recorded", href: "/dashboard/insurance", cta: "Add a policy" }}
          compare={vs(ins.premium, ins.previous, YOY)}
        />
      </div>
    ),
  };
}

/* ───────────────────────────── team tables ───────────────────────────── */

type TeamRow = {
  key: string;
  name: string;
  href?: string;
  clients: number;
  aum: number;
  sip: number;
  net: number | null;
  newClients: number;
  overdue: number | null;
  target: number | null;
  targetPct: number | null;
};

function TeamTable({ rows, head, hasLedger }: { rows: TeamRow[]; head: string; hasLedger: boolean }) {
  // Each money column picks its own unit — one scale for the row put an SIP
  // book beside AUM as "₹0.02 Cr".
  const aumScale = pickMoneyScale(rows.map((r) => r.aum));
  const sipScale = pickMoneyScale(rows.map((r) => r.sip));
  const netScale = pickMoneyScale(rows.map((r) => r.net ?? 0));
  const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const pct = (r: TeamRow) =>
    r.targetPct != null ? `${Math.round(r.targetPct * 100)}%` : r.target == null ? "No target" : "—";
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left">{head}</th>
              <th className="px-3 py-2 text-right">Clients</th>
              <th className="px-3 py-2 text-right">AUM</th>
              <th className="px-3 py-2 text-right">SIP book</th>
              <th className="px-3 py-2 text-right" title="Gross investment minus redemption in the period">Net business</th>
              <th className="px-3 py-2 text-right">New clients</th>
              <th className="px-3 py-2 text-right">Overdue tasks</th>
              <th className="px-3 py-2 text-right" title="Net business this FY against the FY business target">Target %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 font-medium max-w-0 w-1/4">
                  {r.href ? <Link href={r.href} className="hover:underline truncate block">{r.name}</Link> : <span className="text-muted-foreground truncate block">{r.name}</span>}
                </td>
                <td className={td}>{formatCount(r.clients)}</td>
                <td className={td}>{formatMoney(r.aum, { scale: aumScale })}</td>
                <td className={td}>{formatMoney(r.sip, { scale: sipScale })}</td>
                <td className={td}>{hasLedger && r.net != null ? formatMoney(r.net, { scale: netScale }) : "—"}</td>
                <td className={td}>{formatCount(r.newClients)}</td>
                <td className={`${td} ${r.overdue ? "text-rose-700 font-medium" : ""}`}>{r.overdue == null ? "—" : formatCount(r.overdue)}</td>
                <td className={td}>{pct(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones: one card per row (D6). */}
      <ul className="md:hidden space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              {r.href ? <Link href={r.href} className="font-medium hover:underline truncate">{r.name}</Link> : <span className="font-medium text-muted-foreground">{r.name}</span>}
              <span className="text-xs text-muted-foreground whitespace-nowrap">{formatCount(r.clients)} clients</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-muted-foreground">AUM</dt><dd className="tabular-nums">{formatMoney(r.aum, { scale: aumScale })}</dd></div>
              <div><dt className="text-muted-foreground">SIP book</dt><dd className="tabular-nums">{formatMoney(r.sip, { scale: sipScale })}</dd></div>
              <div><dt className="text-muted-foreground">Net business</dt><dd className="tabular-nums">{hasLedger && r.net != null ? formatMoney(r.net, { scale: netScale }) : "—"}</dd></div>
              <div><dt className="text-muted-foreground">New clients</dt><dd className="tabular-nums">{formatCount(r.newClients)}</dd></div>
              <div><dt className="text-muted-foreground">Overdue tasks</dt><dd className={`tabular-nums ${r.overdue ? "text-rose-700" : ""}`}>{r.overdue == null ? "—" : formatCount(r.overdue)}</dd></div>
              <div><dt className="text-muted-foreground">Target</dt><dd className="tabular-nums">{pct(r)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The people who are rows: RMs in the viewer's slice, plus anyone holding clients in it. */
async function teamPeople(tx: Tx, ctx: WidgetCtx, holders: string[]): Promise<Array<{ id: string; name: string }>> {
  const s = ctx.scope;
  if (ctx.access.kind === "self") return [{ id: ctx.session.userId, name: ctx.userNames.get(ctx.session.userId) ?? "Me" }];
  const rms = s.rmIds ?? [];
  const rows = (await tx.execute(sql`
    SELECT id, name FROM users
     WHERE tenant_id = ${ctx.tenantId}::uuid
       AND (
         id IN (${holders.length ? sql.join(holders.map((h) => sql`${h}::uuid`), sql`, `) : sql`NULL`})
         OR (status = 'active' AND roles && ARRAY['rm']::text[]
             ${s.branchIds?.length ? sql`AND branch_id IN (${sql.join(s.branchIds.map((b) => sql`${b}::uuid`), sql`, `)})` : sql``})
       )
       ${rms.length ? sql`AND id IN (${sql.join(rms.map((r) => sql`${r}::uuid`), sql`, `)})` : sql``}
     ORDER BY name
  `)).rows as Array<{ id: string; name: string | null }>;
  return rows.map((r) => ({ id: r.id, name: stripRole(r.name ?? "—") }));
}

/** "Rajesh Demo (Owner)" → "Rajesh Demo": the role is not part of a name. */
export function stripRole(name: string): string {
  return name.replace(/\s*\((owner|rm|ops|marketing|compliance|team member|branch head|back office|admin)\)\s*$/i, "").trim() || name;
}

async function teamTable(tx: Tx, ctx: WidgetCtx, dashboardHref: string) {
  const s = ctx.scope;
  const p = ctx.period;
  const fy = { from: p.fyStart, to: p.to };
  const [book, sip, net, netFy, newc, overdue, targets] = await inOrder(
    () => getBookByRm(tx, s),
    () => getSipBookByRm(tx, s),
    () => getNetBusinessByRm(tx, s, p),
    () => getNetBusinessByRm(tx, s, fy),
    () => getNewClientsByRm(tx, s, p),
    () => getOverdueTasksByAssignee(tx, { tenantId: s.tenantId, rmIds: s.rmIds, branchIds: s.branchIds }),
    () => getTargetsByUser(tx, s.tenantId, p.fiscalYear, "net_business"),
  );
  const holders = [...book.keys()].filter((k): k is string => !!k);
  const people = await teamPeople(tx, ctx, holders);
  const rows: TeamRow[] = people.map((u) => {
    const b = book.get(u.id);
    const target = targets.get(u.id) ?? null;
    const fyNet = netFy.hasData ? netFy.byRm.get(u.id) ?? 0 : null;
    return {
      key: u.id,
      name: u.name,
      href: `${dashboardHref}${qs({ period: ctx.state.period, from: ctx.state.from, to: ctx.state.to, rm: u.id })}`,
      clients: b?.clients ?? 0,
      aum: b?.aum ?? 0,
      sip: sip.get(u.id) ?? 0,
      net: net.hasData ? net.byRm.get(u.id) ?? 0 : null,
      newClients: newc.get(u.id) ?? 0,
      overdue: overdue.get(u.id) ?? 0,
      target,
      targetPct: targetPct(fyNet, target),
    };
  });
  // Clients with no RM: a row of their own, so each column adds up to the firm.
  const orphan = book.get(null);
  if (orphan && orphan.clients > 0 && !(s.rmIds?.length)) {
    rows.push({
      key: "none",
      name: "No RM assigned",
      clients: orphan.clients,
      aum: orphan.aum,
      sip: sip.get(null) ?? 0,
      net: net.hasData ? net.byRm.get(null) ?? 0 : null,
      newClients: newc.get(null) ?? 0,
      overdue: null,
      target: null,
      targetPct: null,
    });
  }
  rows.sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : b.aum - a.aum));
  if (!rows.length) return { body: null };
  return {
    body: <TeamTable rows={rows} head="RM" hasLedger={net.hasData} />,
    subtitle: `${formatCount(rows.filter((r) => r.key !== "none").length)} RMs`,
  };
}

async function branchTable(tx: Tx, ctx: WidgetCtx, dashboardHref: string) {
  // Only when the firm has more than one real branch and the viewer sees the firm.
  if (ctx.branchCount <= 1 || ctx.access.kind !== "firm") return { body: null };
  const s: MetricScope = { ...ctx.scope, rmIds: undefined };
  const p = ctx.period;
  const fy = { from: p.fyStart, to: p.to };
  const [book, sipRows, net, netFy, newc, overdueRows, targets] = await inOrder(
    () => getBookByBranch(tx, s),
    () => tx.execute(sql`
      SELECT i.branch_id, COALESCE(SUM(${sipMonthlySql("s")}), 0) AS v
        FROM sips s JOIN investors i ON i.id = s.investor_id
       WHERE s.tenant_id = ${s.tenantId}::uuid AND s.status = 'active' AND ${clientWhere(s, "i")}
       GROUP BY i.branch_id`),
    () => getNetBusinessByBranch(tx, s, p),
    () => getNetBusinessByBranch(tx, s, fy),
    () => getNewClientsByBranch(tx, s, p),
    () => tx.execute(sql`
      SELECT u.branch_id, COUNT(*)::int AS n FROM tasks t JOIN users u ON u.id = t.assignee_id
       WHERE t.tenant_id = ${s.tenantId}::uuid AND t.deleted_at IS NULL
         AND t.status IN ('open', 'in_progress', 'blocked') AND t.due_at < now()
       GROUP BY u.branch_id`),
    () => getTargetsByBranch(tx, s.tenantId, p.fiscalYear, "net_business"),
  );
  const sip = new Map((sipRows.rows as Array<{ branch_id: string | null; v: string }>).map((r) => [r.branch_id, Number(r.v)]));
  const overdue = new Map((overdueRows.rows as Array<{ branch_id: string | null; n: number }>).map((r) => [r.branch_id, Number(r.n)]));
  const rows: TeamRow[] = [...ctx.branchNames.entries()].map(([id, name]) => {
    const b = book.get(id);
    const target = targets.get(id) ?? null;
    const fyNet = netFy.hasData ? netFy.byBranch.get(id) ?? 0 : null;
    return {
      key: id,
      name,
      href: `${dashboardHref}${qs({ period: ctx.state.period, from: ctx.state.from, to: ctx.state.to, branch: id })}`,
      clients: b?.clients ?? 0,
      aum: b?.aum ?? 0,
      sip: sip.get(id) ?? 0,
      net: net.hasData ? net.byBranch.get(id) ?? 0 : null,
      newClients: newc.get(id) ?? 0,
      overdue: overdue.get(id) ?? 0,
      target,
      targetPct: targetPct(fyNet, target),
    };
  });
  const orphan = book.get(null);
  if (orphan && orphan.clients > 0) {
    rows.push({
      key: "none", name: "No branch", clients: orphan.clients, aum: orphan.aum, sip: sip.get(null) ?? 0,
      net: net.hasData ? net.byBranch.get(null) ?? 0 : null, newClients: newc.get(null) ?? 0, overdue: null, target: null, targetPct: null,
    });
  }
  rows.sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : b.aum - a.aum));
  return { body: <TeamTable rows={rows} head="Branch" hasLedger={net.hasData} />, subtitle: `${formatCount(ctx.branchCount)} branches` };
}

/* ─────────────────────────── money movement ─────────────────────────── */

async function moneyMovement(tx: Tx, ctx: WidgetCtx) {
  const coverage = await getLedgerCoverage(tx, ctx.tenantId);
  if (!coverage.last || coverage.last < ctx.period.from) return { body: null };
  const flows = await getMonthlyFlows(tx, ctx.scope, ctx.period);
  if (!flows.some((f) => f.gross !== 0 || f.redemption !== 0)) return { body: null };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const data: MoneyPoint[] = flows.map((f) => ({
    label: `${MONTHS[Number(f.month.slice(5, 7)) - 1]} ${f.month.slice(2, 4)}`,
    gross: f.gross,
    redemption: f.redemption,
    net: f.net,
  }));
  const net = flows.reduce((a, f) => a + f.net, 0);
  return {
    body: <MoneyMovementChart data={data} />,
    subtitle: `Net ${formatMoney(net)}`,
    href: transactionsHref(ctx),
    hrefLabel: "Transactions",
  };
}

async function moneyMovementCsv(tx: Tx, ctx: WidgetCtx) {
  const flows = await getMonthlyFlows(tx, ctx.scope, ctx.period);
  return {
    columns: ["Month", "Gross investment", "Redemption", "Net sales"],
    rows: flows.map((f) => [f.month, f.gross, f.redemption, f.net]),
  };
}

/* ──────────────────────────── top clients ──────────────────────────── */

async function topClientRows(tx: Tx, ctx: WidgetCtx, limit: number) {
  return (await tx.execute(sql`
    SELECT i.id, i.name, COALESCE(i.aum, 0) AS aum, COALESCE(i.active_sip_amount, 0) AS sip,
           i.last_contact_at, i.health_score
      FROM investors i
     WHERE ${clientWhere(ctx.scope, "i")}
     ORDER BY COALESCE(i.aum, 0) DESC, i.name
     LIMIT ${limit}
  `)).rows as Array<{ id: string; name: string; aum: string; sip: string; last_contact_at: string | null; health_score: number | null }>;
}

async function topClients(tx: Tx, ctx: WidgetCtx) {
  const rows = await topClientRows(tx, ctx, 10);
  if (!rows.length) return { body: null };
  const scale = pickMoneyScale(rows.map((r) => Number(r.aum)));
  return {
    body: (
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">Client</th>
            <th className="px-3 py-2 text-right">AUM</th>
            <th className="px-3 py-2 text-right">SIP a month</th>
            <th className="px-3 py-2 text-right hidden sm:table-cell">Last contact</th>
            <th className="px-3 py-2 text-right hidden sm:table-cell">Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 max-w-0 w-2/5">
                <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:underline truncate block">{r.name}</Link>
              </td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(Number(r.aum), { scale })}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{Number(r.sip) > 0 ? formatMoney(Number(r.sip)) : "—"}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">{r.last_contact_at ? formatDate(r.last_contact_at) : "Never"}</td>
              <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                {r.health_score ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
    href: clientsHref(ctx, { sort: "aum", dir: "desc" }),
    hrefLabel: "All clients",
  };
}

/* ─────────────────────────────── registry ─────────────────────────────── */

export function businessWidgets(dashboardHref: string): WidgetImpl[] {
  return [
    { key: "kpi_row", render: kpiRow },
    {
      key: "team_table",
      render: (tx, ctx) => teamTable(tx, ctx, dashboardHref),
      csv: async (tx, ctx) => {
        const s = ctx.scope;
        const [book, sip, net, newc, overdue] = await inOrder(
          () => getBookByRm(tx, s), () => getSipBookByRm(tx, s), () => getNetBusinessByRm(tx, s, ctx.period),
          () => getNewClientsByRm(tx, s, ctx.period),
          () => getOverdueTasksByAssignee(tx, { tenantId: s.tenantId, rmIds: s.rmIds, branchIds: s.branchIds }),
        );
        const ids = new Set<string | null>([...book.keys(), ...overdue.keys()]);
        return {
          columns: ["RM", "Clients", "AUM", "SIP book (monthly)", "Net business", "New clients", "Overdue tasks"],
          rows: [...ids].map((id) => [
            id ? stripRole(ctx.userNames.get(id) ?? id) : "No RM assigned",
            book.get(id)?.clients ?? 0, book.get(id)?.aum ?? 0, sip.get(id) ?? 0,
            net.hasData ? net.byRm.get(id) ?? 0 : null, newc.get(id) ?? 0, id ? overdue.get(id) ?? 0 : null,
          ]),
        };
      },
    },
    { key: "branch_table", render: (tx, ctx) => branchTable(tx, ctx, dashboardHref) },
    { key: "money_movement", render: moneyMovement, csv: moneyMovementCsv },
    {
      key: "top_clients",
      render: topClients,
      csv: async (tx, ctx) => {
        const rows = await topClientRows(tx, ctx, 500);
        return {
          columns: ["Client", "AUM", "SIP a month", "Last contact", "Health"],
          rows: rows.map((r) => [r.name, Number(r.aum), Number(r.sip), r.last_contact_at ? formatDate(r.last_contact_at) : null, r.health_score]),
        };
      },
    },
  ];
}
