/**
 * Insurance and compliance widgets (on the Owner Dashboard and the
 * Operations Dashboard's Compliance tab). Insurance figures use the
 * Insurance module's vocabulary (lib/insurance/book.ts via
 * lib/metrics/insurance.ts); compliance counts use the Risk Profiles page's
 * buckets, the Clients list's gap filters and the Complaint Register.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import type { Tx } from "@/db/client";
import {
  getInsuranceInForce, getInsurancePremium, getRenewalsDue, getExpiryPipeline, getComplianceGaps,
  getComplaintAgeing, POLICY_FROM, policyWhere, clientRecordWhere, cleanIds, inOrder,
} from "@/lib/metrics";
import { CLAIM_OPEN, CLAIM_STATUS_LABEL, GROUP_LABEL, STATUS_IN_FORCE, groupSql, inList, policyTypeLabel } from "@/lib/insurance/book";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { indiaToday } from "@/lib/dashboards/system/period";
import type { WidgetCtx, WidgetImpl } from "../types";
import { qs, sipsHref } from "../links";
import { Drill } from "../Drill";

const insScope = (ctx: WidgetCtx) => ({ tenantId: ctx.tenantId, rmIds: ctx.scope.rmIds, branchIds: ctx.scope.branchIds });

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

function Stat({ label, value, href, alarm = false, sub }: { label: string; value: string; href?: string; alarm?: boolean; sub?: string }) {
  const inner = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums tracking-tight ${alarm ? "text-rose-700" : "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="dash-tile">{inner}</Link>
  ) : (
    <div className="dash-tile">{inner}</div>
  );
}

/* ─────────────────────────── premium book ─────────────────────────── */

/** Policies in force by product group — the "policies by type" view (D3). */
async function inForceByGroup(tx: Tx, ctx: WidgetCtx) {
  return (await tx.execute(sql`
    SELECT ${groupSql("p")} AS grp, COUNT(*)::int AS n, COALESCE(SUM(p.annual_premium), 0) AS premium
      FROM ${POLICY_FROM}
     WHERE ${policyWhere(insScope(ctx))} AND p.status IN (${inList(STATUS_IN_FORCE)})
     GROUP BY 1 ORDER BY 3 DESC
  `)).rows as Array<{ grp: string; n: number; premium: string }>;
}

async function insuranceBook(tx: Tx, ctx: WidgetCtx) {
  const s = insScope(ctx);
  const [force, booked, groups] = await inOrder(
    () => getInsuranceInForce(tx, s), () => getInsurancePremium(tx, s, ctx.period, ctx.period.prev), () => inForceByGroup(tx, ctx),
  );
  if (!booked.hasData) return { body: null };
  const owner = { owner: ctx.scope.rmIds, branch: ctx.scope.branchIds };
  return {
    body: (
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Policies in force" value={formatCount(force.policies)} href={`/dashboard/insurance${qs({ status: STATUS_IN_FORCE.join(","), ...owner })}`} />
        <Stat label="Annual premium in force" value={formatMoney(force.annualPremium)} />
        <Stat
          label="Premium booked"
          value={formatMoney(booked.premium)}
          sub={`${formatCount(booked.policies)} policies`}
          href={`/dashboard/insurance${qs({ booked_from: ctx.period.from, booked_to: ctx.period.to, ...owner })}`}
        />
        <Stat label="New · Renewal" value={`${formatMoney(booked.newPremium)} · ${formatMoney(booked.renewalPremium)}`} />
        {groups.length > 0 && (
          <ul className="col-span-2 divide-y divide-border text-sm pt-1">
            {groups.map((g) => (
              <li key={g.grp} className="flex items-center gap-3 py-1.5">
                <span className="flex-1 truncate">{GROUP_LABEL[g.grp] ?? "Unclassified"}</span>
                <span className="tabular-nums text-muted-foreground">{formatCount(Number(g.n))}</span>
                <span className="w-24 text-right tabular-nums">{formatMoney(Number(g.premium))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
    subtitle: ctx.period.label,
    href: "/dashboard/insurance",
    hrefLabel: "Insurance",
  };
}

/* ─────────────────────────── renewals due ─────────────────────────── */

async function renewalRows(tx: Tx, ctx: WidgetCtx, limit: number) {
  return (await tx.execute(sql`
    SELECT p.id, p.policy_type, p.next_premium_due_date AS due, p.annual_premium, i.name AS client
      FROM ${POLICY_FROM}
     WHERE ${policyWhere(insScope(ctx))} AND p.status IN (${inList(STATUS_IN_FORCE)})
       AND COALESCE(p.premium_frequency, 'annual') <> 'single'
       AND p.next_premium_due_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date + 90
     ORDER BY p.next_premium_due_date ASC
     LIMIT ${limit}
  `)).rows as Array<{ id: string; policy_type: string | null; due: string; annual_premium: string | null; client: string | null }>;
}

async function renewalsDue(tx: Tx, ctx: WidgetCtx) {
  const s = insScope(ctx);
  const [d30, d60, d90] = await inOrder(() => getRenewalsDue(tx, s, 30), () => getRenewalsDue(tx, s, 60), () => getRenewalsDue(tx, s, 90));
  if (!d90.due && !d90.overdue) return { body: null };
  const today = indiaToday();
  const link = (from: string, to: string) =>
    `/dashboard/insurance${qs({ due_from: from, due_to: to, owner: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`;
  const rows = await renewalRows(tx, ctx, 6);
  return {
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Overdue" value={formatCount(d30.overdue)} alarm={d30.overdue > 0} href={link("2000-01-01", addDays(today, -1))} />
          <Stat label="Next 30 days" value={formatCount(d30.due)} href={link(today, addDays(today, 30))} />
          <Stat label="31–60 days" value={formatCount(d60.due - d30.due)} href={link(addDays(today, 31), addDays(today, 60))} />
          <Stat label="61–90 days" value={formatCount(d90.due - d60.due)} href={link(addDays(today, 61), addDays(today, 90))} />
        </div>
        {rows.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-3 min-w-0">
                <Link href={`/dashboard/insurance/${r.id}`} className="flex-1 min-w-0 truncate hover:underline">
                  {r.client ?? "—"} <span className="text-muted-foreground">· {policyTypeLabel(r.policy_type)}</span>
                </Link>
                <span className="tabular-nums whitespace-nowrap">{formatMoney(Number(r.annual_premium ?? 0))}</span>
                <span className={`text-xs whitespace-nowrap ${r.due < today ? "text-rose-700 font-medium" : "text-muted-foreground"}`}>{formatDate(r.due, "dayMonth")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
    href: "/dashboard/insurance/renewals",
    hrefLabel: "All renewals",
  };
}

/* ─────────────────────────────── claims ─────────────────────────────── */

const AGE = [
  { key: "a15", label: "0–15 days", lo: 0, hi: 15 },
  { key: "a30", label: "16–30 days", lo: 16, hi: 30 },
  { key: "a60", label: "31–60 days", lo: 31, hi: 60 },
  { key: "a61", label: "Over 60 days", lo: 61, hi: 100000 },
];

async function claimRows(tx: Tx, ctx: WidgetCtx) {
  const restricted = cleanIds(ctx.scope.rmIds).length + cleanIds(ctx.scope.branchIds).length > 0;
  const age = sql`((now() AT TIME ZONE 'Asia/Kolkata')::date - COALESCE(c.intimation_date, (c.created_at AT TIME ZONE 'Asia/Kolkata')::date))`;
  return (await tx.execute(sql`
    SELECT COALESCE(c.claim_status, 'empty') AS status,
           ${sql.join(AGE.map((a) => sql`COUNT(*) FILTER (WHERE ${age} BETWEEN ${a.lo} AND ${a.hi})::int AS ${sql.raw(a.key)}`), sql`, `)},
           COUNT(*)::int AS total, COALESCE(SUM(c.claimed_amount), 0) AS claimed
      FROM insurance_claims c LEFT JOIN investors i ON i.id = c.investor_id
     WHERE c.tenant_id = ${ctx.tenantId}::uuid AND COALESCE(c.claim_status, 'empty') IN (${inList(CLAIM_OPEN)})
       ${restricted ? sql`AND ${clientRecordWhere(insScope(ctx), "i")}` : sql``}
     GROUP BY 1 ORDER BY total DESC
  `)).rows as Array<Record<string, string | number>>;
}

async function claimsStatus(tx: Tx, ctx: WidgetCtx) {
  const rows = await claimRows(tx, ctx);
  if (!rows.length) return { body: null };
  const total = rows.reduce((a, r) => a + Number(r.total), 0);
  const claimed = rows.reduce((a, r) => a + Number(r.claimed), 0);
  const td = "px-3 py-2 text-right tabular-nums";
  return {
    body: (
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">Status</th>
            {AGE.map((a) => <th key={a.key} className="px-3 py-2 text-right">{a.label}</th>)}
            <th className="px-3 py-2 text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.status)}>
              <td className="px-3 py-2">
                <Link href={`/dashboard/insurance-claims${qs({ status: String(r.status), rm: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`} className="hover:underline">
                  {CLAIM_STATUS_LABEL[String(r.status)] ?? "Status not set"}
                </Link>
              </td>
              {AGE.map((a) => (
                <td key={a.key} className={`${td} ${a.lo > 30 && Number(r[a.key]) > 0 ? "text-rose-700 font-medium" : ""}`}>
                  {Number(r[a.key]) ? formatCount(Number(r[a.key])) : "·"}
                </td>
              ))}
              <td className={`${td} font-medium`}>{formatCount(Number(r.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
    subtitle: `${formatCount(total)} open · ${formatMoney(claimed)} claimed`,
    href: `/dashboard/insurance-claims${qs({ rm: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`,
    hrefLabel: "All claims",
  };
}

/* ─────────────────────────── compliance gaps ─────────────────────────── */

async function complianceGaps(tx: Tx, ctx: WidgetCtx) {
  const gaps = (await getComplianceGaps(tx, ctx.scope)).filter((g) => g.count > 0);
  if (!gaps.length) return { body: null };
  return {
    body: (
      <ul className="space-y-0.5">
        {gaps.map((g) => (
          <li key={g.key}>
            <Link href={g.href} className="dash-row group">
              <span className="dash-count">{formatCount(g.count)}</span>
              <span className="flex-1 text-sm font-medium text-foreground">{g.label}</span>
              <ArrowRight className="size-4 text-muted-foreground/60 transition-colors group-hover:text-primary" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    ),
    info: "Active clients. Risk-profile buckets are the Risk Profiles page's tabs.",
  };
}

/* ─────────────────────────────── expiries ─────────────────────────────── */

async function expiryPipeline(tx: Tx, ctx: WidgetCtx) {
  const rows = (await getExpiryPipeline(tx, ctx.scope)).filter((r) => r.d30 + r.d60 + r.d90 > 0);
  if (!rows.length) return { body: null };
  const td = "px-3 py-2 text-right tabular-nums";
  // A bucket opens its rows where a list can show exactly them: SIP end dates
  // on the SIP list (end_from / end_to). The other lists have no matching
  // date filter, so their buckets stay plain and the row's own link stands.
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10); // India date
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const bucket = (key: string, from: number, to: number) =>
    key === "sip_end" ? sipsHref(ctx, { end_from: day(from), end_to: day(to) }) : null;
  return {
    body: (
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">Expiring</th>
            <th className="px-3 py-2 text-right">Next 30 days</th>
            <th className="px-3 py-2 text-right">31–60 days</th>
            <th className="px-3 py-2 text-right">61–90 days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-3 py-2">
                <Link href={r.href} className="font-medium hover:underline">{r.label}</Link>
                <div className="text-xs text-muted-foreground">{r.consequence}</div>
              </td>
              <td className={td}>{r.d30 ? <Drill href={bucket(r.key, 0, 30)}>{formatCount(r.d30)}</Drill> : "·"}</td>
              <td className={td}>{r.d60 ? <Drill href={bucket(r.key, 31, 60)}>{formatCount(r.d60)}</Drill> : "·"}</td>
              <td className={td}>{r.d90 ? <Drill href={bucket(r.key, 61, 90)}>{formatCount(r.d90)}</Drill> : "·"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  };
}

/* ─────────────────────────────── complaints ─────────────────────────────── */

async function complaints(tx: Tx, ctx: WidgetCtx) {
  const a = await getComplaintAgeing(tx, ctx.scope);
  if (!a.total) return { body: null };
  // The total opens the register on the same complaints; the age tiles have
  // no list of their own there, so they are not links (a link must open the
  // rows it counts).
  const href = `/dashboard/complaints${qs({ status: "open,in_progress,escalated", rm: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`;
  return {
    body: (
      <div className="grid grid-cols-2 gap-2">
        <Stat label="0–7 days" value={formatCount(a.d7)} />
        <Stat label="8–14 days" value={formatCount(a.d14)} />
        <Stat label="15–21 days" value={formatCount(a.d21)} />
        <Stat label="Past 21 days" value={formatCount(a.over21)} alarm={a.over21 > 0} />
      </div>
    ),
    subtitle: `${formatCount(a.total)} open`,
    info: "SEBI expects a complaint resolved within 21 days of receipt.",
    href,
    hrefLabel: "Complaint register",
  };
}

export const insuranceComplianceWidgets: WidgetImpl[] = [
  { key: "insurance_book", render: insuranceBook },
  {
    key: "renewals_due",
    render: renewalsDue,
    csv: async (tx, ctx) => {
      const rows = await renewalRows(tx, ctx, 2000);
      return { columns: ["Client", "Policy", "Premium due", "Annual premium"], rows: rows.map((r) => [r.client, policyTypeLabel(r.policy_type), formatDate(r.due), Number(r.annual_premium ?? 0)]) };
    },
  },
  {
    key: "claims_status",
    render: claimsStatus,
    csv: async (tx, ctx) => {
      const rows = await claimRows(tx, ctx);
      return {
        columns: ["Status", ...AGE.map((a) => a.label), "Open", "Claimed"],
        rows: rows.map((r) => [CLAIM_STATUS_LABEL[String(r.status)] ?? "Status not set", ...AGE.map((a) => Number(r[a.key])), Number(r.total), Number(r.claimed)]),
      };
    },
  },
  {
    key: "compliance_gaps",
    render: complianceGaps,
    csv: async (tx, ctx) => {
      const gaps = await getComplianceGaps(tx, ctx.scope);
      return { columns: ["Gap", "Clients"], rows: gaps.map((g) => [g.label, g.count]) };
    },
  },
  {
    key: "expiry_pipeline",
    render: expiryPipeline,
    csv: async (tx, ctx) => {
      const rows = await getExpiryPipeline(tx, ctx.scope);
      return { columns: ["Expiring", "Next 30 days", "31–60 days", "61–90 days"], rows: rows.map((r) => [r.label, r.d30, r.d60, r.d90]) };
    },
  },
  { key: "complaints", render: complaints },
];
