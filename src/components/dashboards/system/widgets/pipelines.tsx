/**
 * Opportunity pipeline and Service requests — the same kind of card as the
 * Lead pipeline: where the work stands, and a number that opens its list.
 *
 *   Opportunity pipeline  the Opportunities board's columns (lib/opportunities/
 *                         board-columns.ts) counted over the same clients
 *                         (lib/metrics getOpportunityPipeline)
 *   Service requests      the Service Requests page's tabs, past SLA, what was
 *                         raised and closed in the period, and the open ones by
 *                         request type (lib/metrics getServiceRequestBreakdown)
 */

import Link from "next/link";
import type { Tx } from "@/db/client";
import { getOpportunityPipeline, getServiceRequestBreakdown } from "@/lib/metrics";
import { BOARD_COLUMNS } from "@/lib/opportunities/board-columns";
import { formatCount, formatMoney, formatPercent, humanise } from "@/lib/format";
import type { WidgetCtx, WidgetImpl } from "../types";
import { opportunitiesHref, serviceRequestsHref } from "../links";
import { Drill } from "../Drill";

const OPEN_COLUMN_KEYS = BOARD_COLUMNS.filter((c) => c.key !== "won" && c.key !== "lost");

/* ─────────────────────── opportunity pipeline ─────────────────────── */

async function opportunityPipeline(tx: Tx, ctx: WidgetCtx) {
  const m = await getOpportunityPipeline(tx, ctx.scope, ctx.period);
  if (!m.open && !m.won && !m.lost) return { body: null };
  const max = Math.max(1, ...OPEN_COLUMN_KEYS.map((c) => m.byColumn[c.key]?.n ?? 0));
  const closed = { closed_from: ctx.period.from, closed_to: ctx.period.to };
  return {
    body: (
      <div className="space-y-3">
        <ul className="space-y-0.5">
          {OPEN_COLUMN_KEYS.map((col) => {
            const n = m.byColumn[col.key]?.n ?? 0;
            return (
              <li key={col.key}>
                <Link href={opportunitiesHref(ctx, { stage: col.key })} className="dash-row text-sm">
                  <span className="w-32 shrink-0 truncate text-foreground sm:w-36">{col.label}</span>
                  <span className="dash-bar flex-1" aria-hidden>
                    <span style={{ width: `${n ? Math.max(3, (n / max) * 100) : 0}%` }} />
                  </span>
                  <span className={`dash-count ${n === 0 ? "dash-count-zero" : ""}`}>{formatCount(n)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            <Drill href={opportunitiesHref(ctx)}>
              <span className="font-semibold tabular-nums">{formatCount(m.open)}</span> open
              {m.openValue ? ` · ${formatMoney(m.openValue)}` : ""}
            </Drill>
          </span>
          <span>
            <Drill href={opportunitiesHref(ctx, { status: "won", ...closed })}>
              <span className="font-semibold tabular-nums">{formatCount(m.won)}</span> won
            </Drill>
            {" · "}
            <Drill href={opportunitiesHref(ctx, { status: "lost", ...closed })}>
              <span className="font-semibold tabular-nums">{formatCount(m.lost)}</span> lost
            </Drill>
          </span>
          <span>Conversion <span className="font-semibold tabular-nums">{m.conversion == null ? "—" : formatPercent(m.conversion * 100, 0)}</span></span>
          {m.followUpOverdue > 0 && (
            <Link href={opportunitiesHref(ctx, { fu: "overdue" })} className="inline-flex min-h-6 items-center text-destructive hover:underline">
              {formatCount(m.followUpOverdue)} follow-up{m.followUpOverdue === 1 ? "" : "s"} overdue
            </Link>
          )}
          {m.noFollowUp > 0 && (
            <Link href={opportunitiesHref(ctx, { fu: "none" })} className="inline-flex min-h-6 items-center text-primary hover:underline">
              {formatCount(m.noFollowUp)} with no follow-up
            </Link>
          )}
        </div>
      </div>
    ),
    subtitle: `${formatCount(m.open)} open`,
    info:
      "Existing clients taking another product, by the step each has reached on the Opportunities board (a parked one sits in Later). " +
      "Won and lost count those closed in the period; conversion is won ÷ (won + lost). A follow-up is the opportunity's earliest open task.",
    href: opportunitiesHref(ctx),
    hrefLabel: "All opportunities",
  };
}

/* ─────────────────────── service requests ─────────────────────── */

function Tile({ label, value, href, alarm }: { label: string; value: number; href?: string; alarm?: boolean }) {
  const inner = (
    <>
      <div className={`text-xl font-semibold tabular-nums leading-tight tracking-tight ${alarm && value > 0 ? "text-destructive" : "text-foreground"}`}>
        {formatCount(value)}
      </div>
      <div className="mt-1 text-xs leading-snug text-muted-foreground">{label}</div>
    </>
  );
  return href ? <Link href={href} className="dash-tile">{inner}</Link> : <div className="dash-tile">{inner}</div>;
}

async function serviceRequests(tx: Tx, ctx: WidgetCtx) {
  const s = await getServiceRequestBreakdown(tx, ctx.scope, ctx.period);
  if (!s.open && !s.escalated && !s.waiting && !s.raised && !s.closed) return { body: null };
  const max = Math.max(1, ...s.byType.map((t) => t.n));
  return {
    body: (
      <div className="space-y-4">
        <div className="dash-stats" style={{ ["--cols-sm" as string]: 2, ["--cols-lg" as string]: 4 }}>
          <Tile label="Open" value={s.open} href={serviceRequestsHref(ctx, { tab: "open" })} />
          <Tile label="Escalated" value={s.escalated} href={serviceRequestsHref(ctx, { tab: "escalated" })} alarm />
          <Tile label="Waiting on client" value={s.waiting} href={serviceRequestsHref(ctx, { tab: "waiting" })} />
          <Tile label="Past SLA" value={s.pastSla} href={serviceRequestsHref(ctx, { breached: "1" })} alarm />
        </div>
        {s.byType.length > 0 && (
          <ul className="space-y-0.5">
            {s.byType.map((t) => (
              <li key={t.type}>
                <Link href={serviceRequestsHref(ctx, { srtype: t.type, status: "open,in_progress,escalated,waiting_customer" })} className="dash-row text-sm">
                  <span className="w-36 shrink-0 truncate text-foreground sm:w-44">{humanise(t.type)}</span>
                  <span className="dash-bar flex-1" aria-hidden>
                    <span style={{ width: `${Math.max(3, (t.n / max) * 100)}%` }} />
                  </span>
                  <span className="dash-count">{formatCount(t.n)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{formatCount(s.raised)}</span> raised ·{" "}
          <span className="font-semibold tabular-nums text-foreground">{formatCount(s.closed)}</span> closed in the period
        </p>
      </div>
    ),
    subtitle: `${formatCount(s.onUs + s.waiting)} not yet closed`,
    info:
      "Open, Escalated and Waiting on client are today's backlog, the same tabs as the Service Requests page; Past SLA is any not-closed request past its resolution time. " +
      "Raised and closed count the period. The types are the not-yet-closed requests.",
    href: serviceRequestsHref(ctx),
    hrefLabel: "All requests",
  };
}

export const pipelineWidgets: WidgetImpl[] = [
  {
    key: "opportunity_pipeline",
    render: opportunityPipeline,
    csv: async (tx, ctx) => {
      const m = await getOpportunityPipeline(tx, ctx.scope, ctx.period);
      return {
        columns: ["Step", "Open opportunities", "Expected value"],
        rows: OPEN_COLUMN_KEYS.map((c) => [c.label, m.byColumn[c.key]?.n ?? 0, m.byColumn[c.key]?.value ?? 0]),
      };
    },
  },
  {
    key: "service_requests",
    render: serviceRequests,
    csv: async (tx, ctx) => {
      const s = await getServiceRequestBreakdown(tx, ctx.scope, ctx.period);
      return {
        columns: ["Request type", "Not yet closed"],
        rows: s.byType.map((t) => [humanise(t.type), t.n]),
      };
    },
  },
];
