import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  Plus,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Send,
  FileCheck2,
  Sparkles,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x_twitter: "X / Twitter",
  whatsapp_status: "WhatsApp Status",
  telegram: "Telegram",
  blog: "Blog",
  other: "Other",
};

const PLATFORM_TONE: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700",
  facebook: "bg-blue-50 text-blue-700",
  linkedin: "bg-cyan-50 text-cyan-700",
  youtube: "bg-rose-50 text-rose-700",
  x_twitter: "bg-slate-50 text-slate-700",
  whatsapp_status: "bg-emerald-50 text-emerald-700",
  telegram: "bg-sky-50 text-sky-700",
  blog: "bg-amber-50 text-amber-700",
  other: "bg-gray-50 text-gray-700",
};

const APPROVAL_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  in_review: "bg-blue-50 text-blue-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  not_required: "bg-slate-50 text-slate-700",
};

const POSTING_TONE: Record<string, string> = {
  not_posted: "bg-gray-50 text-gray-700",
  scheduled: "bg-blue-50 text-blue-700",
  posted: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-50 text-slate-700",
};

export const dynamic = "force-dynamic";

export default async function ContentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireCap(session.roles, "content_calendar.manage");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const platformFilter = (sp.platform ?? "").split(",").filter(Boolean);
  const contentTypeFilter = (sp.content_type ?? "").split(",").filter(Boolean);
  const approvalFilter = (sp.approval ?? "").split(",").filter(Boolean);
  const postedFilter = (sp.posted ?? "").split(",").filter(Boolean);
  const compliancePending = sp.compliance_pending === "1";

  const data = await withTenant(session.tenantId, async (tx) => {
    // Explicit tenant predicate (defense-in-depth alongside RLS) — always first.
    const filters: any[] = [sql`p.tenant_id = ${session.tenantId}::uuid`];
    if (q) {
      filters.push(
        sql`(p.topic ILIKE ${`%${q}%`} OR p.caption ILIKE ${`%${q}%`} OR p.remarks ILIKE ${`%${q}%`})`
      );
    }
    if (platformFilter.length) {
      filters.push(
        sql`p.platform IN (${sql.join(platformFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (contentTypeFilter.length) {
      filters.push(
        sql`p.content_type IN (${sql.join(contentTypeFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (approvalFilter.length) {
      filters.push(
        sql`p.approval_status IN (${sql.join(approvalFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (postedFilter.length) {
      filters.push(
        sql`p.posted_status IN (${sql.join(postedFilter.map((v) => sql`${v}`), sql`, `)})`
      );
    }
    if (compliancePending) {
      filters.push(sql`p.compliance_checked = false`);
    }
    const whereSql = filters.length ? sql` WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const posts = await tx.execute(sql`
      SELECT p.id, p.content_date, p.platform, p.content_type, p.topic, p.caption,
             p.creative_files,
             p.compliance_checked, p.approval_status, p.posted_status,
             (p.compliance_scan->>'blocked' = 'true') AS scan_flagged,
             p.post_link, p.remarks, p.created_at,
             u.name AS approved_by,
             c.name AS campaign_name
      FROM content_posts p
      LEFT JOIN users u ON u.id = p.approved_by_user_id
      LEFT JOIN campaigns c ON c.id = p.campaign_id
      ${whereSql}
      ORDER BY p.content_date DESC
      LIMIT 200
    `);
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE content_date >= current_date AND posted_status != 'cancelled'
        )::int AS upcoming,
        COUNT(*) FILTER (WHERE approval_status = 'pending')::int AS pending_approval,
        COUNT(*) FILTER (WHERE compliance_checked = false AND posted_status != 'cancelled')::int AS compliance_pending,
        COUNT(*) FILTER (
          WHERE posted_status = 'posted' AND posted_at >= date_trunc('month', now())
        )::int AS posted_mtd,
        COUNT(*) FILTER (WHERE posted_status = 'failed')::int AS failed_count
      FROM content_posts
      WHERE tenant_id = ${session.tenantId}::uuid
    `);
    return { rows: posts.rows as any[], s: stats.rows[0] as any };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <ImageIcon className="size-6 text-brand-cyan" /> Social Media Calendar
          </h1>
          <p className="page-subtitle">
            Plan, compliance-check, approve, post · every post passes both gates before publish.
          </p>
        </div>
        <Link href="/dashboard/content-calendar/new" className="btn-primary">
          <Plus className="size-4" /> New post
        </Link>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3">
        <Stat icon={Calendar} label="Upcoming" value={String(data.s.upcoming ?? 0)} accent="cyan" />
        <Stat
          icon={FileCheck2}
          label="Compliance pending"
          value={String(data.s.compliance_pending ?? 0)}
          accent={Number(data.s.compliance_pending) > 0 ? "amber" : "muted"}
        />
        <Stat
          icon={Sparkles}
          label="Awaiting approval"
          value={String(data.s.pending_approval ?? 0)}
          accent={Number(data.s.pending_approval) > 0 ? "amber" : "muted"}
        />
        <Stat
          icon={Send}
          label="Posted MTD"
          value={String(data.s.posted_mtd ?? 0)}
          accent="emerald"
        />
        <Stat
          icon={AlertTriangle}
          label="Failed"
          value={String(data.s.failed_count ?? 0)}
          accent={Number(data.s.failed_count) > 0 ? "rose" : "muted"}
        />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by topic, caption, remarks…" },
          {
            type: "multi",
            key: "platform",
            label: "Platform",
            options: [
              { value: "instagram", label: "Instagram" },
              { value: "facebook", label: "Facebook" },
              { value: "linkedin", label: "LinkedIn" },
              { value: "youtube", label: "YouTube" },
              { value: "x_twitter", label: "X / Twitter" },
              { value: "whatsapp_status", label: "WhatsApp Status" },
              { value: "telegram", label: "Telegram" },
              { value: "blog", label: "Blog" },
            ],
          },
          {
            type: "multi",
            key: "approval",
            label: "Approval",
            options: [
              { value: "pending", label: "Pending" },
              { value: "in_review", label: "In review" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "not_required", label: "Not required" },
            ],
          },
          {
            type: "multi",
            key: "posted",
            label: "Posted",
            options: [
              { value: "not_posted", label: "Not posted" },
              { value: "scheduled", label: "Scheduled" },
              { value: "posted", label: "Posted" },
              { value: "failed", label: "Failed" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:content-calendar"
            presets={[
              { id: "pending-compliance", name: "Compliance pending", params: "compliance_pending=1" },
              { id: "awaiting-approval", name: "Awaiting approval", params: "approval=pending,in_review" },
              { id: "ready-to-post", name: "Ready (approved, not posted)", params: "approval=approved&posted=not_posted,scheduled" },
              { id: "posted", name: "Posted", params: "posted=posted" },
            ]}
          />
        }
      />

      <div className="card-surface">
        <div className="border-b border-border px-4 py-2.5 font-semibold flex items-center justify-between">
          <span>All posts ({data.rows.length})</span>
          <span className="text-xs text-muted-foreground">
            Posting is blocked until compliance ✓ + approval ✓
          </span>
        </div>
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <ImageIcon className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No posts yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Click <strong>New post</strong> to draft your first piece — topic, caption, creative,
              then route it through compliance + approval.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left py-2 font-medium">Platform</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-left py-2 font-medium">Topic</th>
                  <th className="text-left py-2 font-medium">Caption</th>
                  <th className="text-center py-2 font-medium">Compliance</th>
                  <th className="text-left py-2 font-medium">Approval</th>
                  <th className="text-left py-2 font-medium">Posted</th>
                  <th className="text-left py-2 font-medium">Link</th>
                  <th className="text-left py-2 font-medium">Approved by</th>
                  <th className="text-left py-2 font-medium">Remarks</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => {
                  const ready = p.compliance_checked && p.approval_status === "approved";
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap">
                        <Link
                          href={`/dashboard/content-calendar/${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {formatDate(p.content_date)}
                        </Link>
                      </td>
                      <td className="py-3">
                        <span className={`chip text-[10px] ${PLATFORM_TONE[p.platform] ?? ""}`}>
                          {PLATFORM_LABEL[p.platform] ?? p.platform}
                        </span>
                      </td>
                      <td className="py-3 text-xs capitalize">
                        {String(p.content_type).replace(/_/g, " ")}
                      </td>
                      <td className="py-3 text-xs max-w-[180px]">
                        <div className="font-medium truncate">{p.topic}</div>
                        {p.campaign_name && (
                          <div className="text-[10px] text-muted-foreground">
                            ↳ {p.campaign_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-xs max-w-[220px]">
                        <div className="line-clamp-2 text-muted-foreground">{p.caption ?? "—"}</div>
                      </td>
                      <td className="py-3 text-center">
                        <div className="inline-flex items-center gap-1">
                          {p.compliance_checked ? (
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          ) : (
                            <AlertTriangle className="size-4 text-amber-600" />
                          )}
                          {p.scan_flagged && (
                            <span title="Automated scan flagged a compliance red flag in the caption" className="text-[10px] font-semibold text-rose-600">
                              ⚑ auto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        <span
                          className={`chip text-[10px] capitalize ${
                            APPROVAL_TONE[p.approval_status] ?? ""
                          }`}
                        >
                          {p.approval_status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={`chip text-[10px] capitalize ${
                              POSTING_TONE[p.posted_status] ?? ""
                            }`}
                          >
                            {p.posted_status.replace(/_/g, " ")}
                          </span>
                          {p.posted_status !== "posted" && !ready && (
                            <span className="text-[10px] text-muted-foreground italic">
                              gated
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-xs">
                        {p.post_link ? (
                          <a
                            href={p.post_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-cyan-deep hover:underline"
                          >
                            View →
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 text-xs whitespace-nowrap">{p.approved_by ?? "—"}</td>
                      <td className="py-3 text-xs text-muted-foreground max-w-[140px] truncate">
                        {p.remarks ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions
                          editHref={`/dashboard/content-calendar/${p.id}`}
                          deleteUrl={`/api/content-posts/${p.id}`}
                          itemLabel="post"
                          itemName={p.topic}
                          verb="Cancel"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  accent?: "rose" | "amber" | "emerald" | "muted" | "cyan";
  icon?: any;
}) {
  const color =
    accent === "rose"
      ? "text-rose-600"
      : accent === "amber"
      ? "text-amber-600"
      : accent === "emerald"
      ? "text-emerald-600"
      : "text-foreground";
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    muted: "bg-secondary text-foreground",
  };
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={`size-7 rounded-lg grid place-items-center ${bg[accent ?? "muted"]}`}>
            <Icon className="size-3.5" />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold mt-2 tabular-nums tracking-tight ${color}`}>{value}</div>
    </div>
  );
}
