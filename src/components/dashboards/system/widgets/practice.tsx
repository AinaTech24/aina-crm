/**
 * The practice widgets of the Owner Dashboard: Business trend, SIP health,
 * AUM mix, Client mix, Brokerage and Automation this month. Every figure
 * comes from lib/metrics/practice.ts over ctx.scope (viewer access ∩ filters);
 * a figure the CRM never recorded is "—" with the reason, never ₹0.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import type { Tx } from "@/db/client";
import {
  getAUM, getSipBook, getStockHistory, getSipHealth, getAumMix, getClientMix, getBrokerage, getAutomationMonth,
  hasClientFilter, inOrder,
} from "@/lib/metrics";
import { formatCount, formatMoney, formatPercent, pickMoneyScale } from "@/lib/format";
import { loadTenantLicense } from "@/lib/auth/license";
import { isDashboardWidgetVisible } from "@/config/dashboard-widgets";
import type { WidgetCtx, WidgetImpl } from "../types";
import { clientsHref, newClientsHref, sipsHref } from "../links";
import { Drill } from "../Drill";
import { StockTrendChart, type StockTrendPoint } from "../StockTrendChart";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/** One figure in a card's tile row. */
function Tile({ label, value, href, tone, hint }: {
  label: string; value: ReactNode; href?: string; tone?: "danger" | "warning" | null; hint?: string;
}) {
  const valueClass = `text-lg font-semibold tabular-nums leading-tight ${tone === "danger" ? "text-rose-700" : tone === "warning" ? "text-amber-700" : "text-foreground"}`;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-secondary/30 p-3" title={hint}>
      {href ? <Link href={href} className={`${valueClass} hover:underline`}>{value}</Link> : <div className={valueClass}>{value}</div>}
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** A labelled share bar: name, amount and % of the whole. */
function ShareRow({ label, amount, pct, scaleFor }: { label: string; amount: number; pct: number; scaleFor: number[] }) {
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">{label}</span>
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {formatMoney(amount, { scale: pickMoneyScale(scaleFor) })} · {formatPercent(pct, 0)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary" aria-hidden>
        <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
    </li>
  );
}

/* ─────────────────────────────── Business trend ─────────────────────────────── */

async function businessTrend(tx: Tx, ctx: WidgetCtx) {
  const [history, aum, sip] = await inOrder(
    () => getStockHistory(tx, ctx.scope, 12),
    () => getAUM(tx, ctx.scope),
    () => getSipBook(tx, ctx.scope),
  );
  const thisMonth = ctx.period.to.slice(0, 7);
  // Recorded month ends, then today's live figure as the current month.
  const points: StockTrendPoint[] = history
    .filter((h) => h.month < thisMonth)
    .map((h) => ({ label: monthLabel(h.month), aum: h.aum, sip: h.sip }));
  points.push({ label: `${monthLabel(thisMonth)} (today)`, aum: aum.aum, sip: sip.monthly });
  if (points.length < 2) {
    // One point is not a trend. Say why instead of drawing a single bar.
    const why = hasClientFilter(ctx.scope) || ctx.scope.amcs?.length || (ctx.scope.rmIds?.length && ctx.scope.branchIds?.length)
      ? "Month-end AUM is recorded for the firm, each branch and each RM — not for this filter."
      : "Month-end AUM and SIP book are recorded every night; the trend fills in from the first recorded month.";
    return { body: <p className="text-sm text-muted-foreground">{why}</p>, subtitle: "Not enough history yet" };
  }
  return {
    // Past months are recorded totals with no list behind them; today's
    // figures open the clients and SIPs they are made of.
    body: (
      <div className="space-y-2">
        <StockTrendChart data={points} />
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Today:</span>
          <Drill href={clientsHref(ctx, { sort: "aum", dir: "desc" })} title="Clients, largest AUM first">AUM {formatMoney(aum.aum)}</Drill>
          <Drill href={sipsHref(ctx)} title="Active SIPs">SIP book {formatMoney(sip.monthly)} a month</Drill>
        </p>
      </div>
    ),
    subtitle: `Month-end, recorded · ${points.length} months`,
    info: "AUM and the SIP book on the last recorded day of each month (nightly snapshots), and today's live figure. A balance moves with the market as well as with sales.",
  };
}

/* ──────────────────────────────── SIP health ──────────────────────────────── */

async function sipHealth(tx: Tx, ctx: WidgetCtx) {
  // The platform can switch SIP persistency off for a firm's package.
  const license = await loadTenantLicense(ctx.tenantId, ctx.session.roles);
  if (!isDashboardWidgetVisible(license.allowedDashboardWidgets, "section.sip_persistency")) return { body: null };
  const h = await getSipHealth(tx, ctx.scope, ctx.period);
  if (!h.sips && !h.started && !h.stopped && !h.rejections && !h.cohort1y && !h.cohort3y) return { body: null };
  const change = h.monthAgo != null ? h.monthly - h.monthAgo : null;
  return {
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Tile label={`SIP book a month · ${formatCount(h.sips)} SIPs`} value={formatMoney(h.monthly)} href={sipsHref(ctx)} />
          <Tile label="Change on a month ago" value={change == null ? "—" : `${change >= 0 ? "+" : "−"}${formatMoney(Math.abs(change))}`}
            hint={change == null ? "Not recorded a month ago for this view." : "The SIP book now minus the book recorded about 30 days ago."} />
          <Tile label="Started in the period" value={formatCount(h.started)} />
          <Tile label="Stopped in the period" value={formatCount(h.stopped)} tone={h.stopped > h.started ? "warning" : null} />
          <Tile label="1-year persistency" value={h.persistency1y == null ? "—" : formatPercent(h.persistency1y, 0)}
            hint={h.persistency1y == null ? "No SIPs started 12–15 months ago." : `Of ${formatCount(h.cohort1y)} SIPs started 12–15 months ago, the share still running.`} />
          <Tile label="3-year persistency" value={h.persistency3y == null ? "—" : formatPercent(h.persistency3y, 0)}
            hint={h.persistency3y == null ? "No SIPs started 36–39 months ago." : `Of ${formatCount(h.cohort3y)} SIPs started 36–39 months ago, the share still running.`} />
        </div>
        {h.rejections > 0 && (
          <div className="text-sm">
            <Link href="/dashboard/sip-rejections" className="font-medium text-rose-700 hover:underline">
              {formatCount(h.rejections)} SIP rejection{h.rejections === 1 ? "" : "s"} in the period
            </Link>
            <span className="text-muted-foreground"> · {h.topReasons.map((r) => `${r.reason} (${r.count})`).join(", ")}</span>
          </div>
        )}
      </div>
    ),
    href: sipsHref(ctx),
    hrefLabel: "SIP book",
    info: "Persistency: of the SIPs that started 12–15 (or 36–39) months ago, the share still active. Started and stopped count SIP register rows in the period.",
  };
}

/* ───────────────────────────────── AUM mix ───────────────────────────────── */

async function aumMix(tx: Tx, ctx: WidgetCtx) {
  const m = await getAumMix(tx, ctx.scope);
  // A split with one bucket, "Not tiered", says nothing about where the money
  // sits — only that categories were never set, which is a record gap.
  const tiered = m.byTier.some((t) => t.key !== "NONE");
  if (!m.byAmc.length && !tiered) return { body: null };
  const top = m.byAmc[0];
  return {
    body: (
      <div className="grid gap-5 sm:grid-cols-2">
        {m.byAmc.length > 0 && (
          <section className="min-w-0">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">By fund house</h4>
            <ul className="space-y-2.5">
              {m.byAmc.map((a) => <ShareRow key={a.key} label={a.label} amount={a.aum} pct={a.pct} scaleFor={m.byAmc.map((x) => x.aum)} />)}
            </ul>
          </section>
        )}
        <section className="min-w-0">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">By client category</h4>
          {tiered ? (
            <ul className="space-y-2.5">
              {m.byTier.map((t) => <ShareRow key={t.key} label={`${t.label} · ${formatCount(t.count)}`} amount={t.aum} pct={t.pct} scaleFor={m.byTier.map((x) => x.aum)} />)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No client has a category (A–D) yet, so the book cannot be split by tier.</p>
          )}
        </section>
      </div>
    ),
    subtitle: top && top.key !== "__rest" && top.pct >= 25 ? `${top.label} holds ${formatPercent(top.pct, 0)} of folio AUM` : undefined,
    info: "By fund house: folio AUM of live clients, each as a share of the whole folio book. By client category: each client's AUM by their A–D category.",
    href: clientsHref(ctx, { sort: "aum", dir: "desc" }),
    hrefLabel: "Clients",
  };
}

/* ──────────────────────────────── Client mix ──────────────────────────────── */

async function clientMix(tx: Tx, ctx: WidgetCtx) {
  const c = await getClientMix(tx, ctx.scope, ctx.period);
  if (!c.clients && !c.exits) return { body: null };
  return {
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Tile label="Active" value={formatCount(c.active)} href={clientsHref(ctx, { status: "active,redemption_risk" })} />
          <Tile label="Funded (AUM above zero)" value={formatCount(c.funded)} href={clientsHref(ctx, { aum_min: "0.01" })} />
          <Tile label="New in the period" value={formatCount(c.newInPeriod)} href={newClientsHref(ctx)} />
          <Tile label="In a family" value={formatCount(c.inFamily)} />
          <Tile label="Dormant" value={formatCount(c.dormant)} tone={c.dormant > 0 ? "warning" : null}
            href={clientsHref(ctx, { status: "dormant,inactive" })} />
          <Tile label="Redemption risk" value={formatCount(c.atRisk)} tone={c.atRisk > 0 ? "danger" : null}
            href={clientsHref(ctx, { status: "redemption_risk" })} />
        </div>
        {c.exits > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{formatCount(c.exits)} client{c.exits === 1 ? "" : "s"} left</span> in the period
            {c.exitNetInflow > 0 ? `, having put in ${formatMoney(c.exitNetInflow)} net` : ""}.
          </p>
        )}
      </div>
    ),
    subtitle: `${formatCount(c.clients)} live clients`,
    href: clientsHref(ctx),
    hrefLabel: "Clients",
    info: "Live clients: not closed, not merged. Active: active or redemption risk. New: onboarded in the period. Left: closed in the period; what they had put in is lifetime inflow minus outflow.",
  };
}

/* ──────────────────────────────── Brokerage ──────────────────────────────── */

async function brokerage(tx: Tx, ctx: WidgetCtx) {
  // A statement is the ARN's: it cannot be split by RM, branch or client.
  if (ctx.access.kind !== "firm" || ctx.scope.rmIds?.length || ctx.scope.branchIds?.length || hasClientFilter(ctx.scope)) {
    return { body: null };
  }
  const b = await getBrokerage(tx, ctx.tenantId, ctx.period);
  if (!b.byMonth.length) return { body: null };
  const scale = pickMoneyScale(b.byMonth.map((m) => m.amount));
  const max = Math.max(...b.byMonth.map((m) => m.amount), 1);
  const amcTotal = b.byAmc.reduce((a, x) => a + x.amount, 0);
  return {
    body: (
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold tabular-nums">{b.hasData ? formatMoney(b.inPeriod) : "—"}</div>
            <div className="text-xs text-muted-foreground">
              {b.hasData ? "Brokerage in the period" : "No statement covers this period yet"}
            </div>
          </div>
          {b.latestMonth && <div className="text-xs text-muted-foreground">Latest statement: {monthLabel(b.latestMonth)}</div>}
        </div>
        <div className="flex h-20 items-end gap-1" aria-label="Brokerage by month">
          {b.byMonth.map((m) => (
            <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${monthLabel(m.month)}: ${formatMoney(m.amount, { scale })}`}>
              <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(4, (m.amount / max) * 64)}px` }} />
              <span className="text-2xs text-muted-foreground">{MONTHS[Number(m.month.slice(5, 7)) - 1]}</span>
            </div>
          ))}
        </div>
        {b.byAmc.length > 0 && (
          <ul className="space-y-2">
            {b.byAmc.slice(0, 4).map((a) => (
              <ShareRow key={a.amc} label={a.amc} amount={a.amount} pct={amcTotal > 0 ? (a.amount / amcTotal) * 100 : 0}
                scaleFor={b.byAmc.map((x) => x.amount)} />
            ))}
          </ul>
        )}
      </div>
    ),
    href: "/dashboard/reports/revenue-intelligence",
    hrefLabel: "Revenue",
    info: "From the imported Monthly Brokerage Statements. Firm-wide: a statement is the ARN's and is not split by RM or branch. Fund houses: the latest statement month.",
  };
}

/* ─────────────────────────────── Automation ─────────────────────────────── */

async function automation(tx: Tx, ctx: WidgetCtx) {
  if (ctx.access.kind !== "firm") return { body: null };
  const a = await getAutomationMonth(tx, ctx.tenantId);
  if (!a.runs && !a.sent && !a.tasks && !a.complianceBlocks) return { body: null };
  return {
    body: (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Workflow runs completed" value={formatCount(a.runs)} />
        <Tile label="Messages sent" value={formatCount(a.sent)} />
        <Tile label="Tasks created" value={formatCount(a.tasks)} />
        <Tile label="Sends stopped by compliance" value={formatCount(a.complianceBlocks)} />
        <Tile label="Hours saved (estimate)" value={a.hoursSaved.toFixed(1)} hint="2 minutes per message, 5 per workflow run, 3 per task." />
      </div>
    ),
    subtitle: "This calendar month, whole firm",
    href: "/dashboard/automations",
    hrefLabel: "Automations",
  };
}

/* ─────────────────────────────── registry ─────────────────────────────── */

export const practiceWidgets: WidgetImpl[] = [
  {
    key: "business_trend",
    render: businessTrend,
    csv: async (tx, ctx) => {
      const h = await getStockHistory(tx, ctx.scope, 24);
      return { columns: ["Month", "AUM", "SIP book (monthly)"], rows: h.map((p) => [p.month, p.aum, p.sip]) };
    },
  },
  { key: "sip_health", render: sipHealth },
  {
    key: "aum_mix",
    render: aumMix,
    csv: async (tx, ctx) => {
      const m = await getAumMix(tx, ctx.scope);
      return {
        columns: ["Cut", "Name", "AUM", "Share %", "Folios / clients"],
        rows: [
          ...m.byAmc.map((a) => ["Fund house", a.label, a.aum, Number(a.pct.toFixed(2)), a.count] as Array<string | number | null>),
          ...m.byTier.map((t) => ["Client category", t.label, t.aum, Number(t.pct.toFixed(2)), t.count] as Array<string | number | null>),
        ],
      };
    },
  },
  { key: "client_mix", render: clientMix },
  {
    key: "brokerage",
    render: brokerage,
    csv: async (tx, ctx) => {
      const b = await getBrokerage(tx, ctx.tenantId, ctx.period, 24);
      return { columns: ["Month", "Brokerage"], rows: b.byMonth.map((m) => [m.month, m.amount]) };
    },
  },
  { key: "automation", render: automation },
];
