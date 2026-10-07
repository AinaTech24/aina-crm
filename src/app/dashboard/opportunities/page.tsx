/**
 * Opportunities — existing clients who want another product, as a module of
 * their own. The client page's Opportunities panel shows one client's; this
 * shows every one the viewer can see (access follows the client), on a board
 * by journey step or as a list, with the follow-ups that are due.
 *
 * Data: lib/opportunities/board.ts. The journey itself — stages, gates, what
 * is skipped, follow-up tasks — is lib/opportunities/journey.ts, and each card
 * opens /dashboard/opportunities/[id], where it runs.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { AlarmClock, CalendarClock, CalendarX2, Crosshair, Hourglass, LayoutGrid, List, Trophy } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireInvestorView } from "@/lib/investors/access";
import { canWorkOpportunities } from "@/lib/opportunities/access";
import { BOARD_COLUMNS, boardColumns, loadBoardKpis, loadBoardRows, type BoardFilters } from "@/lib/opportunities/board";
import { OPPORTUNITY_PRODUCTS } from "@/lib/opportunities/products";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { Kpi } from "@/components/dashboards/DashboardShared";
import { EmptyState } from "@/components/common/EmptyState";
import { OpportunityBoard } from "@/components/opportunities/OpportunityBoard";
import { OpportunitiesTable } from "@/components/opportunities/OpportunitiesTable";
import { NewOpportunityButton } from "@/components/opportunities/NewOpportunityButton";
import { dateRangeFilter } from "@/lib/filters/date-range";
import { formatCount, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const csv = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  requireInvestorView(session);
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "board";
  const filters: BoardFilters = {
    q: sp.q,
    stage: csv(sp.stage),
    product: csv(sp.product),
    owner: csv(sp.owner),
    status: sp.status,
    fu: sp.fu,
    mine: sp.mine === "1",
    createdFrom: sp.created_from,
    createdTo: sp.created_to,
  };
  const canWork = canWorkOpportunities(session);

  const data = await withTenant(session.tenantId, async (tx) => {
    const [rows, kpis] = await Promise.all([loadBoardRows(tx, session, filters), loadBoardKpis(tx, session)]);
    const owners = (await tx.execute(sql`
      SELECT DISTINCT u.id, u.name FROM client_opportunities o JOIN users u ON u.id = o.owner_id
       WHERE o.tenant_id = ${session.tenantId}::uuid ORDER BY u.name
    `)).rows as Array<{ id: string; name: string }>;
    return { rows, kpis, owners };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  const { rows, kpis } = data;
  const hasAny = kpis.open > 0 || kpis.wonThisMonth > 0 || rows.length > 0 || Object.keys(sp).some((k) => k !== "view");

  // Links keep every other param; the view toggle and the tiles change one.
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    const s = p.toString();
    return `/dashboard/opportunities${s ? `?${s}` : ""}`;
  };
  const tile = (patch: Record<string, string>) => `/dashboard/opportunities?${new URLSearchParams({ ...(view === "list" ? { view } : {}), ...patch })}`;

  return (
    <div className="space-y-5">
      <PageHeaderCard
        title={<><Crosshair className="size-6 text-muted-foreground" aria-hidden /> Opportunities</>}
        actions={canWork ? <NewOpportunityButton /> : undefined}
      />

      {!hasAny ? (
        <EmptyState
          icon={Crosshair}
          title="No opportunities yet"
          description="When an existing client asks about another product — insurance, a new SIP, an FD — start an opportunity. It walks the client through suitability, proposal and processing, skipping what is already on file, and puts every follow-up on the owner's list."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <Kpi icon={Crosshair} label="Open" value={formatCount(kpis.open)}
              sub={kpis.openValue > 0 ? `${formatMoney(kpis.openValue)} expected` : undefined} href={tile({})} />
            <Kpi icon={AlarmClock} accent="amber" label="Follow-ups overdue" value={formatCount(kpis.overdue)} href={tile({ fu: "overdue" })} />
            <Kpi icon={CalendarClock} accent="violet" label="Follow up today" value={formatCount(kpis.dueToday)} href={tile({ fu: "today" })} />
            <Kpi icon={CalendarX2} accent="amber" label="No follow-up set" value={formatCount(kpis.noFollowUp)} href={tile({ fu: "none" })} />
            <Kpi icon={Hourglass} accent="violet" label="Later" value={formatCount(kpis.later)}
              sub={[kpis.laterNext30 ? `${formatCount(kpis.laterNext30)} back within 30 days` : null, kpis.laterValue > 0 ? formatMoney(kpis.laterValue) : null].filter(Boolean).join(" · ") || undefined}
              href={tile({ stage: "later" })} />
            <Kpi icon={Trophy} accent="emerald" label="Won this month" value={formatCount(kpis.wonThisMonth)}
              sub={kpis.wonValueThisMonth > 0 ? formatMoney(kpis.wonValueThisMonth) : undefined} href={tile({ status: "won" })} />
          </div>

          <div className="card-surface relative z-30 p-2.5">
            <CompactFilterBar
              bare
              totalCount={rows.length}
              searchPlaceholder="Search client…"
              filters={[
                { type: "flags", label: "Show", options: [{ key: "mine", label: "My opportunities" }] },
                {
                  type: "select", key: "status", label: "Status", allLabel: "Open",
                  options: [{ value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All" }],
                },
                {
                  type: "multi", key: "stage", label: "Step",
                  options: BOARD_COLUMNS.filter((c) => c.key !== "won" && c.key !== "lost").map((c) => ({ value: c.key, label: c.label })),
                },
                { type: "multi", key: "product", label: "Product", options: OPPORTUNITY_PRODUCTS.map((p) => ({ value: p.key, label: p.label })) },
                ...(data.owners.length
                  ? [{ type: "multi" as const, key: "owner", label: "Owner", options: data.owners.map((u) => ({ value: u.id, label: u.name.replace(/\s*\([^)]*\)\s*$/, "") })) }]
                  : []),
                {
                  type: "select", key: "fu", label: "Next follow-up", allLabel: "Any",
                  options: [
                    { value: "overdue", label: "Overdue" }, { value: "today", label: "Today" },
                    { value: "week", label: "In the next 7 days" }, { value: "none", label: "Not set" },
                  ],
                },
                dateRangeFilter("created", "Opened"),
              ]}
              rightSlot={
                <nav className="dash-seg" aria-label="View">
                  <Link href={href({ view: null })} aria-current={view === "board" ? "page" : undefined}>
                    <LayoutGrid className="size-3.5" aria-hidden /> Board
                  </Link>
                  <Link href={href({ view: "list" })} aria-current={view === "list" ? "page" : undefined}>
                    <List className="size-3.5" aria-hidden /> List
                  </Link>
                </nav>
              }
            />
          </div>

          {view === "board"
            ? <OpportunityBoard columns={boardColumns(filters.status)} rows={rows} />
            : <section className="card-surface p-2 sm:p-3"><OpportunitiesTable rows={rows} /></section>}
          {rows.length >= 500 && (
            <p className="text-xs text-muted-foreground">Showing the first 500 — narrow the filters to see the rest.</p>
          )}
        </>
      )}
    </div>
  );
}
