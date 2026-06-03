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
import { formatDate, formatINR } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { FilterBar } from "@/components/common/FilterBar";
import { dateRangeCond, dateRangeFilter } from "@/lib/filters/date-range";
import { CustomViews } from "@/components/common/CustomViews";
import { ColumnManager } from "@/components/common/ColumnManager";
import { Pager } from "@/components/common/Pager";

const PROPOSALS_COLUMNS = [
  { key: "number", label: "Proposal number", required: true },
  { key: "title", label: "Title" },
  { key: "recipient", label: "Recipient", required: true },
  { key: "type", label: "Type" },
  { key: "invest", label: "Investment ₹" },
  { key: "corpus", label: "Expected corpus" },
  { key: "status", label: "Status" },
  { key: "valid_till", label: "Valid till" },
  { key: "prepared_by", label: "Prepared by", defaultHidden: true },
  { key: "created", label: "Created" },
  { key: "actions", label: "Actions", required: true },
];

const STATUS_TONE: Record<string, string> = {
  draft: "bg-gray-50 text-gray-700",
  ready: "bg-blue-50 text-blue-700",
  sent: "bg-amber-50 text-amber-700",
  viewed: "bg-cyan-50 text-cyan-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  expired: "bg-slate-50 text-slate-700",
};

const TYPE_LABEL: Record<string, string> = {
  comprehensive: "Comprehensive",
  mutual_fund: "Mutual Fund",
  insurance: "Insurance",
  pms: "PMS",
  aif: "AIF",
  mixed: "Mixed",
};

const TYPE_TONE: Record<string, string> = {
  comprehensive: "bg-violet-50 text-violet-700",
  mutual_fund: "bg-emerald-50 text-emerald-700",
  insurance: "bg-blue-50 text-blue-700",
  pms: "bg-amber-50 text-amber-700",
  aif: "bg-rose-50 text-rose-700",
  mixed: "bg-purple-50 text-purple-700",
};

export const dynamic = "force-dynamic";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const riskFilter = (sp.risk ?? "").split(",").filter(Boolean);
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    const filters: any[] = [];
    if (q) {
      filters.push(
        sql`(p.proposal_number ILIKE ${`%${q}%`} OR p.title ILIKE ${`%${q}%`} OR p.recipient_name ILIKE ${`%${q}%`})`
      );
    }
    if (statusFilter.length) {
      filters.push(
        sql`p.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`
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
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const rows = await tx.execute(sql`
      SELECT p.id, p.proposal_number, p.title, p.type, p.status,
             p.recipient_name, p.recipient_type, p.investor_id, p.lead_id,
             p.total_investment::numeric AS total_investment,
             p.expected_corpus::numeric AS expected_corpus,
             p.risk_rating, p.valid_until, p.sent_at, p.accepted_at,
             p.created_at,
             u.name AS prepared_by
      FROM proposals p
      LEFT JOIN users u ON u.id = p.prepared_by_user_id
      ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);
    // True count of the filtered set (drives the pager + accurate header count).
    const filtered = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM proposals p ${whereSql}
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
      rows: rows.rows as any[],
      s: stats.rows[0] as any,
      filteredTotal: Number((filtered.rows[0] as any)?.c ?? 0),
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <FileSignature className="size-6 text-brand-cyan" /> Proposals
          </h1>
          <p className="page-subtitle">
            Branded investment proposals · Mutual Fund · Insurance · PMS · AIF · sent as PDFs.
          </p>
        </div>
        <Link href="/dashboard/proposals/new" className="btn-primary">
          <Plus className="size-4" /> New proposal
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Stat icon={FileText} label="Total" value={String(data.s.total ?? 0)} />
        <Stat
          icon={Send}
          label="Awaiting client"
          value={String(data.s.pending ?? 0)}
          tone={Number(data.s.pending) > 0 ? "amber" : "muted"}
        />
        <Stat
          icon={CheckCircle2}
          label="Accepted MTD"
          value={String(data.s.accepted_mtd ?? 0)}
          tone="emerald"
        />
        <Stat
          icon={Clock}
          label="Conversion %"
          value={data.s.conv_pct != null ? `${Number(data.s.conv_pct).toFixed(1)}%` : "—"}
          tone="emerald"
        />
        <Stat
          icon={IndianRupee}
          label="Outstanding ₹"
          value={data.s.outstanding_value ? formatINR(Number(data.s.outstanding_value)) : "₹0"}
        />
      </div>

      <FilterBar
        totalCount={data.filteredTotal}
        filters={[
          { type: "search", key: "q", placeholder: "Search by number, title, recipient…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "draft", label: "Draft" },
              { value: "ready", label: "Ready" },
              { value: "sent", label: "Sent" },
              { value: "viewed", label: "Viewed" },
              { value: "accepted", label: "Accepted" },
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
            <ColumnManager moduleKey="proposals" columns={PROPOSALS_COLUMNS} />
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

      <div className="card-surface">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <FileSignature className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No proposals yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New proposal</strong> to build a branded MF / Insurance / PMS / AIF
              proposal you can download as a PDF and send to a client.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-table="proposals">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th data-col="number" className="text-left px-4 py-2 font-medium">Number</th>
                  <th data-col="title" className="text-left py-2 font-medium">Title</th>
                  <th data-col="recipient" className="text-left py-2 font-medium">Recipient</th>
                  <th data-col="type" className="text-left py-2 font-medium">Type</th>
                  <th data-col="invest" className="text-right py-2 font-medium">Invest ₹</th>
                  <th data-col="corpus" className="text-right py-2 font-medium">Corpus ₹</th>
                  <th data-col="status" className="text-left py-2 font-medium">Status</th>
                  <th data-col="valid_till" className="text-left py-2 font-medium">Valid till</th>
                  <th data-col="prepared_by" className="text-left py-2 font-medium">Prepared by</th>
                  <th data-col="created" className="text-left py-2 font-medium">Created</th>
                  <th data-col="actions" className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-secondary/40">
                    <td data-col="number" className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`/dashboard/proposals/${p.id}`}
                        className="text-brand-cyan-deep hover:underline font-semibold"
                      >
                        {p.proposal_number}
                      </Link>
                    </td>
                    <td data-col="title" className="py-3 text-xs">
                      <div className="font-medium text-foreground">{p.title}</div>
                      {p.risk_rating && (
                        <div className="text-[10px] text-muted-foreground capitalize">
                          Risk · {p.risk_rating}
                        </div>
                      )}
                    </td>
                    <td data-col="recipient" className="py-3 text-xs whitespace-nowrap">
                      <div className="font-medium">{p.recipient_name}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">
                        {p.recipient_type}
                      </div>
                    </td>
                    <td data-col="type" className="py-3">
                      <span className={`chip ${TYPE_TONE[p.type] ?? ""} text-[10px]`}>
                        {TYPE_LABEL[p.type] ?? p.type}
                      </span>
                    </td>
                    <td data-col="invest" className="py-3 text-right tabular-nums text-xs">
                      {p.total_investment ? formatINR(Number(p.total_investment)) : "—"}
                    </td>
                    <td data-col="corpus" className="py-3 text-right tabular-nums text-xs text-emerald-700 font-medium">
                      {p.expected_corpus ? formatINR(Number(p.expected_corpus)) : "—"}
                    </td>
                    <td data-col="status" className="py-3">
                      <span className={`chip capitalize ${STATUS_TONE[p.status] ?? ""}`}>
                        {p.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td data-col="valid_till" className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {p.valid_until ? formatDate(p.valid_until) : "—"}
                    </td>
                    <td data-col="prepared_by" className="py-3 text-xs whitespace-nowrap">{p.prepared_by ?? "—"}</td>
                    <td data-col="created" className="py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(p.created_at)}
                    </td>
                    <td data-col="actions" className="px-4 py-3 text-right">
                      <RowActions
                        editHref={`/dashboard/proposals/${p.id}`}
                        deleteUrl={`/api/proposals/${p.id}`}
                        itemLabel="proposal"
                        itemName={p.proposal_number}
                        verb="Cancel"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      </div>
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
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
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
