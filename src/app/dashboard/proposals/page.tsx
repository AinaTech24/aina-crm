import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Plus,
  FileSignature,
  FileText,
  Send,
  CheckCircle2,
  IndianRupee,
  Clock,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { InlineEmpty } from "@/components/common/EmptyState";
import { formatINR } from "@/lib/utils";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { Pager } from "@/components/common/Pager";
import { ProposalsBulkTable } from "@/components/proposals/ProposalsBulkTable";
import { ProposalsBoard, boardTotals, type BoardRow } from "@/components/proposals/ProposalsBoard";

const PROPOSALS_COLUMNS = [
  { key: "number", label: "Proposal number", required: true },
  { key: "title", label: "Title", defaultHidden: true },
  { key: "recipient", label: "Client", required: true },
  { key: "type", label: "Type" },
  { key: "invest", label: "Invest amount" },
  { key: "corpus", label: "Projected corpus" },
  { key: "status", label: "Status" },
  { key: "valid_till", label: "Valid till" },
  { key: "prepared_by", label: "Prepared by" },
  { key: "created", label: "Created", defaultHidden: true },
  { key: "actions", label: "Actions", required: true },
];
/** v2: Prepared by shown, Title and Created hidden by default. */
const COLUMNS_VERSION = 2;

/**
 * Past its valid-till date, on the IST calendar: a proposal valid till the
 * 25th is still valid all of the 25th.
 */
const PAST = sql`(p.valid_until IS NOT NULL AND (p.valid_until AT TIME ZONE 'Asia/Kolkata')::date < (now() AT TIME ZONE 'Asia/Kolkata')::date)`;

/**
 * Status tabs. Together they cover every status a CURRENT proposal can have,
 * so no proposal is in none of them. A draft or sent proposal past its
 * valid-till date is Expired whatever its stored status says: the nightly
 * expiry job flips only sent / viewed / ready, so a lapsed draft used to sit
 * under Draft for good.
 *
 * A client's change request is still open work for the RM, so it sits under
 * Sent. A superseded proposal is an older VERSION of one that is listed — it
 * is reached from that proposal's version history, and is left out of every
 * tab and count so a revised proposal isn't counted twice (CURRENT below).
 */
const CURRENT = sql`p.status <> 'superseded'`;
const TABS = [
  { key: "draft", label: "Draft", where: sql`(p.status IN ('draft', 'ready') AND NOT ${PAST})` },
  { key: "sent", label: "Sent", where: sql`(p.status IN ('sent', 'viewed', 'changes_requested') AND NOT ${PAST})` },
  { key: "accepted", label: "Accepted", where: sql`p.status IN ('accepted', 'partially_approved', 'executed')` },
  { key: "rejected", label: "Rejected", where: sql`p.status = 'rejected'` },
  { key: "expired", label: "Expired", where: sql`(p.status = 'expired' OR (p.status IN ('draft', 'ready', 'sent', 'viewed', 'changes_requested') AND ${PAST}))` },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export const dynamic = "force-dynamic";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  // status — comma-separated: the dashboard's Proposal pipeline links each
  // group with its statuses (draft,ready · sent,viewed · accepted,… · rejected,expired).
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  // A tab picks the statuses, unless an explicit ?status= (an old link or a
  // saved view) already did — then no tab is highlighted.
  const tab: TabKey | null = statusFilter.length
    ? null
    : (TABS.find((t) => t.key === sp.tab)?.key ?? "draft");
  // Board: the whole pipeline at once, so it ignores the tab (not ?status=).
  const view: "list" | "board" = sp.view === "board" ? "board" : "list";
  const canRenew = can(session.roles, "proposal.write", session.permissions);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const riskFilter = (sp.risk ?? "").split(",").filter(Boolean);
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  // Sort — by created date or investment amount, ascending or descending.
  const sortKey = (["created_desc", "created_asc", "invest_desc", "invest_asc"] as const).includes(
    (sp.sort ?? "") as any
  )
    ? (sp.sort as "created_desc" | "created_asc" | "invest_desc" | "invest_asc")
    : "created_desc";
  const orderSql =
    sortKey === "created_asc" ? sql`p.created_at ASC`
      : sortKey === "invest_desc" ? sql`p.total_investment::numeric DESC NULLS LAST`
        : sortKey === "invest_asc" ? sql`p.total_investment::numeric ASC NULLS LAST`
          : sql`p.created_at DESC`;

  const data = await withTenant(session.tenantId, async (tx) => {
    const filters: any[] = [sql`p.tenant_id = ${session.tenantId}::uuid`, CURRENT];
    if (q) {
      filters.push(
        sql`(p.proposal_number ILIKE ${`%${q}%`} OR p.title ILIKE ${`%${q}%`} OR p.recipient_name ILIKE ${`%${q}%`})`
      );
    }
    if (typeFilter.length) {
      filters.push(
        sql`p.type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (riskFilter.length) {
      filters.push(
        sql`p.risk_rating IN (${sql.join(riskFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    const dr = dateRangeCond(sp, "created", "p.created_at");
    if (dr) filters.push(dr);
    // Tab counts are taken over every other filter, before the tab narrows.
    const countWhere = sql` WHERE ${sql.join(filters, sql` AND `)}`;
    if (statusFilter.length) {
      filters.push(
        sql`p.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    // The board shows every column, so it shares the filters but not the tab.
    const boardWhere = sql` WHERE ${sql.join(filters, sql` AND `)} AND p.status NOT IN ('rejected', 'expired')`;
    if (tab) filters.push(TABS.find((t) => t.key === tab)!.where);
    const whereSql = sql` WHERE ${sql.join(filters, sql` AND `)}`;

    const board =
      view === "board"
        ? ((
            await tx.execute(sql`
              SELECT p.id, p.proposal_number, p.version, p.recipient_name, p.status, p.products,
                     p.sent_at, p.viewed_at, p.accepted_items, p.executed_amount::numeric AS executed_amount,
                     u.name AS prepared_by
                FROM proposals p
                LEFT JOIN users u ON u.id = p.prepared_by_user_id
                ${boardWhere}
               ORDER BY COALESCE(p.sent_at, p.created_at) DESC
               LIMIT 400
            `)
          ).rows as BoardRow[])
        : [];

    const rows = await tx.execute(sql`
      SELECT p.id, p.proposal_number, p.title, p.type, p.status,
             p.recipient_name, p.recipient_type, p.investor_id, p.lead_id,
             p.total_investment::numeric AS total_investment,
             p.expected_corpus::numeric AS expected_corpus,
             p.risk_rating, p.valid_until, p.sent_at, p.viewed_at, p.accepted_at,
             p.created_at,
             (p.status IN ('draft', 'ready', 'sent', 'viewed') AND ${PAST}) AS lapsed,
             (p.valid_until AT TIME ZONE 'Asia/Kolkata')::date::text AS valid_date,
             -- The moment it stops being valid: midnight IST after its last valid day.
             ((p.valid_until AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS lapses_at,
             u.name AS prepared_by,
             i.avatar_url AS investor_avatar_url,
             l.avatar_url AS lead_avatar_url
      FROM proposals p
      LEFT JOIN users u ON u.id = p.prepared_by_user_id
      LEFT JOIN investors i ON i.id = p.investor_id
      LEFT JOIN leads l ON l.id = p.lead_id
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    // True count of the filtered set (drives the pager + accurate header count).
    const filtered = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM proposals p ${whereSql}
    `);
    const tabCounts = await tx.execute(sql`
      SELECT ${sql.join(TABS.map((t) => sql`COUNT(*) FILTER (WHERE ${t.where})::int AS ${sql.identifier(t.key)}`), sql`, `)}
      FROM proposals p ${countWhere}
    `);
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('sent','viewed'))::int AS pending,
        COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_total,
        COUNT(*) FILTER (
          WHERE status = 'accepted' AND accepted_at >= date_trunc('month', now())
        )::int AS accepted_mtd,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'accepted')
          / NULLIF(COUNT(*) FILTER (WHERE status IN ('sent','viewed','accepted','rejected')), 0),
        1) AS conv_pct,
        COALESCE(
          SUM(total_investment::numeric) FILTER (
            WHERE status IN ('sent','viewed')
          ), 0
        )::numeric AS outstanding_value
      FROM proposals
    `);
    return {
      board,
      rows: rows.rows as any[],
      s: stats.rows[0] as any,
      filteredTotal: Number((filtered.rows[0] as any)?.c ?? 0),
      counts: (tabCounts.rows[0] ?? {}) as Record<string, number>,
    };
  });

  // A tab keeps every other filter; it replaces status and restarts the page.
  const tabHref = (key: TabKey) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "tab" && k !== "status" && k !== "page") p.set(k, v);
    if (key !== "draft") p.set("tab", key);
    const qs = p.toString();
    return qs ? `/dashboard/proposals?${qs}` : "/dashboard/proposals";
  };
  const anyProposal = TABS.some((t) => Number(data.counts[t.key] ?? 0) > 0);
  const hasFilters = !!q || statusFilter.length > 0 || typeFilter.length > 0 || riskFilter.length > 0
    || !!dateRangeCond(sp, "created", "p.created_at");
  const tabLabel = tab ? TABS.find((t) => t.key === tab)!.label.toLowerCase() : null;
  const viewHref = (v: "list" | "board") => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (val && k !== "view" && k !== "page") p.set(k, val);
    if (v === "board") p.set("view", "board");
    const qs = p.toString();
    return qs ? `/dashboard/proposals?${qs}` : "/dashboard/proposals";
  };
  const bt = boardTotals(data.board);
  const lakhs = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);
  const emptyMessage = tabLabel && anyProposal
    ? `No ${tabLabel} proposals${hasFilters ? " match these filters" : ""}.`
    : "No proposals match these filters.";

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><FileSignature className="size-6 text-muted-foreground" /> Proposals</>} actions={<>
        <div className="inline-flex rounded-lg bg-secondary p-0.5 gap-0.5" role="group" aria-label="View">
          <Link href={viewHref("list")} aria-pressed={view === "list"} className={`px-3 py-1.5 text-sm rounded-md ${view === "list" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}>List</Link>
          <Link href={viewHref("board")} aria-pressed={view === "board"} className={`px-3 py-1.5 text-sm rounded-md ${view === "board" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}>Pipeline</Link>
        </div>
        <Link href="/dashboard/proposals/new" className="btn-primary">
          <Plus className="size-4" /> New proposal
        </Link></>} />

      {/* Status tabs, with counts under the current filters. */}
      {view === "list" && <nav role="tablist" aria-label="Proposal status" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
        {TABS.map((t) => {
          const active = tab === t.key;
          const n = Number(data.counts[t.key] ?? 0);
          return (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              role="tab"
              aria-selected={active}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
            >
              {t.label}
              <span className={`tabular-nums ${t.key === "expired" && n > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                {n}
              </span>
            </Link>
          );
        })}
      </nav>}

      <CompactFilterBar
        totalCount={view === "board" ? data.board.length : data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by number, title, recipient…" },
          {
            type: "sort",
            key: "sort",
            label: "Sort",
            options: [
              { value: "created_desc", label: "Newest first" },
              { value: "created_asc", label: "Oldest first" },
              { value: "invest_desc", label: "Investment ₹ — high to low" },
              { value: "invest_asc", label: "Investment ₹ — low to high" },
            ],
          },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "draft", label: "Draft" },
              { value: "ready", label: "Ready" },
              { value: "sent", label: "Sent" },
              { value: "viewed", label: "Viewed" },
              { value: "changes_requested", label: "Changes requested" },
              { value: "accepted", label: "Accepted" },
              { value: "partially_approved", label: "Partly accepted" },
              { value: "executed", label: "Executed" },
              { value: "rejected", label: "Rejected" },
              { value: "expired", label: "Expired" },
            ],
          },
          {
            type: "multi",
            key: "type",
            label: "Type",
            options: [
              { value: "comprehensive", label: "Comprehensive" },
              { value: "mutual_fund", label: "Mutual Fund" },
              { value: "insurance", label: "Insurance" },
              { value: "pms", label: "PMS" },
              { value: "aif", label: "AIF" },
              { value: "mixed", label: "Mixed" },
            ],
          },
          {
            type: "multi",
            key: "risk",
            label: "Risk rating",
            options: [
              { value: "conservative", label: "Conservative" },
              { value: "moderate", label: "Moderate" },
              { value: "aggressive", label: "Aggressive" },
            ],
          },
          dateRangeFilter("created", "Created"),
        ]}
        rightSlot={
          <div className="flex items-center gap-2">
            {view === "list" && <ColumnManager moduleKey="proposals" columns={PROPOSALS_COLUMNS} version={COLUMNS_VERSION} />}
            <CustomViews
              viewsKey="views:proposals"
              presets={[
                { id: "awaiting", name: "Awaiting client", params: "status=sent,viewed" },
                { id: "accepted", name: "Accepted", params: "status=accepted" },
                { id: "drafts", name: "My drafts", params: "status=draft,ready" },
                { id: "mf", name: "Mutual Fund only", params: "type=mutual_fund" },
              ]}
            />
          </div>
        }
      />

      {view === "board" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {bt.count} proposal{bt.count === 1 ? "" : "s"} sent · {bt.proposed > 0 ? lakhs(bt.proposed) : "₹0"} proposed ·{" "}
            <span className="text-foreground font-medium">{bt.executed > 0 ? lakhs(bt.executed) : "₹0"} executed</span>
            <span className="text-2xs"> (first-year values: a year of SIPs plus one-time money)</span>
          </p>
          <ProposalsBoard rows={data.board} />
        </div>
      )}

      {view === "list" && <div className="card-surface">
        {data.rows.length === 0 && (anyProposal || hasFilters) ? (
          <InlineEmpty icon={FileSignature} message={emptyMessage} />
        ) : data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <FileSignature className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No proposals yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New proposal</strong> to build a branded MF / Insurance / PMS / AIF
              proposal you can download as a PDF and send to a client.
            </p>
          </div>
        ) : (
          <div>
            <ProposalsBulkTable canRenew={canRenew} rows={data.rows.map((r, i) => ({ ...r, _seq: (page - 1) * PAGE_SIZE + i + 1 }))} />
            <div className="px-4 pb-3">
              <Pager
                page={page}
                totalPages={Math.ceil(data.filteredTotal / PAGE_SIZE)}
                total={data.filteredTotal}
                pageSize={PAGE_SIZE}
              />
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "rose" | "amber" | "emerald" | "muted";
  icon?: any;
}) {
  const color =
    tone === "rose"
      ? "text-rose-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "emerald"
          ? "text-emerald-600"
          : "text-foreground";
  const iconBg =
    tone === "rose"
      ? "bg-rose-50 text-rose-600"
      : tone === "amber"
        ? "bg-amber-50 text-amber-600"
        : tone === "emerald"
          ? "bg-emerald-50 text-emerald-600"
          : "bg-brand-cyan-light text-brand-cyan-deep";
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${iconBg}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
    </div>
  );
}
