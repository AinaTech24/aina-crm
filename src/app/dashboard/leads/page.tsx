import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import {
  Plus,
  Sparkles,
  Users,
  Target,
  TrendingUp,
  UploadCloud,
  Filter,
} from "lucide-react";
import { withTenant } from "@/db/client";
import { leads, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { LeadsKanban } from "@/components/leads/LeadsKanban";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { EmptyState } from "@/components/common/EmptyState";

/**
 * Pipeline columns — exact mirror of the 12 lead-phase blueprint stages
 * (stages 1-12 of LEAD_TO_CLIENT_STAGES, before the Convert-to-Client
 * boundary). The platform now speaks a single vocabulary: stage ===
 * blueprint stage. Drag-drop here calls the blueprint advance engine.
 *
 * Aliases fold legacy stage values from before the unification onto the
 * canonical blueprint key.
 */
const STAGES = [
  { key: "new", label: "New", tone: "blue", aliases: [] as string[] },
  { key: "first_call_pending", label: "First Call Pending", tone: "cyan", aliases: ["contacted"] },
  { key: "appointment_scheduled", label: "Appointment Scheduled", tone: "amber", aliases: ["meeting_scheduled", "qualified"] },
  { key: "meeting_done", label: "Meeting Completed", tone: "amber", aliases: [] },
  { key: "post_meeting_qualified", label: "Post-Meeting Qualification", tone: "indigo", aliases: ["follow_up"] },
  { key: "risk_profile_sent", label: "Risk Profile Sent", tone: "indigo", aliases: [] },
  { key: "risk_profiled", label: "Risk Profile Completed", tone: "violet", aliases: [] },
  { key: "proposal_drafted", label: "Proposal Drafted", tone: "violet", aliases: [] },
  { key: "proposal_sent", label: "Proposal Sent", tone: "violet", aliases: ["proposal_shared"] },
  { key: "proposal_approved", label: "Proposal Approved", tone: "emerald", aliases: [] },
  { key: "docs_requested", label: "Documents Requested", tone: "emerald", aliases: [] },
  { key: "docs_received", label: "Documents Received", tone: "emerald", aliases: [] },
] as const;

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const stageFilter = (sp.stage ?? "").split(",").filter(Boolean);
  const sourceFilter = (sp.source ?? "").split(",").filter(Boolean);

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [];
    if (q) {
      conds.push(
        sql`(leads.name ILIKE ${`%${q}%`} OR leads.phone ILIKE ${`%${q}%`} OR leads.email ILIKE ${`%${q}%`})`
      );
    }
    if (stageFilter.length)
      conds.push(sql`leads.stage IN (${sql.join(stageFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (sourceFilter.length)
      conds.push(sql`leads.source IN (${sql.join(sourceFilter.map((v) => sql`${v}`), sql`, `)})`);
    const whereClause: any =
      conds.length === 0 ? undefined : sql.join(conds, sql` AND `);

    const baseQuery = tx
      .select({ lead: leads, owner: users.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId));
    const rows = await (whereClause
      ? baseQuery.where(whereClause as any).orderBy(desc(leads.updatedAt))
      : baseQuery.orderBy(desc(leads.updatedAt)));

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE stage NOT IN ('converted','lost','not_interested','cold')
        )::int AS open_count,
        COUNT(*) FILTER (
          WHERE created_at >= now() - interval '7 days'
        )::int AS new_this_week,
        COUNT(*) FILTER (
          WHERE stage = 'converted' AND updated_at >= date_trunc('month', now())
        )::int AS converted_mtd,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE stage = 'converted')::int AS converted_total,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE stage = 'converted')
          / NULLIF(COUNT(*), 0),
        1) AS conv_pct
      FROM leads
    `);
    return { rows, s: stats.rows[0] as any };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <Sparkles className="size-6 text-brand-cyan" /> Leads
          </h1>
          <p className="page-subtitle">
            Drip-nurtured, UTM-tagged, owner-attributed pipeline · 8 stages.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/leads/import" className="btn-secondary text-xs">
            <UploadCloud className="size-3.5" /> Import Excel
          </Link>
          <Link href="/dashboard/leads/new" className="btn-primary">
            <Plus className="size-4" /> New lead
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <KpiTile
          label="Open Leads"
          value={String(data.s.open_count ?? 0)}
          sub={`${data.s.total ?? 0} all-time`}
          icon={Users}
          accent="cyan"
        />
        <KpiTile
          label="New this Week"
          value={String(data.s.new_this_week ?? 0)}
          sub="last 7 days"
          icon={Sparkles}
          accent="violet"
        />
        <KpiTile
          label="Converted MTD"
          value={String(data.s.converted_mtd ?? 0)}
          sub={`${data.s.converted_total ?? 0} lifetime`}
          icon={Target}
          accent="emerald"
        />
        <KpiTile
          label="Conversion %"
          value={data.s.conv_pct != null ? `${Number(data.s.conv_pct).toFixed(1)}%` : "—"}
          sub="overall"
          icon={TrendingUp}
          accent="emerald"
        />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search lead by name, phone, email…" },
          {
            type: "multi",
            key: "stage",
            label: "Stage",
            options: STAGES.map((s) => ({ value: s.key, label: s.label })),
          },
          {
            type: "multi",
            key: "source",
            label: "Source",
            options: [
              { value: "referral", label: "Client Referral" },
              { value: "existing_client", label: "Existing Client Reference" },
              { value: "website", label: "Website" },
              { value: "social_media", label: "Social Media" },
              { value: "webinar", label: "Webinar" },
              { value: "seminar", label: "Seminar" },
              { value: "walk_in", label: "Walk-in" },
              { value: "google", label: "Google" },
              { value: "cold_call", label: "Cold Call" },
              { value: "manual", label: "Manual entry" },
              { value: "other", label: "Other" },
            ],
          },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:leads"
            presets={[
              {
                id: "open",
                name: "All open",
                params: "stage=new,first_call_pending,appointment_scheduled,meeting_done,post_meeting_qualified,risk_profile_sent,risk_profiled,proposal_drafted,proposal_sent,proposal_approved,docs_requested,docs_received",
              },
              { id: "referrals", name: "Referrals only", params: "source=referral,existing_client" },
              { id: "won", name: "Won (converted)", params: "stage=converted" },
              { id: "lost", name: "Lost / not-interested", params: "stage=lost,not_interested" },
            ]}
          />
        }
      />

      {/* Kanban — drag-and-drop enabled. Show a friendly empty-state when
          there are no leads yet AND no filters are active, so a brand-new
          tenant sees a clear "Add your first lead" path. */}
      {data.rows.length === 0 && !q && stageFilter.length === 0 && sourceFilter.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No leads yet — let's add the first one"
          description="A lead is anyone who's shown interest in your services but hasn't invested yet. The CRM tracks them through 8 stages from First Contact to Converted."
          tip="Click + at the top right to add manually, or import an Excel file of leads in seconds."
          primary={{ href: "/dashboard/leads/new", label: "+ Add first lead" }}
          secondary={{ href: "/dashboard/leads/import", label: "Import from Excel" }}
        />
      ) : (
      <div className="card-surface p-3">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Filter className="size-3.5" />
            <span className="font-medium">Pipeline view</span>
            <span>·</span>
            <span>{data.rows.length} total leads</span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Drag a card to move it between stages
          </span>
        </div>
        <LeadsKanban
          stages={STAGES.map((s) => ({ ...s, aliases: [...s.aliases] }))}
          initialRows={data.rows.map((r) => ({
            lead: {
              id: r.lead.id,
              name: r.lead.name,
              phone: (r.lead as any).phone ?? null,
              stage: r.lead.stage,
              source: r.lead.source,
              updatedAt: r.lead.updatedAt,
            },
            owner: r.owner ?? null,
          }))}
        />
      </div>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  accent: "cyan" | "violet" | "emerald" | "amber";
}) {
  const bg: Record<string, string> = {
    cyan: "bg-brand-cyan-light text-brand-cyan-deep",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </span>
        <div className={`size-8 rounded-lg grid place-items-center ${bg[accent]}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <div className="text-2xl font-bold mt-2 tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
