/**
 * Lead widgets. Stage names come from the Leads board's columns
 * (lib/leads/stages.ts via lib/metrics/leads.ts) — New, Contacted, Meeting
 * Scheduled, Meeting Done, Proposal Sent, Won, Lost — and conversion is Won
 * over the same leads, so it always matches the Won count beside it.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { LEAD_PIPELINE } from "@/lib/leads/stages";
import {
  getLeadStageCounts, getOpenLeads, leadWhere, leadStageKeySql, leadCreatedInSql, summariseLeadCounts,
  cleanIds, uuidList, LEAD_OPEN_KEYS, inOrder,
} from "@/lib/metrics";
import { formatCount, formatMoney, formatPercent, humanise } from "@/lib/format";
import type { WidgetCtx, WidgetImpl } from "../types";
import { leadsHref } from "../links";
import { stripRole } from "./business";

const pct = (x: number | null) => (x == null ? "—" : formatPercent(x * 100, 0));

/** A lead-scope slice: the lead widgets honour period, RM, branch and source only. */
function leadScope(ctx: WidgetCtx) {
  return { tenantId: ctx.tenantId, rmIds: ctx.scope.rmIds, branchIds: ctx.scope.branchIds, leadSources: ctx.scope.leadSources };
}

/* ─────────────────────────── lead pipeline ─────────────────────────── */

async function leadPipeline(tx: Tx, ctx: WidgetCtx) {
  const s = leadScope(ctx);
  const [c, open] = await inOrder(() => getLeadStageCounts(tx, s, ctx.period), () => getOpenLeads(tx, s));
  if (c.total === 0 && open.open === 0) return { body: null };
  if (c.total === 0) {
    // No leads created in the period: say so once instead of a column of zeros.
    return {
      body: (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">No leads created in this period.</p>
          <p>
            <span className="font-semibold tabular-nums">{formatCount(open.open)}</span> open leads in all
            {open.followUpDue > 0 && (
              <>
                {" · "}
                <Link href={leadsHref(ctx, { followup_due: "1" }, false)} className="text-primary hover:underline">
                  {formatCount(open.followUpDue)} need follow-up today
                </Link>
              </>
            )}
          </p>
        </div>
      ),
      href: leadsHref(ctx, {}, false),
      hrefLabel: "All leads",
    };
  }
  return {
    body: (
      <div className="space-y-3">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {LEAD_PIPELINE.map((col) => {
            const n = c.byStage[col.key] ?? 0;
            return (
              <li key={col.key} className="border-b border-border">
                <Link
                  href={leadsHref(ctx, { stage: col.key, ...(col.key === "won_lead" ? { include_won: "1" } : {}) })}
                  className="flex items-center justify-between gap-3 py-2 text-sm hover:underline"
                >
                  <span className="text-foreground">{col.label}</span>
                  <span className="font-semibold tabular-nums">{formatCount(n)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span><span className="font-semibold tabular-nums">{formatCount(c.open)}</span> open</span>
          <span>Conversion <span className="font-semibold tabular-nums">{pct(c.conversion)}</span></span>
          {open.followUpDue > 0 && (
            <Link href={leadsHref(ctx, { followup_due: "1" }, false)} className="text-primary hover:underline">
              {formatCount(open.followUpDue)} need follow-up today
            </Link>
          )}
        </div>
      </div>
    ),
    subtitle: `${formatCount(c.total)} leads created`,
    info: "Leads created in the period, by the stage they are in now. Conversion is Won ÷ all of them.",
    // Won includes converted and onboarding leads, which the list hides unless asked.
    href: leadsHref(ctx, { include_won: "1" }),
    hrefLabel: "All leads",
  };
}

/* ───────────────────────────── lead funnel ───────────────────────────── */

async function leadFunnel(tx: Tx, ctx: WidgetCtx) {
  const c = await getLeadStageCounts(tx, leadScope(ctx), ctx.period);
  if (c.total === 0) return { body: null };
  const max = Math.max(...LEAD_PIPELINE.map((col) => c.byStage[col.key] ?? 0), 1);
  return {
    body: (
      <div className="space-y-2">
        {LEAD_PIPELINE.map((col) => {
          const n = c.byStage[col.key] ?? 0;
          return (
            <Link
              key={col.key}
              href={leadsHref(ctx, { stage: col.key, ...(col.key === "won_lead" ? { include_won: "1" } : {}) })}
              className="grid grid-cols-12 items-center gap-2 text-sm group"
            >
              <span className="col-span-4 sm:col-span-3 truncate text-foreground group-hover:underline">{col.label}</span>
              <span className="col-span-6 sm:col-span-7 h-2.5 rounded-full bg-secondary overflow-hidden">
                <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="col-span-2 text-right tabular-nums">{formatCount(n)}</span>
            </Link>
          );
        })}
        <p className="pt-2 text-sm">
          Conversion <span className="font-semibold tabular-nums">{pct(c.conversion)}</span>
          <span className="text-muted-foreground"> · {formatCount(c.won)} won of {formatCount(c.total)}, {formatCount(c.lost)} lost</span>
        </p>
      </div>
    ),
    subtitle: `${formatCount(c.total)} leads created`,
    info: "Leads created in the period, by the stage they are in now. Conversion = Won ÷ (Won + Lost + open).",
    // Won includes converted and onboarding leads, which the list hides unless asked.
    href: leadsHref(ctx, { include_won: "1" }),
    hrefLabel: "All leads",
  };
}

/* ───────────────────────────── lead sources ───────────────────────────── */

async function sourceRows(tx: Tx, ctx: WidgetCtx) {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(NULLIF(l.source, ''), 'unknown') AS source, ${leadStageKeySql("l")} AS key, COUNT(*)::int AS n
      FROM leads l
     WHERE ${leadWhere(leadScope(ctx), "l")} AND ${leadCreatedInSql(ctx.period, "l")}
     GROUP BY 1, 2
  `)).rows as Array<{ source: string; key: string; n: number }>;
  const by = new Map<string, Array<{ key: string; n: number }>>();
  for (const r of rows) by.set(r.source, [...(by.get(r.source) ?? []), { key: r.key, n: Number(r.n) }]);
  return [...by.entries()]
    .map(([source, list]) => ({ source, ...summariseLeadCounts(list) }))
    .sort((a, b) => b.total - a.total);
}

async function leadSources(tx: Tx, ctx: WidgetCtx) {
  const rows = await sourceRows(tx, ctx);
  if (!rows.length) return { body: null };
  return {
    body: (
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-right">Leads</th>
            <th className="px-3 py-2 text-right">Won</th>
            <th className="px-3 py-2 text-right">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.source}>
              <td className="px-3 py-2">
                {r.source === "unknown" ? (
                  <span className="text-muted-foreground">Not recorded</span>
                ) : (
                  <Link href={leadsHref(ctx, { source: r.source, include_won: "1" })} className="hover:underline">
                    {humanise(r.source)}
                  </Link>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.total)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.won)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(r.conversion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
    subtitle: `${formatCount(rows.length)} sources`,
  };
}

/* ───────────────────────────── proposals ───────────────────────────── */

const PROPOSAL_GROUPS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "draft", label: "Draft", statuses: ["draft", "ready"] },
  { key: "sent", label: "Sent", statuses: ["sent", "viewed"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted", "partially_approved", "executed"] },
  { key: "lost", label: "Declined or expired", statuses: ["rejected", "expired"] },
];

async function proposalRows(tx: Tx, ctx: WidgetCtx) {
  const rms = cleanIds(ctx.scope.rmIds);
  const branches = cleanIds(ctx.scope.branchIds);
  return (await tx.execute(sql`
    SELECT p.status, COUNT(*)::int AS n, COALESCE(SUM(p.total_investment), 0) AS amount
      FROM proposals p
     WHERE p.tenant_id = ${ctx.tenantId}::uuid
       AND (p.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${ctx.period.from}::date AND ${ctx.period.to}::date
       ${rms.length ? sql`AND p.prepared_by_user_id IN (${uuidList(rms)})` : sql``}
       ${branches.length ? sql`AND p.prepared_by_user_id IN (SELECT id FROM users WHERE tenant_id = ${ctx.tenantId}::uuid AND branch_id IN (${uuidList(branches)}))` : sql``}
     GROUP BY p.status
  `)).rows as Array<{ status: string; n: number; amount: string }>;
}

async function proposalPipeline(tx: Tx, ctx: WidgetCtx) {
  const rows = await proposalRows(tx, ctx);
  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  if (!total) return { body: null };
  const groups = PROPOSAL_GROUPS.map((g) => {
    const hit = rows.filter((r) => g.statuses.includes(r.status));
    return { ...g, n: hit.reduce((a, r) => a + Number(r.n), 0), amount: hit.reduce((a, r) => a + Number(r.amount), 0) };
  });
  const decided = groups.find((g) => g.key === "accepted")!.n + groups.find((g) => g.key === "lost")!.n;
  const acceptance = decided ? groups.find((g) => g.key === "accepted")!.n / decided : null;
  return {
    body: (
      <div className="space-y-3">
        {/* Not links: the Proposals list cannot narrow to the period's preparers,
            and a link must open the rows it counts. */}
        <ul className="grid grid-cols-2 gap-2">
          {groups.map((g) => (
            <li key={g.key} className="rounded-lg border border-border px-3 py-2">
              <div className="text-xs text-muted-foreground">{g.label}</div>
              <div className="text-lg font-semibold tabular-nums">{formatCount(g.n)}</div>
              <div className="text-xs text-muted-foreground tabular-nums">{g.amount > 0 ? formatMoney(g.amount) : "—"}</div>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Accepted <span className="font-semibold tabular-nums">{pct(acceptance)}</span>
          <span className="text-muted-foreground"> of proposals decided</span>
        </p>
      </div>
    ),
    subtitle: `${formatCount(total)} proposals`,
    href: "/dashboard/proposals",
    hrefLabel: "All proposals",
  };
}

/* ───────────────────────────── leads by RM ───────────────────────────── */

async function ownerRows(tx: Tx, ctx: WidgetCtx) {
  const rows = (await tx.execute(sql`
    SELECT l.owner_id, ${leadStageKeySql("l")} AS key, COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE l.next_follow_up_at IS NOT NULL
             AND (l.next_follow_up_at AT TIME ZONE 'Asia/Kolkata')::date <= (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS due
      FROM leads l
     WHERE ${leadWhere(leadScope(ctx), "l")} AND ${leadCreatedInSql(ctx.period, "l")}
     GROUP BY 1, 2
  `)).rows as Array<{ owner_id: string | null; key: string; n: number; due: number }>;
  const by = new Map<string | null, { list: Array<{ key: string; n: number }>; due: number }>();
  for (const r of rows) {
    const e = by.get(r.owner_id) ?? { list: [], due: 0 };
    e.list.push({ key: r.key, n: Number(r.n) });
    if ((LEAD_OPEN_KEYS as readonly string[]).includes(r.key)) e.due += Number(r.due);
    by.set(r.owner_id, e);
  }
  return [...by.entries()]
    .map(([owner, e]) => ({
      owner,
      name: owner ? stripRole(ctx.userNames.get(owner) ?? "—") : "Unassigned",
      due: e.due,
      ...summariseLeadCounts(e.list),
    }))
    .sort((a, b) => b.total - a.total);
}

async function leadOwners(tx: Tx, ctx: WidgetCtx) {
  const rows = await ownerRows(tx, ctx);
  if (!rows.length) return { body: null };
  const td = "px-3 py-2 text-right tabular-nums";
  return {
    body: (
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">RM</th>
            <th className="px-3 py-2 text-right">Leads</th>
            <th className="px-3 py-2 text-right">Open</th>
            <th className="px-3 py-2 text-right">Won</th>
            <th className="px-3 py-2 text-right">Lost</th>
            <th className="px-3 py-2 text-right">Conversion</th>
            <th className="px-3 py-2 text-right">Follow-ups due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.owner ?? "none"}>
              <td className="px-3 py-2 font-medium">
                {r.owner ? <Link href={leadsHref(ctx, { owner: r.owner, include_won: "1" })} className="hover:underline">{r.name}</Link> : <span className="text-muted-foreground">{r.name}</span>}
              </td>
              <td className={td}>{formatCount(r.total)}</td>
              <td className={td}>{formatCount(r.open)}</td>
              <td className={td}>{formatCount(r.won)}</td>
              <td className={td}>{formatCount(r.lost)}</td>
              <td className={td}>{pct(r.conversion)}</td>
              <td className={`${td} ${r.due ? "text-rose-700 font-medium" : ""}`}>{formatCount(r.due)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
    subtitle: `${formatCount(rows.length)} people`,
  };
}

export const leadWidgets: WidgetImpl[] = [
  {
    key: "lead_pipeline",
    render: leadPipeline,
    csv: async (tx, ctx) => {
      const c = await getLeadStageCounts(tx, leadScope(ctx), ctx.period);
      return { columns: ["Stage", "Leads"], rows: LEAD_PIPELINE.map((col) => [col.label, c.byStage[col.key] ?? 0]) };
    },
  },
  {
    key: "lead_funnel",
    render: leadFunnel,
    csv: async (tx, ctx) => {
      const c = await getLeadStageCounts(tx, leadScope(ctx), ctx.period);
      return { columns: ["Stage", "Leads"], rows: LEAD_PIPELINE.map((col) => [col.label, c.byStage[col.key] ?? 0]) };
    },
  },
  {
    key: "lead_sources",
    render: leadSources,
    csv: async (tx, ctx) => {
      const rows = await sourceRows(tx, ctx);
      return { columns: ["Source", "Leads", "Won", "Lost", "Conversion %"], rows: rows.map((r) => [r.source, r.total, r.won, r.lost, r.conversion == null ? null : Math.round(r.conversion * 1000) / 10]) };
    },
  },
  {
    key: "proposal_pipeline",
    render: proposalPipeline,
    csv: async (tx, ctx) => {
      const rows = await proposalRows(tx, ctx);
      return { columns: ["Status", "Proposals", "Investment proposed"], rows: rows.map((r) => [humanise(r.status), Number(r.n), Number(r.amount)]) };
    },
  },
  {
    key: "lead_owners",
    render: leadOwners,
    csv: async (tx, ctx) => {
      const rows = await ownerRows(tx, ctx);
      return { columns: ["RM", "Leads", "Open", "Won", "Lost", "Conversion %", "Follow-ups due"], rows: rows.map((r) => [r.name, r.total, r.open, r.won, r.lost, r.conversion == null ? null : Math.round(r.conversion * 1000) / 10, r.due]) };
    },
  },
];
