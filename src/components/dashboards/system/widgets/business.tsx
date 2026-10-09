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
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, Minus, Repeat, Shield, TrendingUp, UserPlus, Users, Wallet } from "lucide-react";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  getAUM, getSipBook, getBookedBusiness, getNewClients, getInsurancePremium, getStockMonthAgo, getStockHistory, getTarget,
  getBookByRm, getBookByBranch, getSipBookByRm, getBookedNetByRm, getBookedNetByBranch,
  getNewClientsByRm, getNewClientsByBranch, getOverdueTasksByAssignee, getTargetsByUser, getTargetsByBranch,
  getBookedMonthlyFlows, hasBookedBusiness, clientWhere, sipMonthlySql, targetPct, getActiveClients,
  type MetricScope, inOrder,
} from "@/lib/metrics";
import { formatCount, formatDate, formatMoney, pickMoneyScale, type MoneyScale } from "@/lib/format";
import type { WidgetCtx, WidgetImpl } from "../types";
import { clientsHref, entriesHref, newClientsHref, qs, sipsHref, tasksHref } from "../links";
import { Drill } from "../Drill";
import { MoneyMovementChart, type MoneyPoint } from "../MoneyMovementChart";
import { Sparkline } from "../Sparkline";
import { Initials } from "@/components/dashboards/my/Shared";

/* ─────────────────────────────── pieces ─────────────────────────────── */

/** "↗ 4.3%" as a pill — green only when up; a fall is not an alarm (D6: colour is a signal). */
function Change({ cur, prev, inverse = false }: { cur: number; prev: number | null | undefined; inverse?: boolean }) {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return null;
  const up = pct > 0.05;
  const down = pct < -0.05;
  const good = inverse ? down : up;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`dash-delta ${good ? "dash-delta-good" : ""}`}>
      <Icon className="size-3.5" aria-hidden />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

/** The hue of a tile's icon chip — the same set the RM and Branch Head tiles use. */
type KpiHue = "indigo" | "violet" | "emerald" | "cyan" | "amber" | "rose";

function KpiTile({
  label, value, unit, href, info, compare, footer, empty, when, icon, hue = "indigo", progress, spark, className = "",
}: {
  label: string;
  value: string;
  /** A quiet suffix on the figure: "/mo". */
  unit?: string;
  href?: string;
  info?: string;
  /** What the figure covers: "Today" for a balance, the period for money that moved. */
  when?: string;
  compare?: { node: ReactNode; label: string } | null;
  footer?: ReactNode;
  /** No data at all: "—" and what to do about it (or only why, when nothing can be done here). */
  empty?: { hint: string; href?: string; cta?: string } | null;
  icon: ReactNode;
  hue?: KpiHue;
  /** Share of a target reached, 0–1: drawn as a slim bar under the figure. */
  progress?: number | null;
  /** Recorded month-ends, oldest first — drawn beside the figure from three points up. */
  spark?: number[] | null;
  /** Grid placement. */
  className?: string;
}) {
  const head = (
    <div className="flex items-center gap-2.5">
      <span className="dash-kpi-chip" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium leading-snug text-foreground" title={info}>
          <span className="min-w-0">{label}</span>
          {info && <Info className="size-3.5 shrink-0 cursor-help text-muted-foreground/70" aria-label={info} />}
        </div>
        {when && <div className="truncate text-2xs text-muted-foreground">{when}</div>}
      </div>
    </div>
  );
  const shell = `dash-kpi card-surface ${className}`;
  const showSpark = !!spark && spark.length >= 3;
  const style = { ["--c" as string]: `hsl(var(--metric-${hue}))` };

  if (empty) {
    return (
      <div className={shell} style={style}>
        {head}
        <div className="dash-kpi-value dash-kpi-value-empty mt-3" title={empty.hint}>—</div>
        <div className="mt-auto pt-2 text-xs">
          {empty.href && empty.cta ? (
            <Link href={empty.href} className="inline-flex min-h-6 items-center gap-1 font-medium text-primary hover:underline">
              {empty.cta}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ) : (
            <span className="text-muted-foreground">{empty.hint}</span>
          )}
        </div>
      </div>
    );
  }

  const body = (
    <>
      {head}
      <div className="dash-kpi-value mt-3 whitespace-nowrap">
        {value}
        {unit && <span className="dash-kpi-unit">{unit}</span>}
      </div>
      {progress != null && (
        <div className="dash-bar mt-2.5" aria-hidden>
          <span style={{ width: `${Math.max(2, Math.min(100, progress * 100))}%` }} />
        </div>
      )}
      {(compare || footer || showSpark) && (
        <div className="mt-auto flex items-end justify-between gap-3 pt-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {compare && <>{compare.node}<span>{compare.label}</span></>}
            {footer && <span className={compare ? "basis-full" : ""}>{footer}</span>}
          </div>
          {/* Beside the comparison, not the figure: next to the figure it
              pushed "₹16.23 Cr" onto two lines on a narrow tile. */}
          {showSpark && <Sparkline values={spark!} width={64} height={22} className="shrink-0" style={{ color: "var(--c)" }} />}
        </div>
      )}
    </>
  );
  return href
    ? <Link href={href} className={shell} style={style}>{body}</Link>
    : <div className={shell} style={style}>{body}</div>;
}

const money = (v: number | null | undefined, scale: MoneyScale = "auto") => formatMoney(v, { scale });

/** A comparison line, or null when there is nothing to compare with (a zero or missing base). */
function vs(cur: number, prev: number | null | undefined, label: string, inverse = false) {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  return { node: <Change cur={cur} prev={prev} inverse={inverse} />, label };
}

/**
 * Seven tiles on a twelve-column grid: four, then three that share the second
 * row equally. On a plain four-column grid the last row stopped one tile short
 * and left a hole at the end of the headline.
 */
const ROW_OF_FOUR = "col-span-6 xl:col-span-3";
const ROW_OF_THREE = "col-span-6 xl:col-span-4";
/** The seventh tile: alone on its row on a phone, so it takes the row. */
const ROW_LAST = "col-span-12 xl:col-span-4";

/** The period's own name for comparisons ("vs same period last year"). */
const YOY = "vs same period last year";

/* ─────────────────────────────── KPI row ─────────────────────────────── */

async function kpiRow(tx: Tx, ctx: WidgetCtx) {
  const s = ctx.scope;
  const p = ctx.period;
  const fy = { from: p.fyStart, to: p.to };
  const [aum, sip, then, history, biz, newCur, newPrev, newFy, target, ins, counts] = await inOrder(
    () => getAUM(tx, s),
    () => getSipBook(tx, s),
    () => getStockMonthAgo(tx, s),
    () => getStockHistory(tx, s, 12),
    () => getBookedBusiness(tx, s, p, p.prev),
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
  // The recorded month-ends, then today's live figure — the same series the
  // Business trend card draws, folded into the tile as a sparkline.
  const thisMonth = p.to.slice(0, 7);
  const past = history.filter((h) => h.month < thisMonth);
  const aumSpark = [...past.map((h) => h.aum), aum.aum];
  const sipSpark = [...past.map((h) => h.sip), sip.monthly];
  // Balances are as they stand today; everything else moved in the period.
  const flow = p.key === "custom" ? "Custom range" : p.name;

  return {
    body: (
      <div className="grid grid-cols-12 gap-3 sm:gap-4">
        <KpiTile
          className={ROW_OF_FOUR}
          icon={<TrendingUp className="size-4" />}
          hue="indigo"
          label="AUM"
          when="Today"
          spark={aumSpark}
          value={money(aum.aum)}
          href={clientsHref(ctx, { sort: "aum", dir: "desc" })}
          info="Assets under management of live clients, today. Moves with the market as well as with sales."
          compare={then ? vs(aum.aum, then.aum, `vs ${formatDate(then.date, "dayMonth")}`) : null}
        />
        <KpiTile
          className={ROW_OF_FOUR}
          icon={<Repeat className="size-4" />}
          hue="violet"
          label="SIP book"
          when="Today"
          spark={sipSpark}
          value={money(sip.monthly)}
          unit="/mo"
          href={sipsHref(ctx)}
          info="Active SIPs of live clients, converted to a monthly amount. The same total as the SIP Book page."
          compare={then ? vs(sip.monthly, then.sip, `vs ${formatDate(then.date, "dayMonth")}`) : null}
        />
        <KpiTile
          className={ROW_OF_FOUR}
          icon={<Wallet className="size-4" />}
          hue="emerald"
          label="Net business"
          when={flow}
          value={money(cur?.net ?? null)}
          href={entriesHref(ctx)}
          info={bizInfo ?? "Gross investment minus redemption, as booked in Business Entries — every product."}
          empty={biz.hasData ? null : { hint: "No business booked yet", href: "/dashboard/business-entries/new", cta: "Record business" }}
          compare={cur && prev ? vs(cur.net, prev.net, YOY) : null}
        />
        <KpiTile
          className={ROW_OF_FOUR}
          icon={<Repeat className="size-4" />}
          hue="violet"
          label="Net SIP added"
          when={flow}
          value={cur ? money(cur.netSip) : "—"}
          unit={cur ? "/mo" : undefined}
          info={cur
            ? `New SIPs ${money(cur.newSip)} a month, minus SIPs stopped ${money(cur.stoppedSip)} a month, in the period.`
            : "SIPs booked minus SIP stops booked, as a monthly amount."}
          href={entriesHref(ctx)}
          empty={biz.hasData ? null : { hint: "No business booked yet", href: "/dashboard/business-entries/new", cta: "Record business" }}
          compare={cur && prev ? vs(cur.netSip, prev.netSip, YOY) : null}
        />
        <KpiTile
          className={ROW_OF_THREE}
          icon={<UserPlus className="size-4" />}
          hue="cyan"
          progress={isFy && target ? pct ?? 0 : null}
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
          className={ROW_OF_THREE}
          icon={<Users className="size-4" />}
          hue="indigo"
          label="Clients"
          when="Today"
          value={formatCount(counts.funded)}
          href={clientsHref(ctx, { aum_min: "0.01" })}
          info="Clients holding money today (AUM above zero), the figure the registrar reports. Under it: every live client record (not closed, not merged), and how many are active."
          footer={`${formatCount(counts.clients)} client records · ${formatCount(counts.active)} active`}
        />
        <KpiTile
          className={ROW_LAST}
          icon={<Shield className="size-4" />}
          hue="amber"
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
  /** Each figure's drill-down; a column with no list that opens exactly
   *  its rows (e.g. the SIP book of clients with no RM) has none. */
  links?: Partial<Record<"clients" | "aum" | "sip" | "net" | "newClients" | "overdue", string>>;
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
                  <span className="flex items-center gap-2.5">
                    {r.key !== "none" && <Initials name={r.name} />}
                    {r.href ? <Link href={r.href} className="hover:underline truncate">{r.name}</Link> : <span className="text-muted-foreground truncate">{r.name}</span>}
                  </span>
                </td>
                <td className={td}><Drill href={r.links?.clients}>{formatCount(r.clients)}</Drill></td>
                <td className={td}><Drill href={r.links?.aum}>{formatMoney(r.aum, { scale: aumScale })}</Drill></td>
                <td className={td}><Drill href={r.links?.sip}>{formatMoney(r.sip, { scale: sipScale })}</Drill></td>
                <td className={td}>{hasLedger && r.net != null ? <Drill href={r.links?.net}>{formatMoney(r.net, { scale: netScale })}</Drill> : "—"}</td>
                <td className={td}><Drill href={r.newClients ? r.links?.newClients : null}>{formatCount(r.newClients)}</Drill></td>
                <td className={`${td} ${r.overdue ? "text-rose-700 font-medium" : ""}`}>{r.overdue == null ? "—" : <Drill href={r.overdue ? r.links?.overdue : null}>{formatCount(r.overdue)}</Drill>}</td>
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
              <div><dt className="text-muted-foreground">AUM</dt><dd className="tabular-nums"><Drill href={r.links?.aum}>{formatMoney(r.aum, { scale: aumScale })}</Drill></dd></div>
              <div><dt className="text-muted-foreground">SIP book</dt><dd className="tabular-nums"><Drill href={r.links?.sip}>{formatMoney(r.sip, { scale: sipScale })}</Drill></dd></div>
              <div><dt className="text-muted-foreground">Net business</dt><dd className="tabular-nums">{hasLedger && r.net != null ? formatMoney(r.net, { scale: netScale }) : "—"}</dd></div>
              <div><dt className="text-muted-foreground">New clients</dt><dd className="tabular-nums"><Drill href={r.newClients ? r.links?.newClients : null}>{formatCount(r.newClients)}</Drill></dd></div>
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
    () => getBookedNetByRm(tx, s, p),
    () => getBookedNetByRm(tx, s, fy),
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
      links: {
        clients: clientsHref(ctx, { rm: u.id }),
        aum: clientsHref(ctx, { rm: u.id, sort: "aum", dir: "desc" }),
        sip: sipsHref(ctx, { rm: u.id }),
        net: entriesHref(ctx, { rm: u.id }),
        newClients: newClientsHref(ctx, undefined, undefined, { rm: u.id }),
        overdue: tasksHref(ctx, { assignee: u.id, tab: "overdue" }),
      },
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
      // Only the Clients list can open "no RM" (rm=none); the SIP and
      // transaction lists cannot, so those figures stay plain.
      links: { clients: clientsHref(ctx, { rm: "none" }), aum: clientsHref(ctx, { rm: "none", sort: "aum", dir: "desc" }) },
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
    () => getBookedNetByBranch(tx, s, p),
    () => getBookedNetByBranch(tx, s, fy),
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
      links: {
        clients: clientsHref(ctx, { branch: id }),
        aum: clientsHref(ctx, { branch: id, sort: "aum", dir: "desc" }),
        sip: sipsHref(ctx, { branch: id }),
        newClients: newClientsHref(ctx, undefined, undefined, { branch: id }),
        overdue: tasksHref(ctx, { branch: id, tab: "overdue" }),
      },
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
  if (!(await hasBookedBusiness(tx, ctx.tenantId))) return { body: null };
  const flows = await getBookedMonthlyFlows(tx, ctx.scope, ctx.period);
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
    href: entriesHref(ctx),
    hrefLabel: "Business Entries",
  };
}

async function moneyMovementCsv(tx: Tx, ctx: WidgetCtx) {
  const flows = await getBookedMonthlyFlows(tx, ctx.scope, ctx.period);
  return {
    columns: ["Month", "Gross investment", "Redemption", "Net sales"],
    rows: flows.map((f) => [f.month, f.gross, f.redemption, f.net]),
  };
}

/* ──────────────────────────── top clients ──────────────────────────── */

/**
 * The client health score as a short meter and the number. The band is the
 * one the record carries (lib/investors/health.ts: 80 and over green, 60 and
 * over amber, else red); a client never scored shows a dash, not a red bar.
 */
function HealthMeter({ score, band }: { score: number | null; band: string | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const b = band ?? (score >= 80 ? "green" : score >= 60 ? "amber" : "red");
  const fill = b === "green" ? "bg-success" : b === "amber" ? "bg-warning" : "bg-destructive";
  return (
    <span className="inline-flex items-center justify-end gap-2" title={b === "green" ? "Healthy" : b === "amber" ? "Watch" : "At risk"}>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-secondary" aria-hidden>
        <span className={`block h-full rounded-full ${fill}`} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </span>
      <span className="w-6 text-right">{score}</span>
    </span>
  );
}

async function topClientRows(tx: Tx, ctx: WidgetCtx, limit: number) {
  return (await tx.execute(sql`
    SELECT i.id, i.name, COALESCE(i.aum, 0) AS aum, COALESCE(i.active_sip_amount, 0) AS sip,
           i.last_contact_at, i.health_score, i.health_band
      FROM investors i
     WHERE ${clientWhere(ctx.scope, "i")}
     ORDER BY COALESCE(i.aum, 0) DESC, i.name
     LIMIT ${limit}
  `)).rows as Array<{ id: string; name: string; aum: string; sip: string; last_contact_at: string | null; health_score: number | null; health_band: string | null }>;
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
            <th className="px-3 py-2 text-right whitespace-nowrap">AUM</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">SIP a month</th>
            <th className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">Last contact</th>
            <th className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 max-w-0 w-2/5">
                {/* No initials here: five columns in a half-width card leave the name no room. */}
                <Link href={`/dashboard/investors/${r.id}`} className="block truncate py-1 font-medium hover:underline">{r.name}</Link>
              </td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(Number(r.aum), { scale })}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{Number(r.sip) > 0 ? formatMoney(Number(r.sip)) : "—"}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">{r.last_contact_at ? formatDate(r.last_contact_at) : "Never"}</td>
              <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                <HealthMeter score={r.health_score} band={r.health_band} />
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
          () => getBookByRm(tx, s), () => getSipBookByRm(tx, s), () => getBookedNetByRm(tx, s, ctx.period),
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
