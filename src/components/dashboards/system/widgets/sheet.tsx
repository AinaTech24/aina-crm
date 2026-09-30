/**
 * The Owner Dashboard cards added from the firm's dashboard sheet
 * (MFD_CRM_Dashboards.xlsx, "Owner Dashboard" tab): business from Business
 * Entries beside the RTA feed, SIP flow, new clients by category, the client
 * book by category / type / status, KYC and risk-profile status, meetings,
 * reviews due, SIP rejections by recovery status, insurance business by
 * product, claims in the period and task counts.
 *
 * Every figure comes from lib/metrics over ctx.scope (viewer access ∩
 * filters). Where the CRM has no field for what the sheet names, the metric
 * maps it onto what IS recorded and the card's (i) says how — never a guess
 * presented as a record.
 */

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import type { Tx } from "@/db/client";
import {
  getEntryMatrix, getEntrySipFlow, getNetBusiness, getBookBreakdown, getTarget, getNewClients, getRiskProfileCounts,
  getMeetingSummary, MEETING_BUCKETS, getReviewsDue, getSipRejectionSummary, getPremiumByProduct, getClaimsByStatus,
  getTaskSummary, inOrder, type BookBreakdown, type EntryCell,
} from "@/lib/metrics";
import { RISK_BUCKETS } from "@/lib/risk-profile/buckets";
import { formatCount, formatDate, formatMoney, formatPercent, pickMoneyScale } from "@/lib/format";
import type { WidgetCtx, WidgetImpl } from "../types";
import { clientsHref, newClientsHref, qs, riskProfilesHref, tasksHref } from "../links";

/* ─────────────────────────────── shared parts ─────────────────────────────── */

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

/** A labelled bar: name, figure and share of the whole. */
function Bar({ label, figure, pct, href }: { label: string; figure: string; pct: number; href?: string }) {
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        {href ? <Link href={href} className="truncate hover:underline">{label}</Link> : <span className="truncate">{label}</span>}
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">{figure}</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary" aria-hidden>
        <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))}%` }} />
      </div>
    </li>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
}

const th = "px-3 py-2 text-right whitespace-nowrap";
const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
const pctOf = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);

/* ───────────────────────── Business (Business Entries) ───────────────────────── */

async function businessEntries(tx: Tx, ctx: WidgetCtx) {
  const [m, rta] = await inOrder(
    () => getEntryMatrix(tx, ctx.scope, ctx.period),
    () => getNetBusiness(tx, ctx.scope, ctx.period),
  );
  if (!m.everRecorded && !rta.hasData) return { body: null };
  const scale = pickMoneyScale([m.total.gross, m.total.redemption, rta.current?.gross ?? 0, rta.current?.redemption ?? 0]);
  // An empty cell is "—": ₹0.00 Lakh of liquid redemption reads as a figure.
  const money = (n: number) => (n ? formatMoney(n, { scale }) : "—");
  const cells = (c: EntryCell, strong = false) => (
    <>
      <td className={`${td} ${strong ? "font-semibold" : ""}`}>{money(c.gross)}</td>
      <td className={`${td} ${strong ? "font-semibold" : ""}`}>{money(c.redemption)}</td>
      <td className={`${td} ${strong ? "font-semibold" : ""} ${c.net < 0 ? "text-rose-700" : ""}`}>{money(c.net)}</td>
      <td className={td}>{c.redeemingClients ? formatCount(c.redeemingClients) : "—"}</td>
    </>
  );
  const shown = m.products.filter((p) => p.total.gross || p.total.redemption);
  return {
    body: (
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">Product / type</th>
                <th className={th}>Gross investment</th>
                <th className={th}>Redemption</th>
                <th className={th}>Net business</th>
                <th className={th} title="Distinct clients with a redemption or SWP in the period">Clients redeeming</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-3 text-muted-foreground">No confirmed business entries in this period.</td></tr>
              )}
              {shown.map((p) => (
                <Fragment key={p.key}>
                  <tr>
                    <td className="px-3 py-2 font-medium">{p.label}</td>
                    {cells(p.total, true)}
                  </tr>
                  {p.rows.length > 1 && p.rows.map((r) => (
                    <tr key={`${p.key}-${r.key}`} className="text-muted-foreground">
                      <td className="px-3 py-1.5 pl-7">{r.label}</td>
                      {cells(r)}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {shown.length > 0 && (
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-semibold">Total — Business Entries</td>
                  {cells(m.total, true)}
                </tr>
              )}
              <tr className="border-t border-border">
                <td className="px-3 py-2 text-muted-foreground" title="CAMS / KFintech transactions processed in the period — mutual funds only">RTA feed (MF only)</td>
                {rta.current ? (
                  <>
                    <td className={td}>{money(rta.current.gross)}</td>
                    <td className={td}>{money(rta.current.redemption)}</td>
                    <td className={`${td} ${rta.current.net < 0 ? "text-rose-700" : ""}`}>{money(rta.current.net)}</td>
                    <td className={td}>—</td>
                  </>
                ) : (
                  <td colSpan={4} className="px-3 py-2 text-right text-muted-foreground">No RTA files cover this period</td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    ),
    subtitle: "Business Entries beside the RTA feed",
    href: "/dashboard/business-entries",
    hrefLabel: "Business Entries",
    info: "Business Entries: what the team recorded, confirmed entries only, by business date. Gross = SIP, top-up, lumpsum, additional purchase, switch and STP; redemption = redemption and SWP. RTA feed: what CAMS / KFintech processed (mutual funds only, switches excluded). The two can differ by timing and coverage.",
  };
}

/* ─────────────────────────────── SIP flow ─────────────────────────────── */

async function sipFlow(tx: Tx, ctx: WidgetCtx) {
  const [e, rta] = await inOrder(
    () => getEntrySipFlow(tx, ctx.scope, ctx.period),
    () => getNetBusiness(tx, ctx.scope, ctx.period),
  );
  if (!e.everRecorded && !rta.hasData) return { body: null };
  const r = rta.current;
  return {
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2.5">
          <Tile label={`Gross SIP added · ${formatCount(e.addedCount)}`} value={formatMoney(e.added)} />
          <Tile label={`SIP stopped · ${formatCount(e.stoppedCount)}`} value={formatMoney(e.stopped)} tone={e.stopped > e.added ? "warning" : null} />
          <Tile label="Net SIP" value={`${e.net < 0 ? "−" : ""}${formatMoney(Math.abs(e.net))}`} tone={e.net < 0 ? "danger" : null} />
        </div>
        <p className="text-xs text-muted-foreground">
          SIP register and RTA feed: {r
            ? `${formatMoney(r.newSip)} added · ${formatMoney(r.stoppedSip)} stopped · ${formatMoney(r.netSip)} net`
            : "no RTA files cover this period"}
        </p>
      </div>
    ),
    subtitle: "Monthly SIP amount, from Business Entries",
    href: "/dashboard/business-entries",
    hrefLabel: "Business Entries",
    info: "Gross SIP added: SIP and top-up lines on confirmed Business Entries in the period, at their monthly equivalent. SIP stopped: SIP-stop lines. The line below is the same idea from the SIP register (SIPs started) and the RTA feed (stops it reported).",
  };
}

/* ─────────────────────────── New clients by category ─────────────────────────── */

async function newClientsByCategory(tx: Tx, ctx: WidgetCtx) {
  const p = ctx.period;
  const [b, fytd, target] = await inOrder(
    () => getBookBreakdown(tx, ctx.scope, "category", p),
    () => getNewClients(tx, ctx.scope, { from: p.fyStart, to: p.to }),
    () => getTarget(tx, ctx.scope, p.fiscalYear, "new_clients"),
  );
  if (!b.newTotal && !target) return { body: null };
  const rows = b.rows.filter((r) => r.newCount);
  return {
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="New clients in the period" value={formatCount(b.newTotal)} href={newClientsHref(ctx)} />
          <Tile label={target ? `FY to date of ${formatCount(target)} target` : "FY to date · no target set"}
            value={target ? `${formatCount(fytd)} · ${formatPercent((fytd / target) * 100, 0)}` : formatCount(fytd)} />
        </div>
        {rows.length > 0 && (
          <ul className="space-y-2.5">
            {rows.map((r) => <Bar key={r.key} label={r.label} figure={formatCount(r.newCount)} pct={pctOf(r.newCount, b.newTotal)} />)}
          </ul>
        )}
      </div>
    ),
    subtitle: "By client category, onboarding date",
    href: newClientsHref(ctx),
    hrefLabel: "New clients",
    info: "Clients whose onboarding date falls in the period, by their A–D category. The target is the firm's FY new-clients target; achievement is always FY to date.",
  };
}

/* ─────────────────────────────── Client book ─────────────────────────────── */

function BookList({ b, money }: { b: BookBreakdown; money: boolean }) {
  const scale = pickMoneyScale(b.rows.map((r) => r.aum));
  return (
    <ul className="space-y-2.5">
      {b.rows.map((r) => (
        <Bar key={r.key} label={`${r.label}${r.newCount ? ` · ${formatCount(r.newCount)} new` : ""}`}
          figure={`${formatCount(r.count)}${money ? ` · ${formatMoney(r.aum, { scale })}` : ""}`}
          pct={pctOf(r.count, b.total)} />
      ))}
    </ul>
  );
}

async function clientBook(tx: Tx, ctx: WidgetCtx) {
  const [cat, type, status] = await inOrder(
    () => getBookBreakdown(tx, ctx.scope, "category", ctx.period),
    () => getBookBreakdown(tx, ctx.scope, "type", ctx.period),
    () => getBookBreakdown(tx, ctx.scope, "status", ctx.period),
  );
  if (!cat.total && !status.total) return { body: null };
  return {
    body: (
      <div className="grid gap-5 md:grid-cols-3">
        <section className="min-w-0"><SectionTitle>By category · clients · AUM</SectionTitle><BookList b={cat} money /></section>
        <section className="min-w-0"><SectionTitle>By client type</SectionTitle><BookList b={type} money={false} /></section>
        <section className="min-w-0"><SectionTitle>By status</SectionTitle><BookList b={status} money={false} /></section>
      </div>
    ),
    subtitle: `${formatCount(cat.total)} live clients · ${formatCount(cat.newTotal)} onboarded in the period`,
    href: clientsHref(ctx),
    hrefLabel: "Clients",
    info: "Category and type: live clients (not closed or merged), with how many of each were onboarded in the period. Client type is derived: corporate investors; the family's primary member as family head; other family members; everyone else individual. Status counts every client record, closed included.",
  };
}

/* ───────────────────────────── KYC & risk profile ───────────────────────────── */

async function kycRisk(tx: Tx, ctx: WidgetCtx) {
  const [kyc, risk] = await inOrder(
    () => getBookBreakdown(tx, ctx.scope, "kyc", ctx.period),
    () => getRiskProfileCounts(tx, ctx.scope),
  );
  if (!kyc.total && !risk.total) return { body: null };
  return {
    body: (
      <div className="grid gap-5 sm:grid-cols-2">
        <section className="min-w-0">
          <SectionTitle>KYC status</SectionTitle>
          <ul className="space-y-2.5">
            {kyc.rows.map((r) => (
              <Bar key={r.key} label={`${r.label}${r.newCount ? ` · ${formatCount(r.newCount)} new` : ""}`}
                figure={formatCount(r.count)} pct={pctOf(r.count, kyc.total)} />
            ))}
          </ul>
        </section>
        <section className="min-w-0">
          <SectionTitle>Risk profile</SectionTitle>
          <ul className="space-y-2.5">
            {RISK_BUCKETS.filter((b) => risk[b.key]).map((b) => (
              <Bar key={b.key} label={b.label} figure={formatCount(risk[b.key])} pct={pctOf(risk[b.key], risk.total)}
                href={riskProfilesHref(ctx, b.key)} />
            ))}
          </ul>
        </section>
      </div>
    ),
    subtitle: `${formatCount(kyc.total)} live clients`,
    href: riskProfilesHref(ctx, "due,expired"),
    hrefLabel: "Risk profiles",
    info: "KYC: the status on each live client's record ('new' = onboarded in the period); blank is Not recorded. Risk profile: active clients by the Risk Profiles page's buckets.",
  };
}

/* ─────────────────────────────── Meetings ─────────────────────────────── */

async function meetings(tx: Tx, ctx: WidgetCtx) {
  const rows = await getMeetingSummary(tx, ctx.scope, ctx.period);
  if (!rows.some((r) => r.total)) return { body: null };
  return {
    body: (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left">Meeting</th>
              <th className={th}>Total</th>
              {MEETING_BUCKETS.map((b) => <th key={b.key} className={th}>{b.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className={`${td} font-semibold`}>{formatCount(r.total)}</td>
                {MEETING_BUCKETS.map((b) => (
                  <td key={b.key} className={`${td} ${b.key === "missed" && r[b.key] ? "text-amber-700" : ""}`}>{r[b.key] ? formatCount(r[b.key]) : "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    subtitle: "Meetings dated in the period",
    href: "/dashboard/review-meetings",
    hrefLabel: "Meetings",
    info: "By meeting category (new, review, follow-up) and status, for the RM holding the meeting. On-call discussions are meetings held by phone, of any category — the CRM has no separate on-call category, so they also appear in the rows above.",
  };
}

/* ─────────────────────────────── Reviews due ─────────────────────────────── */

async function reviewsDue(tx: Tx, ctx: WidgetCtx) {
  const r = await getReviewsDue(tx, ctx.scope, 8);
  if (!r.overdue && !r.due30 && !r.dueThisMonth) return { body: null };
  return {
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2.5">
          <Tile label="Overdue" value={formatCount(r.overdue)} tone={r.overdue ? "danger" : null} href={clientsHref(ctx, { review: "overdue" })} />
          <Tile label="Due this month" value={formatCount(r.dueThisMonth)} tone={r.dueThisMonth ? "warning" : null} />
          <Tile label="Due in 30 days" value={formatCount(r.due30)} />
        </div>
        {r.rows.length > 0 && (
          <ul className="divide-y divide-border">
            {r.rows.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2 min-w-0">
                <Link href={`/dashboard/investors/${x.id}`} className="flex-1 min-w-0 truncate text-sm font-medium hover:underline">{x.name}</Link>
                {ctx.access.kind !== "self" && x.rmId && (
                  <span className="hidden sm:inline max-w-32 truncate text-xs text-muted-foreground">{ctx.userNames.get(x.rmId) ?? ""}</span>
                )}
                <span className={`whitespace-nowrap text-xs ${x.overdue ? "font-medium text-rose-700" : "text-muted-foreground"}`}>
                  {formatDate(x.nextReview, "dayMonth")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {r.unscheduled > 0 && (
          <p className="text-xs text-muted-foreground">{formatCount(r.unscheduled)} live client{r.unscheduled === 1 ? " has" : "s have"} no next review date.</p>
        )}
      </div>
    ),
    subtitle: "By next review date",
    href: clientsHref(ctx, { review: "overdue" }),
    hrefLabel: "Overdue reviews",
    info: "Each live client's next review date. Overdue: before today. Due this month: today to the month end. Due in 30 days: today and the next 30.",
  };
}

/* ─────────────────────────────── SIP rejections ─────────────────────────────── */

async function sipRejections(tx: Tx, ctx: WidgetCtx) {
  const s = await getSipRejectionSummary(tx, ctx.scope, ctx.period);
  if (!s.count) return { body: null };
  const scale = pickMoneyScale(s.rows.map((r) => r.amount));
  return {
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="SIPs rejected" value={formatCount(s.count)} tone="danger" href="/dashboard/sip-rejections" />
          <Tile label="Value rejected" value={formatMoney(s.amount)} />
        </div>
        <ul className="space-y-2.5">
          {s.rows.filter((r) => r.count).map((r) => (
            <Bar key={r.key} label={r.label} figure={`${formatCount(r.count)} · ${formatMoney(r.amount, { scale })}`} pct={pctOf(r.count, s.count)} />
          ))}
        </ul>
      </div>
    ),
    subtitle: "Rejected in the period, by recovery status",
    href: "/dashboard/sip-rejections",
    hrefLabel: "SIP rejections",
    info: "SIP rejections dated in the period. Pending: pending, bank issue or mandate issue. Contacted: client contacted. Repurchase done: reprocessed or recovered. Not recoverable is shown on its own.",
  };
}

/* ───────────────────────────── Insurance business ───────────────────────────── */

async function insuranceBusiness(tx: Tx, ctx: WidgetCtx) {
  const b = await getPremiumByProduct(tx, ctx.scope, ctx.period);
  if (!b.hasData || !b.rows.length) return { body: null };
  const scale = pickMoneyScale(b.rows.flatMap((r) => [r.newPremium, r.renewalPremium]));
  const money = (n: number) => (n ? formatMoney(n, { scale }) : "—");
  return {
    body: (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left">Product</th>
              <th className={th}>New premium</th>
              <th className={th}>Policies</th>
              <th className={th}>Renewal premium</th>
              <th className={th}>Policies</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className={td}>{money(r.newPremium)}</td>
                <td className={td}>{r.newPolicies ? formatCount(r.newPolicies) : "—"}</td>
                <td className={td}>{money(r.renewalPremium)}</td>
                <td className={td}>{r.renewalPolicies ? formatCount(r.renewalPolicies) : "—"}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="px-3 py-2 font-semibold">Total</td>
              <td className={`${td} font-semibold`}>{money(b.newPremium)}</td>
              <td className={td}>{formatCount(b.rows.reduce((s, r) => s + r.newPolicies, 0))}</td>
              <td className={`${td} font-semibold`}>{money(b.renewalPremium)}</td>
              <td className={td}>{formatCount(b.rows.reduce((s, r) => s + r.renewalPolicies, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
    subtitle: "Premium booked in the period, by product",
    href: "/dashboard/insurance",
    hrefLabel: "Insurance",
    info: "Annual premium of issued policies whose cover began in the period. Renewal: the policy's business type is renewal or portability; otherwise new.",
  };
}

/* ─────────────────────────────── Claims ─────────────────────────────── */

async function claimsPeriod(tx: Tx, ctx: WidgetCtx) {
  const c = await getClaimsByStatus(tx, ctx.scope, ctx.period);
  if (!c.count) return { body: null };
  const scale = pickMoneyScale(c.rows.flatMap((r) => [r.claimed, r.settled]));
  const money = (n: number) => (n ? formatMoney(n, { scale }) : "—");
  return {
    body: (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left">Status</th>
              <th className={th}>Claims</th>
              <th className={th}>Claimed</th>
              <th className={th}>Settled</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2">{r.label}</td>
                <td className={td}>{formatCount(r.count)}</td>
                <td className={td}>{money(r.claimed)}</td>
                <td className={td}>{money(r.settled)}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="px-3 py-2 font-semibold">Total</td>
              <td className={`${td} font-semibold`}>{formatCount(c.count)}</td>
              <td className={`${td} font-semibold`}>{money(c.claimed)}</td>
              <td className={`${td} font-semibold`}>{money(c.settled)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
    subtitle: "Claims intimated in the period",
    href: `/dashboard/insurance-claims${qs({ rm: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`,
    hrefLabel: "Claims",
    info: "Claims whose intimation date (else the date keyed) falls in the period, by their status today, with the amount claimed and settled.",
  };
}

/* ─────────────────────────────── Tasks ─────────────────────────────── */

async function taskSummary(tx: Tx, ctx: WidgetCtx) {
  const t = await getTaskSummary(tx, ctx.scope, ctx.period);
  if (!t.all.total) return { body: null };
  const rows = [
    { key: "fin", label: "Financial", c: t.financial },
    { key: "non", label: "Non-financial", c: t.nonFinancial },
  ];
  return {
    body: (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left">Tasks</th>
              <th className={th}>Total</th>
              <th className={th}>Pending</th>
              <th className={th} title="Blocked, or waiting for an approver">Awaiting input</th>
              <th className={th}>Completed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className={`${td} font-semibold`}>{formatCount(r.c.total)}</td>
                <td className={td}>{formatCount(r.c.pending)}</td>
                <td className={`${td} ${r.c.awaiting ? "text-amber-700" : ""}`}>{formatCount(r.c.awaiting)}</td>
                <td className={td}>{formatCount(r.c.completed)}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="px-3 py-2 font-semibold">All tasks</td>
              <td className={`${td} font-semibold`}>{formatCount(t.all.total)}</td>
              <td className={td}>{formatCount(t.all.pending)}</td>
              <td className={td}>{formatCount(t.all.awaiting)}</td>
              <td className={td}>{formatCount(t.all.completed)}</td>
            </tr>
          </tbody>
        </table>
        {t.all.cancelled > 0 && <p className="mt-2 text-xs text-muted-foreground">{formatCount(t.all.cancelled)} cancelled (in Total).</p>}
      </div>
    ),
    subtitle: "Tasks created in the period, as they stand today",
    href: tasksHref(ctx),
    hrefLabel: "Tasks",
    info: "Tasks created in the period, by their state today. Awaiting input: blocked, or waiting for an approver — the CRM has no separate 'awaiting input' status. Financial: task types where money moves (SIP, mandate, purchase, redemption, switch, STP, SWP).",
  };
}

/* ─────────────────────────────── registry ─────────────────────────────── */

export const sheetWidgets: WidgetImpl[] = [
  {
    key: "business_entries",
    render: businessEntries,
    csv: async (tx, ctx) => {
      const m = await getEntryMatrix(tx, ctx.scope, ctx.period);
      return {
        columns: ["Product", "Type", "Gross investment", "Redemption", "Net business", "Clients redeeming"],
        rows: m.products.flatMap((p) => [
          [p.label, "All", p.total.gross, p.total.redemption, p.total.net, p.total.redeemingClients] as Array<string | number | null>,
          ...p.rows.map((r) => [p.label, r.label, r.gross, r.redemption, r.net, r.redeemingClients] as Array<string | number | null>),
        ]),
      };
    },
  },
  { key: "sip_flow", render: sipFlow },
  { key: "new_clients_category", render: newClientsByCategory },
  {
    key: "client_book",
    render: clientBook,
    csv: async (tx, ctx) => {
      const out: Array<Array<string | number | null>> = [];
      for (const dim of ["category", "type", "status"] as const) {
        const b = await getBookBreakdown(tx, ctx.scope, dim, ctx.period);
        for (const r of b.rows) out.push([dim, r.label, r.count, r.aum, r.newCount]);
      }
      return { columns: ["Cut", "Value", "Clients", "AUM", "Onboarded in period"], rows: out };
    },
  },
  { key: "kyc_risk", render: kycRisk },
  {
    key: "meetings",
    render: meetings,
    csv: async (tx, ctx) => {
      const rows = await getMeetingSummary(tx, ctx.scope, ctx.period);
      return {
        columns: ["Meeting", "Total", ...MEETING_BUCKETS.map((b) => b.label)],
        rows: rows.map((r) => [r.label, r.total, ...MEETING_BUCKETS.map((b) => r[b.key])]),
      };
    },
  },
  {
    key: "reviews_due",
    render: reviewsDue,
    csv: async (tx, ctx) => {
      const r = await getReviewsDue(tx, ctx.scope, 1000);
      return { columns: ["Client", "RM", "Next review", "Overdue"], rows: r.rows.map((x) => [x.name, x.rmId ? ctx.userNames.get(x.rmId) ?? null : null, x.nextReview, x.overdue ? "Yes" : "No"]) };
    },
  },
  { key: "sip_rejection_status", render: sipRejections },
  { key: "insurance_business", render: insuranceBusiness },
  { key: "claims_period", render: claimsPeriod },
  { key: "task_summary", render: taskSummary },
];
