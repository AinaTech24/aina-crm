import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldCheck, AlertTriangle, Plus, ArrowRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/utils";
import { Pager } from "@/components/common/Pager";
import { RiskProfileName, RiskProfilePdfButtons } from "@/components/risk-profile/RiskProfileName";
import { SignedFormButton } from "@/components/risk-profile/SignedFormButton";
import { SendRiskProfileLinkButton } from "@/components/risk-profile/SendRiskProfileLinkButton";
import { BulkAssignByAge } from "@/components/risk-profile/BulkAssignByAge";
import { resolveAgeBands } from "@/lib/risk-profile/age-bands";
import { Avatar } from "@/components/ui/Avatar";
import { PdfRow } from "@/components/common/ClickableRow";

export const dynamic = "force-dynamic";

const CATEGORY_TONE: Record<string, string> = {
  conservative: "bg-blue-50 text-blue-700",
  moderate: "bg-emerald-50 text-emerald-700",
  aggressive: "bg-amber-50 text-amber-700",
  very_aggressive: "bg-rose-50 text-rose-700",
};

type FilterKey = "needs_review" | "current" | "not_profiled" | "expired" | "suggested" | "all";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "needs_review", label: "Needs review" },
  { key: "current", label: "Current" },
  { key: "not_profiled", label: "Not profiled" },
  { key: "expired", label: "Expired" },
  { key: "suggested", label: "Suggested (unconfirmed)" },
  { key: "all", label: "All active" },
];

const PAGE_SIZE = 50;

/** Investor-column predicate for each filter (uses the mirror columns on
 *  investors, kept in sync by the capture routes). */
function filterPredicate(key: FilterKey) {
  switch (key) {
    case "current":
      return sql`risk_profile_signed_at IS NOT NULL AND risk_profile_signed_at >= now() - interval '11 months'`;
    case "not_profiled":
      // A provisional category is a suggestion, not a profile — these clients
      // still need to answer, so they belong in this worklist.
      return sql`risk_profile IS NULL OR risk_profile_provisional = true`;
    case "suggested":
      return sql`risk_profile_provisional = true`;
    case "expired":
      return sql`risk_profile_signed_at IS NOT NULL AND risk_profile_signed_at < now() - interval '12 months'`;
    case "all":
      return sql`TRUE`;
    case "needs_review":
    default:
      return sql`(risk_profile_signed_at IS NULL OR risk_profile_signed_at < now() - interval '11 months')`;
  }
}

/** Ordering per filter — most-actionable first. */
function orderClause(key: FilterKey) {
  if (key === "current") return sql`risk_profile_signed_at DESC NULLS LAST`;
  if (key === "not_profiled" || key === "all") return sql`name ASC`;
  // needs_review / expired — never-profiled first, then most overdue.
  return sql`risk_profile_signed_at ASC NULLS FIRST`;
}

export default async function RiskProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  // Client PII (name, PAN, risk band) — require an investor-view capability and
  // scope RMs to their own book (the page previously showed the whole firm's
  // risk register to any role, including marketing).
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
  const canViewAll = can(session.roles, "investor.view.all", session.permissions);
  // Bulk suggesting labels hundreds of clients at once — same gate as editing a profile.
  const canManage = can(session.roles, "risk_profile.manage", session.permissions);
  const sp = await searchParams;
  const filter: FilterKey =
    (FILTERS.find((f) => f.key === sp.filter)?.key as FilterKey) ?? "all";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const data = await withTenant(session.tenantId, async (tx) => {
    // Owner slice for non-managers (applied to every query below).
    const rmScope = canViewAll ? sql`TRUE` : sql`rm_id = ${session.userId}::uuid`;
    // KPI strip — one aggregate over the active book.
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total_clients,
        COUNT(*) FILTER (WHERE risk_profile IS NOT NULL AND risk_profile_provisional = false)::int AS profiled,
        COUNT(*) FILTER (WHERE risk_profile IS NULL OR risk_profile_provisional = true)::int AS not_profiled,
        COUNT(*) FILTER (WHERE risk_profile_provisional = true)::int AS provisional,
        COUNT(*) FILTER (WHERE risk_profile_signed_at IS NOT NULL
          AND risk_profile_signed_at < now() - interval '1 year')::int AS expired,
        COUNT(*) FILTER (WHERE risk_profile_signed_at IS NOT NULL
          AND risk_profile_signed_at >= now() - interval '1 year'
          AND risk_profile_signed_at < now() - interval '11 months')::int AS due_soon
      FROM investors WHERE status = 'active' AND deleted_at IS NULL AND ${rmScope}
    `);
    const s = stats.rows[0] as any;

    const predicate = filterPredicate(filter);

    // Total matching the active filter (drives the pager) — investor-only, no
    // join needed since the filter is on the investor mirror columns.
    const c = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM investors
      WHERE status = 'active' AND deleted_at IS NULL AND ${predicate} AND ${rmScope}
    `);
    const total = Number((c.rows[0] as any)?.c ?? 0);

    // One page of investors + their latest response via a LATERAL join (uses
    // rpr_investor_signed_idx; fetches exactly one response per page row — no
    // unbounded DISTINCT ON over the whole book).
    const rows = await tx.execute(sql`
      SELECT
        i.id, i.name, i.pan, i.avatar_url, i.risk_profile, i.risk_profile_signed_at, i.risk_profile_score,
        i.risk_profile_provisional,
        rp.id AS profile_id, rp.total_score, rp.next_review_at, rp.signed_at AS latest_signed_at,
        rp.document_url AS signed_doc_key, rp.verification_method
      FROM investors i
      LEFT JOIN LATERAL (
        SELECT id, total_score, next_review_at, signed_at, document_url, verification_method
        FROM risk_profile_responses r
        WHERE r.investor_id = i.id
        ORDER BY r.signed_at DESC NULLS LAST
        LIMIT 1
      ) rp ON TRUE
      WHERE i.status = 'active' AND i.deleted_at IS NULL AND ${predicate}
        AND ${canViewAll ? sql`TRUE` : sql`i.rm_id = ${session.userId}::uuid`}
      ORDER BY ${orderClause(filter)}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);

    return {
      total: Number(s.total_clients),
      profiled: Number(s.profiled),
      notProfiled: Number(s.not_profiled),
      expired: Number(s.expired),
      dueSoon: Number(s.due_soon),
      provisional: Number(s.provisional ?? 0),
      rows: rows.rows as any[],
      filterTotal: total,
      bands: resolveAgeBands(
        ((await tx.execute(sql`SELECT risk_age_bands FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1`)).rows[0] as any)?.risk_age_bands
      ),
    };
  });

  // Tab counts derived from the KPI aggregate (no extra queries).
  const tabCount: Record<FilterKey, number> = {
    needs_review: data.notProfiled + data.expired + data.dueSoon,
    current: Math.max(0, data.profiled - data.expired - data.dueSoon),
    not_profiled: data.notProfiled,
    expired: data.expired,
    suggested: data.provisional,
    all: data.total,
  };

  const tabHref = (key: FilterKey) =>
    key === "all" ? "/dashboard/risk-profiles" : `/dashboard/risk-profiles?filter=${key}`;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            <ShieldCheck className="size-6 text-muted-foreground" /> Risk profiles
          </h1>
          <p className="page-subtitle mt-1">Each client&apos;s risk category, and when it is due to be re-assessed.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <BulkAssignByAge initialBands={data.bands} />}
          <Link href="/dashboard/risk-profiles/new" className="btn-primary">
            <Plus className="size-4" /> New Risk Profile
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Link
              key={f.key}
              href={tabHref(f.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors ${active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-accent text-muted-foreground"
                }`}
            >
              {f.label}
              <span className={`tabular-nums text-xs font-semibold ${active ? "opacity-90" : "opacity-70"}`}>
                {tabCount[f.key]}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Table */}
      <div className="card-surface">
        <div className="border-b border-border px-4 py-2.5 font-semibold flex items-center justify-between">
          <span>{FILTERS.find((f) => f.key === filter)?.label} ({data.filterTotal})</span>
        </div>
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <ShieldCheck className="size-8 mx-auto text-emerald-500" />
            <div className="mt-2 font-medium">
              {filter === "needs_review" ? "All profiles current ✓" : "No investors in this view."}
            </div>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Investor</th>
                    <th className="text-left py-2 font-medium">Category</th>
                    <th className="text-left py-2 font-medium">Score</th>
                    <th className="text-left py-2 font-medium">Last signed</th>
                    <th className="text-left py-2 font-medium">Next review</th>
                    <th className="text-left py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r: any) => {
                    const signed = r.risk_profile_signed_at ? new Date(r.risk_profile_signed_at) : null;
                    const ageMs = signed ? Date.now() - signed.getTime() : null;
                    const status = !signed
                      ? "not_profiled"
                      : ageMs! > 365 * 24 * 60 * 60 * 1000
                        ? "expired"
                        : ageMs! > 334 * 24 * 60 * 60 * 1000 // ~11 months
                          ? "due_soon"
                          : "current";
                    const score = r.total_score ?? r.risk_profile_score ?? null;
                    return (
                      <PdfRow
                        key={r.id}
                        title={`Risk Profile · ${r.name}`}
                        pdfUrl={r.profile_id ? `/api/risk-profiles/${r.profile_id}/pdf` : ""}
                        downloadUrl={r.profile_id ? `/api/risk-profiles/${r.profile_id}/pdf?download=1` : undefined}
                        disabled={!r.profile_id}
                        className="border-b last:border-0 hover:bg-secondary/40"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar src={r.avatar_url ? `/api/investors/${r.id}/avatar` : null} name={r.name} size={26} />
                            <RiskProfileName
                              name={r.name}
                              pan={r.pan}
                              profileId={r.profile_id ?? null}
                            />
                          </div>
                        </td>
                        <td className="py-3">
                          {r.risk_profile ? (
                            <span
                              className={`chip capitalize ${r.risk_profile_provisional ? "bg-secondary text-muted-foreground border border-dashed border-border" : (CATEGORY_TONE[r.risk_profile] ?? "")}`}
                              title={r.risk_profile_provisional ? "Suggested from age — the client has not confirmed it yet" : undefined}
                            >
                              {r.risk_profile.replace(/_/g, " ")}
                              {r.risk_profile_provisional ? " · suggested" : ""}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 tabular-nums">{score ?? "—"}</td>
                        <td className="py-3 text-xs text-muted-foreground">
                          {signed ? formatDate(signed) : "Never"}
                        </td>
                        <td className="py-3 text-xs text-muted-foreground">
                          {r.next_review_at ? formatDate(r.next_review_at) : "—"}
                        </td>
                        <td className="py-3">
                          {status === "not_profiled" ? (
                            <span className="chip bg-amber-50 text-amber-700">
                              <AlertTriangle className="size-3" /> Not profiled
                            </span>
                          ) : r.risk_profile_provisional ? (
                            /* A suggestion is not a completed profile — saying
                               "Current" here would imply the client had answered. */
                            <span className="chip bg-amber-50 text-amber-700" title="Suggested from age — waiting for the client to confirm">
                              Awaiting confirmation
                            </span>
                          ) : status === "expired" ? (
                            <span className="chip bg-rose-50 text-rose-700">Expired</span>
                          ) : status === "due_soon" ? (
                            <span className="chip bg-amber-50 text-amber-700">Due soon</span>
                          ) : (
                            <span className="chip bg-emerald-50 text-emerald-700">Current</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            {r.signed_doc_key && r.profile_id && (
                              <SignedFormButton profileId={String(r.profile_id)} />
                            )}
                            <RiskProfilePdfButtons profileId={r.profile_id ?? null} name={r.name} />
                            <SendRiskProfileLinkButton investorId={String(r.id)} />
                            <Link
                              href={`/dashboard/risk-profiles/new?investorId=${r.id}`}
                              className="btn-accent text-xs px-3 py-1"
                            >
                              {status === "current" ? "Re-profile" : "Start"} <ArrowRight className="size-3" />
                            </Link>
                          </div>
                        </td>
                      </PdfRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-3">
              <Pager
                page={page}
                totalPages={Math.ceil(data.filterTotal / PAGE_SIZE)}
                total={data.filterTotal}
                pageSize={PAGE_SIZE}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "rose" | "amber" | "muted";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "rose"
        ? "text-rose-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
