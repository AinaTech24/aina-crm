import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ShieldCheck, AlertTriangle, Plus, ArrowRight, Search, X } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { formatDate } from "@/lib/utils";
import { Pager } from "@/components/common/Pager";
import { RiskProfileName, RiskProfilePdfButtons } from "@/components/risk-profile/RiskProfileName";
import { SignedFormButton } from "@/components/risk-profile/SignedFormButton";
import { SendRiskProfileLinkButton } from "@/components/risk-profile/SendRiskProfileLinkButton";
import { BulkAssignByAge } from "@/components/risk-profile/BulkAssignByAge";
import { RiskSelectionProvider, RowSelect, SelectAllOnPage, RiskBulkBar } from "@/components/risk-profile/RiskProfileBulkSend";
import { InlineEmpty } from "@/components/common/EmptyState";
import { RISK_BUCKETS, parseRiskBucket, riskBucketSql, riskBucketCaseSql, type RiskBucket } from "@/lib/risk-profile/buckets";
import { displayPan, isMinorKey } from "@/lib/investors/pan-display";
import { resolveAgeBands } from "@/lib/risk-profile/age-bands";
import { Avatar } from "@/components/ui/Avatar";
import { PdfRow } from "@/components/common/ClickableRow";
import { riskProfileBaseSql } from "@/lib/metrics/risk";

export const dynamic = "force-dynamic";

const CATEGORY_TONE: Record<string, string> = {
  conservative: "bg-blue-50 text-blue-700",
  moderate: "bg-emerald-50 text-emerald-700",
  aggressive: "bg-amber-50 text-amber-700",
  very_aggressive: "bg-rose-50 text-rose-700",
};

const PAGE_SIZE = 50;

/** Ordering per tab, most actionable first. */
function orderClause(key: RiskBucket) {
  if (key === "current") return sql`i.risk_profile_signed_at DESC NULLS LAST`;
  // Due / expired: the longest-lapsed first.
  if (key === "due" || key === "expired") return sql`i.risk_profile_signed_at ASC`;
  return sql`i.name ASC`;
}

/** What an empty tab says. */
const EMPTY: Record<RiskBucket, string> = {
  not_profiled: "Every client has a signed risk profile.",
  due: "No profile falls due for review in the next month.",
  current: "No client has a current signed profile yet.",
  expired: "No profile has expired.",
  awaiting: "No suggested profile is waiting for a client to confirm it.",
};

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
  // Default tab: Not profiled. Old ?filter=needs_review / suggested links map
  // onto the bucket that now holds those clients.
  const filter = parseRiskBucket(sp.filter?.split(",")[0]);
  // A dashboard's "Risk profiles due" opens `?filter=due,expired` — both
  // buckets in one list, so the count it showed is the row count here.
  const filters = [...new Set((sp.filter ?? "").split(",").map((f) => f.trim()).filter((f) => RISK_BUCKETS.some((b) => b.key === f)))] as RiskBucket[];
  const combined = filters.length > 1;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  // Search by client name (or PAN). Narrows the tab counts as well as the list,
  // so the tabs show where a searched client sits.
  const q = (sp.q ?? "").trim().slice(0, 80);

  const data = await withTenant(session.tenantId, async (tx) => {
    // The clients the page lists — active clients of this firm, an RM's own
    // book for non-managers, narrowed by a dashboard drill-down's rm / branch
    // (lib/metrics/risk.ts: the same base every risk-profile count uses).
    const baseOnly = riskProfileBaseSql({
      tenantId: session.tenantId,
      rmIds: canViewAll ? (sp.rm ? sp.rm.split(",") : undefined) : [session.userId],
      branchIds: sp.branch ? sp.branch.split(",") : undefined,
    });
    // Plus the shared client data scope (branch / own book).
    const base = sql`(${baseOnly} AND ${await investorScopeSql(tx, session, "i")})`;
    const search = q
      ? sql`(i.name ILIKE ${`%${q}%`} OR i.pan ILIKE ${`%${q.toUpperCase()}%`})`
      : sql`TRUE`;
    // Tab counts — one aggregate over the active book. The buckets are
    // mutually exclusive, so the tabs add up to the book.
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${riskBucketSql("not_profiled")})::int AS not_profiled,
        COUNT(*) FILTER (WHERE ${riskBucketSql("due")})::int AS due,
        COUNT(*) FILTER (WHERE ${riskBucketSql("current")})::int AS current,
        COUNT(*) FILTER (WHERE ${riskBucketSql("expired")})::int AS expired,
        COUNT(*) FILTER (WHERE ${riskBucketSql("awaiting")})::int AS awaiting
      FROM investors i WHERE ${base} AND ${search}
    `);
    const s = (stats.rows[0] ?? {}) as Partial<Record<RiskBucket, number>>;
    const counts = Object.fromEntries(RISK_BUCKETS.map((b) => [b.key, Number(s[b.key] ?? 0)])) as Record<RiskBucket, number>;

    const predicate = combined
      ? sql`(${sql.join(filters.map((f) => riskBucketSql(f)), sql` OR `)})`
      : riskBucketSql(filter);

    // Total matching the active filter (drives the pager) — investor-only, no
    // join needed since the filter is on the investor mirror columns.
    const c = await tx.execute(sql`
      SELECT COUNT(*)::int AS c FROM investors i
      WHERE ${base} AND ${search} AND ${predicate}
    `);
    const total = Number((c.rows[0] as any)?.c ?? 0);

    // One page of investors + their latest response via a LATERAL join (uses
    // rpr_investor_signed_idx; fetches exactly one response per page row — no
    // unbounded DISTINCT ON over the whole book).
    const rows = await tx.execute(sql`
      SELECT
        i.id, i.name, i.pan, i.avatar_url, i.risk_profile, i.risk_profile_signed_at, i.risk_profile_score,
        i.risk_profile_provisional, i.is_minor, g.name AS guardian_name,
        ${riskBucketCaseSql()} AS bucket,
        rp.id AS profile_id, rp.total_score, rp.next_review_at, rp.signed_at AS latest_signed_at,
        rp.document_url AS signed_doc_key, rp.verification_method
      FROM investors i
      LEFT JOIN investors g ON g.id = i.guardian_investor_id AND g.tenant_id = i.tenant_id
      LEFT JOIN LATERAL (
        SELECT id, total_score, next_review_at, signed_at, document_url, verification_method
        FROM risk_profile_responses r
        WHERE r.investor_id = i.id
        ORDER BY r.signed_at DESC NULLS LAST
        LIMIT 1
      ) rp ON TRUE
      WHERE ${base} AND ${search} AND ${predicate}
      ORDER BY ${orderClause(filter)}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `);

    return {
      counts,
      // The raw PAN column never leaves the server: it can hold an import key
      // (MINOR:<guardian PAN>:<NAME>, NOPAN:…), and a real PAN goes out masked.
      rows: (rows.rows as any[]).map(({ pan, ...r }) => ({
        ...r,
        pan_display: displayPan(pan),
        is_minor: r.is_minor === true || isMinorKey(pan),
      })),
      filterTotal: total,
      bands: resolveAgeBands(
        ((await tx.execute(sql`SELECT risk_age_bands FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1`)).rows[0] as any)?.risk_age_bands
      ),
    };
  });

  const tabHref = (key: RiskBucket) => {
    const p = new URLSearchParams();
    if (key !== "not_profiled") p.set("filter", key);
    if (q) p.set("q", q);
    const qs = p.toString();
    return qs ? `/dashboard/risk-profiles?${qs}` : "/dashboard/risk-profiles";
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><ShieldCheck className="size-6 text-muted-foreground" /> Risk Profiles</>} actions={<><div className="flex items-center gap-2">
          {canManage && <BulkAssignByAge initialBands={data.bands} />}
          <Link href="/dashboard/risk-profiles/new" className="btn-primary">
            <Plus className="size-4" /> New Risk Profile
          </Link>
        </div></>} />

      {/* Search + filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        <form action="/dashboard/risk-profiles" className="relative mr-2" role="search">
          {sp.filter && <input type="hidden" name="filter" value={sp.filter} />}
          <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search client name or PAN…"
            aria-label="Search risk profiles by client name"
            className="input-base h-9 w-64 pl-8 pr-8 text-sm"
          />
          {q && (
            <Link
              href={sp.filter ? `/dashboard/risk-profiles?filter=${encodeURIComponent(sp.filter)}` : "/dashboard/risk-profiles"}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              title="Clear search"
            >
              <X className="size-4" />
            </Link>
          )}
        </form>
        {RISK_BUCKETS.map((f) => {
          const active = !combined && f.key === filter;
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
                {data.counts[f.key].toLocaleString("en-IN")}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Table */}
      {/* Keyed on tab + page: a selection never carries over to rows you can't see. */}
      <RiskSelectionProvider key={`${filter}:${page}:${q}`} pageIds={data.rows.map((r: any) => String(r.id))}>
      <div className="card-surface">
        <div className="border-b border-border px-4 py-2.5 font-semibold flex items-center justify-between">
          <span>{combined
            ? filters.map((k) => RISK_BUCKETS.find((f) => f.key === k)?.label).join(" + ")
            : RISK_BUCKETS.find((f) => f.key === filter)?.label} ({data.filterTotal.toLocaleString("en-IN")})</span>
        </div>
        {canManage && <RiskBulkBar notProfiledCount={data.counts.not_profiled} />}
        {data.rows.length === 0 ? (
          <InlineEmpty message={q ? `No client matching “${q}” in this list.` : EMPTY[filter]} />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b sticky top-0 z-10 bg-card">
                  <tr>
                    {canManage && (
                      <th className="w-10 pl-4 py-2">
                        <SelectAllOnPage />
                      </th>
                    )}
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
                    // Computed by the same SQL as the tabs, so a row's chip never
                    // disagrees with the tab it is listed under.
                    const status = r.bucket as RiskBucket;
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
                        {canManage && (
                          <td className="pl-4 py-3" data-no-row-nav>
                            <RowSelect id={String(r.id)} name={r.name} />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar src={r.avatar_url ? `/api/investors/${r.id}/avatar` : null} name={r.name} size={26} />
                            <RiskProfileName
                              name={r.name}
                              pan={r.pan_display}
                              profileId={r.profile_id ?? null}
                              isMinor={r.is_minor}
                              guardianName={r.guardian_name ?? null}
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
                          {signed ? formatDate(signed) : "Not yet"}
                        </td>
                        <td className="py-3 text-xs text-muted-foreground">
                          {r.next_review_at ? formatDate(r.next_review_at) : "—"}
                        </td>
                        <td className="py-3">
                          {status === "awaiting" ? (
                            /* A suggestion is not a completed profile — saying
                               "Current" here would imply the client had answered. */
                            <span className="chip bg-amber-50 text-amber-700" title="Suggested from age — waiting for the client to confirm">
                              Awaiting confirmation
                            </span>
                          ) : status === "not_profiled" ? (
                            <span className="chip bg-amber-50 text-amber-700">
                              <AlertTriangle className="size-3" /> Not profiled
                            </span>
                          ) : status === "expired" ? (
                            <span className="chip bg-rose-50 text-rose-700">Expired</span>
                          ) : status === "due" ? (
                            <span className="chip bg-amber-50 text-amber-700">Due for review</span>
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
                            <SendRiskProfileLinkButton investorId={String(r.id)} appearance="row" />
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
      </RiskSelectionProvider>
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
