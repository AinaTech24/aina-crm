/**
 * The Insurance Team Dashboard — the Insurance Head's view of the whole
 * insurance vertical (the 58-section brief), one of the role dashboards picked
 * from the Dashboard dropdown (a system dashboard at /dashboard/<id>;
 * components/dashboards/system/centres.tsx decides who may open it).
 *
 * Read top to bottom: the headline strip; what needs action today
 * (priorities, attention, renewals due, issuance pending); the team and its
 * targets; the pipeline; then the analysis (lines, product, retention, lost
 * business, clients, corporate, claims, data quality) and the reviews.
 * Operations and claims are summarised and linked, never duplicated.
 *
 * Every definition is in lib/insurance/book.ts (what a line, "issued", "in
 * force", new vs renewal and a business owner are) and
 * lib/dashboard/insurance/window.ts (scope, filters, the base query). Loads
 * several sections share start once, here, as promises each section awaits —
 * nothing is fetched twice and every band still streams on its own; every
 * transaction goes through runLimit(4).
 */

import { Suspense, type ReactNode } from "react";
import { sql } from "drizzle-orm";

import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CardSkeleton } from "./DashboardSkeletons";
import { DashboardHeaderBar } from "./DashboardHeaderBar";
import { AppliedFilterChips, type AppliedFilter } from "./AppliedFilterChips";
import { FilterDisclosure } from "./FilterDisclosure";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { runLimit } from "@/lib/dashboard/run-limit";
import { leadSourceLabel } from "@/lib/leads/sources";
import { formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CLAIM_TYPE_LABEL, GROUP_LABEL, LINE_LABEL, POLICY_STATUS_LABEL, PRODUCT_GROUPS, STATUS_IN_FORCE, STATUS_LOST, STATUS_PENDING,
} from "@/lib/insurance/book";
import { insuranceAccess } from "@/lib/dashboard/insurance/access";
import { INS_PARAM_KEYS, istToday, parseInsFilter, parseInsPeriod } from "@/lib/dashboard/insurance/params";
import {
  CLAIM_GROUPS, fyLabelOf, fyStartOf, hasFilter, leadBase, leadWhere, num, polBase, polWhere, PREMIUM_BANDS, registerHref, yearBefore,
  type InsWindow, type Row, type Tx,
} from "@/lib/dashboard/insurance/window";
import { branchNames, byDim, loadBiz, loadTrend, pick, userNames } from "@/lib/dashboard/insurance/business";
import { loadAtRisk, loadRenewalBuckets, loadRenewalTimeline, loadRetention, retentionOf, type Retention } from "@/lib/dashboard/insurance/renewals";
import { RenewalTimelinePanel } from "./insurance/InsRenewalTimeline";
import { loadLost } from "@/lib/dashboard/insurance/lost";
import { loadBookCuts, loadNewClients } from "@/lib/dashboard/insurance/clients";
import { loadInsuranceProposals, loadIssuance, loadPipeline } from "@/lib/dashboard/insurance/pipeline";
import { loadClaimSnapshot, loadEscalations, loadOpenClaimsByInsurer } from "@/lib/dashboard/insurance/claims";
import { loadQuality } from "@/lib/dashboard/insurance/quality";
import { loadAnnualTargets, loadFyScorecard, loadTargetMeters, targetsComparable } from "@/lib/dashboard/insurance/targets";
import { loadMonthly, loadMoM, loadWeekly } from "@/lib/dashboard/insurance/review";
import { loadBranchGaps, loadRenewalAttention, type AttentionCard } from "@/lib/dashboard/insurance/attention";
import { loadInsurers, loadInsuranceTeam, loadMeetings, loadPeople } from "@/lib/dashboard/insurance/team";

import {
  AtRiskPanel, AttentionPanel, BookCuts, BranchPanel, ClaimSnapshotPanel, ConcentrationPanel,
  DrillSummary, FyScorecard, InsClientDrawer, InsFilters, InsQuickActions,
  InsTrend, InsurerPanel, IssuancePanel, KpiStrip, LinesPanel, LostPanel, MeetingsPanel, MomPanel, NewClientsPanel, PipelinePanel,
  PolicyCountPanel, PrioritiesPanel, QualityPanel, RenewalCommand, RetentionPanel,
  ReviewPanel, RmPanel, TargetsPanel, TeamPanel,
} from "./insurance";
import type { Priority } from "./insurance/InsTop";

/* ───────────────────────────── layout cells ───────────────────────────── */

/** The brief's MOBILE priority; from `lg` up every cell is `order-none` (the desktop rows). */
const ORDER = {
  priorities: "order-1", renewals: "order-2", atRisk: "order-3", pipeline: "order-4", lost: "order-5", strip: "order-6",
  targets: "order-7", issuance: "order-8", claims: "order-9", people: "order-10", clients: "order-11", rest: "order-12",
} as const;
type OrderKey = keyof typeof ORDER;

function Cell({ order, wide = true, id, children }: { order: OrderKey; wide?: boolean; id?: string; children: ReactNode }) {
  return <div id={id} className={cn(ORDER[order], "min-w-0 scroll-mt-40 lg:order-none", wide && "2xl:col-span-2")}>{children}</div>;
}
function Loading({ order, wide = true }: { order: OrderKey; wide?: boolean }) {
  return <Cell order={order} wide={wide}><CardSkeleton /></Cell>;
}

type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
type Hrefs = Record<string, string>;
/** A promise several bands await; the no-op catch keeps an unrendered band's failure from surfacing as unhandled. */
/** A firm / branch / RM target, or null where the filtered view is not what the target describes. */
function tgt(w: InsWindow, targets: Map<string, number>, key: string): number | null {
  return targetsComparable(w) ? targets.get(key) ?? null : null;
}

function share<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const IN_FORCE = STATUS_IN_FORCE.join(",");

export async function InsuranceCommandCentre({
  session, sp, basePath, claimsHref,
}: {
  session: SessionUser;
  sp: Record<string, string | string[] | undefined>;
  /** Where this dashboard lives (/dashboard/<id>) — every link it builds back to itself starts here. */
  basePath: string;
  /** The Claims Dashboard when the viewer may open it; else the claims scorecard is linked. */
  claimsHref: string | null;
}) {
  const now = new Date();
  const access = insuranceAccess(session);
  const filter = parseInsFilter(sp);
  const p = parseInsPeriod(sp, now);
  const today = istToday(now);
  const fyStart = fyStartOf(p.to);

  const limit = runLimit(4);
  const run: Run = (fn) =>
    limit(() => withTenant(session.tenantId, fn, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }));

  // Thresholds and the filter options — small, and the header needs them first.
  const [t, meta] = await run(async (tx) => {
    const th = await loadDashboardThresholds(tx);
    const branchName = access.scope.kind === "branch"
      ? ((await tx.execute(sql`
          SELECT name FROM branches WHERE tenant_id = ${session.tenantId}::uuid AND id = ${access.scope.branchId}::uuid
        `)).rows[0] as { name?: string } | undefined)?.name ?? null
      : null;
    const branches = access.scope.kind === "firm"
      ? (await tx.execute(sql`SELECT id::text AS id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name`)).rows as Array<{ id: string; name: string }>
      : null;
    const owners = (await tx.execute(sql`
      SELECT u.id::text AS id, u.name FROM users u
       WHERE u.tenant_id = ${session.tenantId}::uuid AND u.roles && ARRAY['owner', 'rm', 'branch_head', 'insurance_team']::text[]
         AND u.status <> 'offboarded'
         ${access.scope.kind === "branch" ? sql`AND u.branch_id = ${access.scope.branchId}::uuid` : sql``}
       ORDER BY u.name
    `)).rows as Array<{ id: string; name: string }>;
    const execs = (await tx.execute(sql`
      SELECT u.id::text AS id, u.name FROM users u
       WHERE u.tenant_id = ${session.tenantId}::uuid AND 'insurance_team' = ANY(u.roles) AND u.status <> 'offboarded'
       ORDER BY u.name
    `)).rows as Array<{ id: string; name: string }>;
    const insurers = (await tx.execute(sql`
      SELECT lower(btrim(insurer)) AS k, mode() WITHIN GROUP (ORDER BY btrim(insurer)) AS name
        FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid AND NULLIF(btrim(insurer), '') IS NOT NULL
       GROUP BY 1 ORDER BY 2 LIMIT 200
    `)).rows as Array<{ k: string; name: string }>;
    const sources = (await tx.execute(sql`
      SELECT DISTINCT l.source FROM leads l
       WHERE l.tenant_id = ${session.tenantId}::uuid AND l.converted_investor_id IN (SELECT investor_id FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid)
         AND l.source IS NOT NULL ORDER BY 1
    `)).rows as Array<{ source: string }>;
    // Industry and loss reason are free text: offer what the book actually holds.
    const industries = (await tx.execute(sql`
      SELECT lower(btrim(i.occupation)) AS k, mode() WITHIN GROUP (ORDER BY btrim(i.occupation)) AS name
        FROM insurance_policies p JOIN investors i ON i.id = p.investor_id
       WHERE p.tenant_id = ${session.tenantId}::uuid AND NULLIF(btrim(i.occupation), '') IS NOT NULL
       GROUP BY 1 ORDER BY 2 LIMIT 100
    `)).rows as Array<{ k: string; name: string }>;
    const lossReasons = (await tx.execute(sql`
      SELECT lower(btrim(lapse_reason)) AS k, mode() WITHIN GROUP (ORDER BY btrim(lapse_reason)) AS name
        FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid AND NULLIF(btrim(lapse_reason), '') IS NOT NULL
       GROUP BY 1 ORDER BY 2 LIMIT 100
    `)).rows as Array<{ k: string; name: string }>;
    return [th, { branchName, branches, owners, execs, insurers, sources: sources.map((s) => s.source), industries, lossReasons }] as const;
  });

  const w: InsWindow = {
    tenantId: session.tenantId, userId: session.userId, scope: access.scope, filter,
    from: p.from, to: p.to, periodLabel: p.label, prevFrom: p.prevFrom, prevTo: p.prevTo, prevLabel: p.prevLabel,
    fyStart, pyFrom: yearBefore(fyStart), pyTo: yearBefore(p.to), today, t,
  };
  const fyLabel = `FY ${fyLabelOf(p.to)}`;
  const pyLabel = `FY ${fyLabelOf(yearBefore(p.to))}`;

  /* ── URL state ──────────────────────────────────────────────────────── */
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "") base.set(k, v);
  base.delete("scope"); // left over from a /dashboard?scope=insurance link; means nothing here
  const at = (q: URLSearchParams, hash = "") => {
    const qs = q.toString();
    return `${basePath}${qs ? `?${qs}` : ""}${hash}`;
  };
  const hrefWith = (over: Record<string, string | null>, hash = "") => {
    const q = new URLSearchParams(base);
    for (const [k, v] of Object.entries(over)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    return at(q, hash);
  };
  const span = sp.tp === "mtd" || sp.tp === "qtd" || sp.tp === "fytd" ? sp.tp
    : p.period === "mtd" || p.period === "qtd" || p.period === "fytd" ? p.period : "fytd";
  const reviewMode = sp.rv === "weekly" ? "weekly" : "monthly";
  const reg = (extra: Record<string, string | undefined> = {}) => registerHref(w, extra);
  const booked = { booked_from: w.from, booked_to: w.to };
  const hrefs: Hrefs = {
    booked: reg({ ...booked, status: "issued" }),
    bookedNew: reg({ ...booked, status: "issued", nature: "new" }),
    bookedRenewal: reg({ ...booked, status: "issued", nature: "renewal" }),
    pending: reg({ status: STATUS_PENDING.join(",") }),
    proposed: reg({ status: "proposed" }),
    underwriting: reg({ status: "in_underwriting" }),
    lostRegister: reg({ status: STATUS_LOST.join(",") }),
    renewals: "/dashboard/insurance/renewals",
    renewalsDue: reg({ status: IN_FORCE, due_from: today, due_to: addDays(today, 30) }),
    "bucket:overdue": reg({ status: IN_FORCE, due_to: addDays(today, -1) }),
    "bucket:today": reg({ status: IN_FORCE, due_from: today, due_to: today }),
    "bucket:d7": reg({ status: IN_FORCE, due_from: addDays(today, 1), due_to: addDays(today, 7) }),
    "bucket:d15": reg({ status: IN_FORCE, due_from: addDays(today, 8), due_to: addDays(today, 15) }),
    "bucket:d30": reg({ status: IN_FORCE, due_from: addDays(today, 16), due_to: addDays(today, 30) }),
    "bucket:d60": reg({ status: IN_FORCE, due_from: addDays(today, 31), due_to: addDays(today, 60) }),
    retention: hrefWith({}, "#retention"),
    targets: hrefWith({}, "#targets"),
    quality: hrefWith({}, "#quality"),
    branchWise: hrefWith({}, "#branch-wise"),
    atRisk: hrefWith({}, "#at-risk"),
    lost: hrefWith({}, "#lost"),
    lostTable: hrefWith({}, "#lost-table"),
    newClients: hrefWith({}, "#new-clients"),
    claims: "/dashboard/insurance-claims",
    claimsList: "/dashboard/insurance-claims",
    // The Claims Dashboard when the viewer may open it; else the settlement scorecard.
    claimsDashboard: claimsHref ?? "/dashboard/insurance-claims/scorecard",
    open: "/dashboard/insurance-claims",
    settled: "/dashboard/insurance-claims?status=settled_fully",
    fnr: "/dashboard/insurance-claims?status=file_awaited",
    // "Claims needing attention" was removed from this dashboard (2026-10-01);
    // the Claims Dashboard's escalation centre is where those claims are worked.
    escalations: claimsHref ?? "/dashboard/insurance-claims",
    // Open insurance proposals — what loadInsuranceProposals counts.
    insProposals: "/dashboard/proposals?status=draft,ready,sent,viewed&type=insurance",
    leads: "/dashboard/leads",
    meetings: "/dashboard/review-meetings",
    clients: "/dashboard/investors",
    gapClients: "/dashboard/insurance/protection-gap",
    insOnly: reg({ mf: "no", status: IN_FORCE }),
    settingsTargets: "/dashboard/settings/targets#insurance",
    weekly: hrefWith({ rv: "weekly" }, "#review"),
    monthly: hrefWith({ rv: "monthly" }, "#review"),
    ...Object.fromEntries(PRODUCT_GROUPS.map((g) => [g.key, hrefWith({ grp: g.key })])),
    ...Object.fromEntries(PREMIUM_BANDS.map((b) => [`band:${b.key}`, hrefWith({ band: b.key })])),
  };
  const spanHrefs = { mtd: hrefWith({ tp: "mtd" }, "#targets"), qtd: hrefWith({ tp: "qtd" }, "#targets"), fytd: hrefWith({ tp: "fytd" }, "#targets") };

  /* ── loads several bands share ──────────────────────────────────────── */
  const shared = {
    branches: share(run((tx) => branchNames(tx, w))),
    pipeline: share(run((tx) => loadPipeline(tx, w))),
    lost: share(run((tx) => loadLost(tx, w, w.from, w.to))),
    buckets: share(run((tx) => loadRenewalBuckets(tx, w))),
    proposals: share(run((tx) => loadInsuranceProposals(tx, w))),
    issuance: share(run((tx) => loadIssuance(tx, w))),
    claims: share(run((tx) => loadClaimSnapshot(tx, w, w.from, w.to))),
    escalations: share(run((tx) => loadEscalations(tx, w))),
    quality: share(run((tx) => loadQuality(tx, w))),
    targets: share(run((tx) => loadAnnualTargets(tx, w))),
    ncCur: share(run((tx) => loadNewClients(tx, w, w.from, w.to))),
    ncFy: share(run((tx) => loadNewClients(tx, w, w.fyStart, w.to))),
  };

  /* ── header ─────────────────────────────────────────────────────────── */
  const nameOf = (list: Array<{ id: string; name: string }> | null, id?: string) => list?.find((x) => x.id === id)?.name ?? "—";
  const chips: AppliedFilter[] = [];
  if (filter.line) chips.push({ params: ["line"], label: "Business type", value: LINE_LABEL[filter.line] });
  if (filter.nature) chips.push({ params: ["nature"], label: "Nature", value: filter.nature === "new" ? "New business" : "Renewal" });
  if (filter.groups?.length) chips.push({ params: ["grp"], label: "Product", value: filter.groups.map((g) => GROUP_LABEL[g] ?? g).join(", ") });
  if (filter.branchId) chips.push({ params: ["branch"], label: "Branch", value: nameOf(meta.branches, filter.branchId) });
  if (filter.ownerId) chips.push({ params: ["rm"], label: "RM / owner", value: nameOf(meta.owners, filter.ownerId) });
  if (filter.execId) chips.push({ params: ["exec"], label: "Insurance executive", value: nameOf(meta.execs, filter.execId) });
  if (filter.insurer) chips.push({ params: ["insurer"], label: "Insurer", value: meta.insurers.find((i) => i.k === filter.insurer!.toLowerCase())?.name ?? filter.insurer });
  if (filter.categories?.length) chips.push({ params: ["cat"], label: "Category", value: filter.categories.map((c) => (c === "none" ? "Uncategorised" : c)).join(", ") });
  if (filter.clientType) chips.push({ params: ["ctype"], label: "Client type", value: filter.clientType });
  if (filter.mf) chips.push({ params: ["mf"], label: "MF relationship", value: filter.mf === "yes" ? "Existing MF client" : "Insurance-only" });
  if (filter.statuses?.length) chips.push({ params: ["pst"], label: "Policy status", value: filter.statuses.map((x) => POLICY_STATUS_LABEL[x] ?? x).join(", ") });
  if (filter.band) chips.push({ params: ["band"], label: "Premium band", value: PREMIUM_BANDS.find((b) => b.key === filter.band)?.label ?? filter.band });
  if (filter.source) chips.push({ params: ["src"], label: "Source", value: filter.source === "none" ? "Not recorded" : leadSourceLabel(filter.source) });
  if (filter.claimGroup) chips.push({ params: ["cst"], label: "Claim status", value: CLAIM_GROUPS.find((g) => g.key === filter.claimGroup)?.label ?? filter.claimGroup });
  if (filter.claimType) chips.push({ params: ["ctyp"], label: "Claim type", value: CLAIM_TYPE_LABEL[filter.claimType] ?? filter.claimType });
  if (filter.industry) chips.push({ params: ["ind"], label: "Industry", value: filter.industry === "none" ? "Not recorded" : meta.industries.find((x) => x.k === filter.industry!.toLowerCase())?.name ?? filter.industry });
  if (filter.lossReason) chips.push({ params: ["lr"], label: "Loss reason", value: filter.lossReason === "none" ? "Not recorded" : meta.lossReasons.find((x) => x.k === filter.lossReason!.toLowerCase())?.name ?? filter.lossReason });
  const resetHref = (() => {
    const q = new URLSearchParams(base);
    for (const k of INS_PARAM_KEYS) q.delete(k);
    return at(q);
  })();

  const canSetTargets = can(session.roles, "settings.dashboard", session.permissions) || session.roles.includes("owner");
  const canClient360 = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "investor.view.assigned", session.permissions);

  return (
    <div className="max-w-screen-2xl space-y-6">
      {/* One row: actions · period · Filters — pinned under the top bar on
          desktop. The fifteen filters fold behind "Filters"; what is applied
          still shows as chips below. */}
      <div className="dash-toolbar space-y-2.5 border-b border-border bg-background pb-3 lg:sticky lg:top-16 lg:z-30 lg:pt-3">
        <FilterDisclosure
          keys={INS_PARAM_KEYS}
          start={
            <InsQuickActions
              can={{ lead: access.canLead, meeting: access.canMeeting, proposal: access.canProposal, policy: access.canWritePolicy, task: access.canTask, claims: access.canClaims }}
              hrefs={hrefs} />
          }
          leading={<DashboardHeaderBar period={p.period} currentLabel={p.label} variant="light" />}
        >
        <InsFilters
          branches={meta.branches ? meta.branches.map((b) => ({ value: b.id, label: b.name })) : null}
          owners={meta.owners.map((o) => ({ value: o.id, label: o.name }))}
          execs={meta.execs.map((o) => ({ value: o.id, label: o.name }))}
          groups={PRODUCT_GROUPS.map((g) => ({ value: g.key, label: `${g.label} (${g.line === "personal" ? "Personal" : "Commercial"})` }))}
          insurers={meta.insurers.map((i) => ({ value: i.k, label: i.name }))}
          sources={[...meta.sources.map((s) => ({ value: s, label: leadSourceLabel(s) })), { value: "none", label: "Source not recorded" }]}
          industries={meta.industries.length ? [...meta.industries.map((x) => ({ value: x.k, label: x.name })), { value: "none", label: "Industry not recorded" }] : []}
          lossReasons={meta.lossReasons.length ? [...meta.lossReasons.map((x) => ({ value: x.k, label: x.name })), { value: "none", label: "Reason not recorded" }] : []}
          statuses={Object.entries(POLICY_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          bands={PREMIUM_BANDS.map((b) => ({ value: b.key, label: b.label }))}
          claimGroups={CLAIM_GROUPS.map((g) => ({ value: g.key, label: g.label }))}
          claimTypes={Object.entries(CLAIM_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          resetHref={resetHref}
          active={hasFilter(w)}
        />
        </FilterDisclosure>
        <AppliedFilterChips periodLabel={p.label} filters={chips} resetHref={resetHref} showReset={hasFilter(w)} />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2">
        {/* One branch or person, when filtered · §47–48 */}
        {(filter.branchId || filter.ownerId || access.scope.kind === "branch") && (
          <Suspense fallback={<Loading order="people" />}>
            <DrillBand run={run} w={w} shared={shared} meta={meta} hrefs={hrefs} />
          </Suspense>
        )}
        {/* The headline · §1 */}
        <Suspense fallback={<Loading order="strip" />}>
          <StripBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        {/* Today · §46 priorities */}
        <Suspense fallback={<Loading order="priorities" />}>
          <PrioritiesBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        {/* Today · §45 attention */}
        <Suspense fallback={<Loading order="rest" />}>
          <AttentionBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        {/* Today · §14–15 renewals */}
        <Suspense fallback={<Loading order="renewals" />}>
          <RenewalBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        {/* Today · §31–32 issuance pending, then §28–30, §41 the book */}
        <Suspense fallback={<Loading order="issuance" />}>
          <IssuanceBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        <Suspense fallback={<Loading order="rest" />}>
          <BookBand run={run} w={w} shared={shared} hrefs={hrefs} hrefWith={hrefWith} />
        </Suspense>
        {/* The team · §9–10, then §11, §25 */}
        <Suspense fallback={<Loading order="people" />}>
          <PeopleBand run={run} w={w} hrefWith={hrefWith} />
        </Suspense>
        <Suspense fallback={<Loading order="rest" />}>
          <TeamBand run={run} w={w} hrefs={hrefs} />
        </Suspense>
        {/* Targets and trend · §2 + §8 */}
        <Suspense fallback={<Loading order="rest" wide={false} />}>
          <TrendBand run={run} w={w} fyLabel={fyLabel} pyLabel={pyLabel} />
        </Suspense>
        <Suspense fallback={<Loading order="targets" wide={false} />}>
          <TargetsBand run={run} w={w} span={span} spanHrefs={spanHrefs} hrefs={hrefs} canSet={canSetTargets} />
        </Suspense>
        {/* Pipeline · §12–13 */}
        <Suspense fallback={<Loading order="pipeline" />}>
          <PipelineBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        {/* Analysis · §5, then §3–4 */}
        <Suspense fallback={<Loading order="rest" />}>
          <LinesBand run={run} w={w} shared={shared} hrefWith={hrefWith} />
        </Suspense>
        <Suspense fallback={<Loading order="rest" />}>
          <CompareBand run={run} w={w} hrefs={hrefs} />
        </Suspense>
        {/* Analysis · §16–17 retention */}
        <Suspense fallback={<Loading order="atRisk" />}>
          <RetentionBand run={run} w={w} shared={shared} hrefs={hrefs} fyLabel={fyLabel} pyLabel={pyLabel} />
        </Suspense>
        {/* Analysis · §18–19 lost business */}
        <Suspense fallback={<Loading order="lost" />}>
          <LostBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        {/* Analysis · §20–21, then §22–24 / §40 clients */}
        <Suspense fallback={<Loading order="clients" />}>
          <ClientsBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        <Suspense fallback={<Loading order="rest" />}>
          <CoverageBand run={run} w={w} hrefs={hrefs} />
        </Suspense>
        {/* Analysis · §33–37 claims */}
        <Suspense fallback={<Loading order="claims" />}>
          <ClaimsBand run={run} w={w} shared={shared} hrefs={hrefs} />
        </Suspense>
        {/* Analysis · §38–39 data quality */}
        <Suspense fallback={<Loading order="rest" />}>
          <QualityBand run={run} w={w} shared={shared} hrefWith={hrefWith} />
        </Suspense>
        {/* Reviews · §42–43 */}
        <Suspense fallback={<Loading order="rest" />}>
          <ReviewBand run={run} w={w} shared={shared} hrefs={hrefs} mode={reviewMode} />
        </Suspense>
        {/* Reviews · §44 FY */}
        <Suspense fallback={<Loading order="rest" />}>
          <FyBand run={run} w={w} fyLabel={fyLabel} />
        </Suspense>
      </div>
      <InsClientDrawer canSeeClient360={canClient360} />
    </div>
  );
}

/* ───────────────────────────── bands ───────────────────────────── */

type Shared = {
  branches: Promise<Map<string, string>>;
  pipeline: ReturnType<typeof loadPipeline>;
  lost: ReturnType<typeof loadLost>;
  buckets: ReturnType<typeof loadRenewalBuckets>;
  proposals: ReturnType<typeof loadInsuranceProposals>;
  issuance: ReturnType<typeof loadIssuance>;
  claims: ReturnType<typeof loadClaimSnapshot>;
  escalations: ReturnType<typeof loadEscalations>;
  quality: ReturnType<typeof loadQuality>;
  targets: ReturnType<typeof loadAnnualTargets>;
  ncCur: ReturnType<typeof loadNewClients>;
  ncFy: ReturnType<typeof loadNewClients>;
};
type BandProps = { run: Run; w: InsWindow; shared: Shared; hrefs: Hrefs };

async function namesFor(run: Run, ids: Array<string | null | undefined>) {
  const m = await run((tx) => userNames(tx, ids));
  return new Map([...m.entries()].map(([k, v]) => [k, v.name]));
}

async function PrioritiesBand({ run, w, shared, hrefs }: BandProps) {
  const [buckets, proposals, issuance, lost, esc, quality] = await Promise.all([
    shared.buckets, shared.proposals, shared.issuance, shared.lost, shared.escalations, shared.quality,
  ]);
  const [gaps, corporate] = await run(async (tx) => [
    await loadBranchGaps(tx, w),
    ((await tx.execute(sql`
      WITH ld AS (${leadBase(w)})
      SELECT COUNT(*)::int AS n FROM ld WHERE ${leadWhere(w, "ld")} AND ld.lead_type = 'corporate'
         AND ld.stage NOT IN ('issued', 'lost') AND ld.next_follow_up_at IS NOT NULL
         AND (ld.next_follow_up_at AT TIME ZONE 'Asia/Kolkata')::date <= ${w.today}::date
    `)).rows[0] as Row | undefined),
  ] as const);
  const b = (k: string) => buckets.buckets.find((x) => x.key === k)!;
  const gapCount = Object.values(quality.counts).reduce((a, n) => a + n, 0);
  const items: Priority[] = [
    { key: "today", label: "Renewals due today", count: b("today").count, amount: b("today").premium, href: hrefs["bucket:today"], tone: "warn" },
    { key: "overdue", label: "Renewals overdue", count: b("overdue").count, amount: b("overdue").premium, href: hrefs["bucket:overdue"], tone: "bad" },
    { key: "d7", label: "Renewals due in the next 7 days", count: b("d7").count, amount: b("d7").premium, href: hrefs["bucket:d7"], tone: "warn" },
    { key: "proposals", label: "High-value proposals pending", count: proposals.large, amount: proposals.largePremium, href: hrefs.insProposals, tone: "warn" },
    { key: "issuance", label: "Policy issuance delayed", count: issuance.breached, amount: null, href: hrefs.pending, tone: "bad" },
    { key: "lost", label: "Lost / cancelled this period", count: lost.count, amount: lost.premium, href: hrefs.lostTable, tone: "bad" },
    { key: "claims", label: "Claims needing escalation", count: esc.total, amount: null, href: hrefs.escalations, tone: "bad" },
    { key: "targets", label: "Branches behind their insurance target", count: gaps.length, amount: gaps.reduce((a, g) => a + (g.expected - g.actual), 0), href: hrefs.targets, tone: "warn" },
    { key: "corporate", label: "Corporate follow-ups due", count: num(corporate?.n), amount: null, href: hrefs.leads, tone: "warn" },
    { key: "data", label: "Insurance data missing", count: gapCount, amount: null, href: hrefs.quality, tone: "warn" },
  ];
  const dateLabel = formatDate(w.today, "weekday");
  return <Cell order="priorities" id="priorities"><PrioritiesPanel items={items} dateLabel={dateLabel} /></Cell>;
}

async function DrillBand({ run, w, shared, meta, hrefs }: BandProps & { meta: { branches: Array<{ id: string; name: string }> | null; owners: Array<{ id: string; name: string }>; branchName: string | null } }) {
  const kind: "branch" | "rm" = w.filter.ownerId ? "rm" : "branch";
  const [biz, nc, lost, claims, buckets, proposals] = await Promise.all([
    run((tx) => loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }])),
    shared.ncCur, shared.lost, shared.claims, shared.buckets, shared.proposals,
  ]);
  const [ret, meetings, book] = await run(async (tx) => [
    await loadRetention(tx, w, w.fyStart, w.to),
    await loadMeetings(tx, w),
    ((await tx.execute(sql`
      WITH pol AS (${polBase(w)})
      SELECT COUNT(DISTINCT investor_id)::int AS clients, COUNT(*)::int AS policies FROM pol
       WHERE ${polWhere(w, { nature: false, status: false }, "pol")} AND status IN ('active', 'claim_filed', 'claim_settled')
    `)).rows[0] as Row | undefined),
  ] as const);
  const m = pick(biz, "cur");
  const due30 = buckets.buckets.filter((x) => ["today", "d7", "d15", "d30"].includes(x.key)).reduce((a, x) => a + x.count, 0) + (buckets.buckets.find((x) => x.key === "overdue")?.count ?? 0);
  const name = kind === "rm"
    ? meta.owners.find((o) => o.id === w.filter.ownerId)?.name ?? "RM"
    : meta.branches?.find((b) => b.id === w.filter.branchId)?.name ?? meta.branchName ?? "Branch";
  const facts = kind === "branch" ? [
    { label: "Total premium", value: m.total, format: "currency" as const, href: hrefs.booked },
    { label: "New business", value: m.newAmt, format: "currency" as const, href: hrefs.bookedNew },
    { label: "Renewal", value: m.renAmt, format: "currency" as const, href: hrefs.bookedRenewal },
    { label: "Policy count", value: m.policies, format: "count" as const, href: hrefs.booked },
    { label: "New clients", value: nc.total, format: "count" as const, href: hrefs.newClients },
    { label: "Renewal % (FY)", value: retentionOf(ret)?.policyPct ?? null, format: "percent" as const, href: hrefs.retention },
    { label: "Lost business", value: lost.premium, format: "currency" as const, href: hrefs.lostTable, tone: lost.count ? "bad" as const : undefined },
    { label: "Meetings", value: meetings.total, format: "count" as const, href: hrefs.meetings },
    { label: "Open claims", value: claims.all.open, format: "count" as const, href: hrefs.claims },
  ] : [
    { label: "Insurance clients", value: num(book?.clients), format: "count" as const, href: hrefs.renewalsDue },
    { label: "Policies in force", value: num(book?.policies), format: "count" as const, href: hrefs.renewalsDue },
    { label: "New premium", value: m.newAmt, format: "currency" as const, href: hrefs.bookedNew },
    { label: "Renewal premium", value: m.renAmt, format: "currency" as const, href: hrefs.bookedRenewal },
    { label: "Renewal due (30 d + overdue)", value: due30, format: "count" as const, href: hrefs.renewalsDue, tone: due30 ? "warn" as const : undefined },
    { label: "New clients", value: nc.total, format: "count" as const, href: hrefs.newClients },
    { label: "Meetings", value: meetings.total, format: "count" as const, href: hrefs.meetings },
    { label: "Lost business", value: lost.premium, format: "currency" as const, href: hrefs.lostTable, tone: lost.count ? "bad" as const : undefined },
    { label: "Open claims", value: claims.all.open, format: "count" as const, href: hrefs.claims },
    { label: "Pending proposals", value: proposals.open, format: "count" as const, href: hrefs.insProposals },
  ];
  return <Cell order="people"><DrillSummary kind={kind} name={name} facts={facts} /></Cell>;
}

async function StripBand({ run, w, shared, hrefs }: BandProps) {
  const [biz, targets, ncCur, ncFy, lost, claims] = await Promise.all([
    run((tx) => loadBiz(tx, w, [
      { k: "cur", from: w.from, to: w.to }, { k: "prev", from: w.prevFrom, to: w.prevTo }, { k: "fy", from: w.fyStart, to: w.to },
    ])),
    shared.targets, shared.ncCur, shared.ncFy, shared.lost, shared.claims,
  ]);
  const ret = await run((tx) => loadRetention(tx, w, w.from, w.to));
  const r = retentionOf(ret);
  return (
    <Cell order="strip">
      <KpiStrip d={{
        periodLabel: w.periodLabel, prevLabel: w.prevLabel,
        cur: pick(biz, "cur"), prev: pick(biz, "prev"), fy: pick(biz, "fy"),
        targets: {
          newAmt: tgt(w, targets, "insurance_new"), renAmt: tgt(w, targets, "insurance_renewal"), newClients: tgt(w, targets, "insurance_new_clients"),
          missing: targetsComparable(w) ? "Not set" : "Not for a filtered view",
        },
        retention: r ? { due: r.due, renewed: r.renewed, policyPct: r.policyPct, premiumPct: r.premiumPct, duePremium: r.duePremium, renewedPremium: r.renewedPremium } : null,
        newClients: { cur: ncCur.total, fy: ncFy.total },
        lost: { count: lost.count, premium: lost.premium },
        claims: { open: claims.all.open, outstanding: claims.all.outstanding },
        hrefs,
      }} />
    </Cell>
  );
}

async function TrendBand({ run, w, fyLabel, pyLabel }: { run: Run; w: InsWindow; fyLabel: string; pyLabel: string }) {
  const points = await run((tx) => loadTrend(tx, w));
  return <Cell order="rest" wide={false} id="trend"><InsTrend points={points} fyLabel={fyLabel} pyLabel={pyLabel} lockedLine={w.filter.line ?? null} /></Cell>;
}

async function TargetsBand({ run, w, span, spanHrefs, hrefs, canSet }: { run: Run; w: InsWindow; span: "mtd" | "qtd" | "fytd"; spanHrefs: Record<string, string>; hrefs: Hrefs; canSet: boolean }) {
  const t = await run((tx) => loadTargetMeters(tx, w, span));
  return (
    <Cell order="targets" wide={false} id="targets">
      <TargetsPanel span={span} meters={t.meters} spanHrefs={spanHrefs} settingsHref={hrefs.settingsTargets} href={hrefs.booked} canSet={canSet} />
    </Cell>
  );
}

async function LinesBand({ run, w, shared, hrefWith }: { run: Run; w: InsWindow; shared: Shared; hrefWith: (o: Record<string, string | null>, h?: string) => string }) {
  const [biz, lost, nc] = await Promise.all([
    run((tx) => loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }], ["line"])),
    shared.lost, shared.ncCur,
  ]);
  const ret = await run((tx) => loadRetention(tx, w, w.fyStart, w.to, "line"));
  const lineOfGroup = new Map<string, string>(PRODUCT_GROUPS.map((g) => [g.key, g.line]));
  const lostBy = (line: string) => lost.byGroup.filter((g) => lineOfGroup.get(g.key ?? "") === line).reduce((a, g) => a + g.premium, 0);
  const cards = (["personal", "commercial"] as const).map((k) => ({
    key: k, label: LINE_LABEL[k], money: pick(biz, "cur", (r) => r.d.line === k),
    policyPct: retentionOf(ret, k)?.policyPct ?? null,
    lostPremium: lostBy(k),
    newClients: k === "personal" ? nc.personal : nc.commercial,
    href: w.filter.line === k ? hrefWith({ line: null }) : hrefWith({ line: k }),
    recordsHref: registerHref({ ...w, filter: { ...w.filter, line: k } }, { booked_from: w.from, booked_to: w.to, status: "issued" }),
    active: w.filter.line === k,
    filteredOut: !!w.filter.line && w.filter.line !== k,
  }));
  return <Cell order="rest" id="lines"><LinesPanel cards={cards} /></Cell>;
}

async function CompareBand({ run, w, hrefs }: { run: Run; w: InsWindow; hrefs: Hrefs }) {
  const mom = await run((tx) => loadMoM(tx, w));
  return (
    <Cell order="rest" id="mom">
      <MomPanel c={mom} hrefs={{ total: hrefs.booked, new: hrefs.bookedNew, renewal: hrefs.bookedRenewal, lost: hrefs.lostTable, clients: hrefs.newClients }} />
    </Cell>
  );
}

async function PeopleBand({ run, w, hrefWith }: { run: Run; w: InsWindow; hrefWith: (o: Record<string, string | null>, h?: string) => string }) {
  const { branches, rms } = await run((tx) => loadPeople(tx, w));
  return (
    <>
      <Cell order="people" wide={false} id="branch-wise">
        <BranchPanel rows={branches} periodLabel={w.periodLabel} hrefFor={(id) => hrefWith({ branch: id }, "#rm-wise")} />
      </Cell>
      <Cell order="people" wide={false} id="rm-wise">
        <RmPanel rows={rms} periodLabel={w.periodLabel} hrefFor={(id) => hrefWith({ rm: id }, "#rm-wise")} />
      </Cell>
    </>
  );
}

async function TeamBand({ run, w, hrefs }: { run: Run; w: InsWindow; hrefs: Hrefs }) {
  const [team, meetings] = await run(async (tx) => [await loadInsuranceTeam(tx, w), await loadMeetings(tx, w)] as const);
  return (
    <>
      <Cell order="rest" wide={false} id="team"><TeamPanel rows={team} periodLabel={w.periodLabel} /></Cell>
      <Cell order="rest" wide={false} id="meetings"><MeetingsPanel m={meetings} periodLabel={w.periodLabel} href={hrefs.meetings} /></Cell>
    </>
  );
}

async function PipelineBand({ run, shared, hrefs }: BandProps) {
  const p = await shared.pipeline;
  const names = await namesFor(run, p.rows.map((r) => r.ownerId));
  return <Cell order="pipeline" id="pipeline"><PipelinePanel p={p} names={names} /></Cell>;
}

async function RenewalBand({ run, w, shared, hrefs }: BandProps) {
  const [b, timeline] = await Promise.all([shared.buckets, run((tx) => loadRenewalTimeline(tx, w))]);
  return (
    <Cell order="renewals" id="renewals">
      <div className="space-y-4">
        <RenewalCommand buckets={b.buckets} pastGrace={b.pastGrace} hrefs={hrefs} />
        <RenewalTimelinePanel rows={timeline.rows} total={timeline.total} />
      </div>
    </Cell>
  );
}

async function RetentionBand({ run, w, hrefs, fyLabel, pyLabel }: BandProps & { fyLabel: string; pyLabel: string }) {
  const monthFrom = `${w.today.slice(0, 8)}01`;
  const pyStart = `${Number(w.fyStart.slice(0, 4)) - 1}-04-01`;
  const pyEnd = `${w.fyStart.slice(0, 4)}-03-31`;
  const [month, fy, py, byLine, byGrp, byBranch, byOwner, risk, branches] = await run(async (tx) => [
    await loadRetention(tx, w, monthFrom, w.today),
    await loadRetention(tx, w, w.fyStart, w.today),
    await loadRetention(tx, w, pyStart, pyEnd),
    await loadRetention(tx, w, w.fyStart, w.today, "line"),
    await loadRetention(tx, w, w.fyStart, w.today, "grp"),
    await loadRetention(tx, w, w.fyStart, w.today, "branch"),
    await loadRetention(tx, w, w.fyStart, w.today, "owner"),
    await loadAtRisk(tx, w),
    await branchNames(tx, w),
  ] as const);
  const ownerNames = await namesFor(run, [...byOwner.map((r) => r.key), ...risk.rows.map((r) => r.ownerId)]);
  const rows = (xs: Retention[], label: (k: string | null) => string) => xs.filter((x) => x.due > 0).sort((a, b) => b.due - a.due).slice(0, 8).map((r) => ({ label: label(r.key), r }));
  return (
    <>
      <Cell order="rest" wide={false} id="retention">
        <RetentionPanel v={{
          month: retentionOf(month), fy: retentionOf(fy), py: retentionOf(py),
          labels: { month: "This month", fy: `${fyLabel} to date`, py: pyLabel },
          breakdowns: [
            { key: "line", label: "line", rows: rows(byLine, (k) => LINE_LABEL[k ?? ""] ?? "Type not recognised") },
            { key: "grp", label: "product", rows: rows(byGrp, (k) => GROUP_LABEL[k ?? ""] ?? "Type not recognised") },
            { key: "branch", label: "branch", rows: rows(byBranch, (k) => (k ? branches.get(k) ?? "Branch" : "No branch recorded")) },
            { key: "owner", label: "RM", rows: rows(byOwner, (k) => (k ? ownerNames.get(k) ?? "Former user" : "Owner missing")) },
          ],
        }} />
      </Cell>
      <Cell order="atRisk" wide={false} id="at-risk"><AtRiskPanel rows={risk.rows} total={risk.total} names={ownerNames} hrefs={hrefs} /></Cell>
    </>
  );
}

async function LostBand({ run, w, shared, hrefs }: BandProps) {
  const [d, branches] = await Promise.all([shared.lost, shared.branches]);
  const names = await namesFor(run, [...d.byOwner.map((x) => x.key), ...d.rows.map((r) => r.ownerId)]);
  return <Cell order="lost" id="lost"><LostPanel d={d} periodLabel={w.periodLabel} names={names} branches={branches} hrefs={hrefs} /></Cell>;
}

async function ClientsBand({ w, shared, hrefs }: BandProps) {
  const [cur, fy, targets] = await Promise.all([shared.ncCur, shared.ncFy, shared.targets]);
  return (
    <Cell order="clients" id="new-clients">
      <NewClientsPanel cur={cur} fy={fy} target={tgt(w, targets, "insurance_new_clients")}
        targetNote={targetsComparable(w) ? "No target set — Settings → Targets → Insurance targets." : "Targets are for the whole book — clear the line, product and client filters to compare."}
        hrefs={hrefs} periodLabel={w.periodLabel} lockedLine={w.filter.line ?? null} />
    </Cell>
  );
}

async function CoverageBand({ run, w, hrefs }: { run: Run; w: InsWindow; hrefs: Hrefs }) {
  const cuts = await run((tx) => loadBookCuts(tx, w));
  return <Cell order="rest" id="book-cuts"><BookCuts byCategory={cuts.byCategory} byType={cuts.byType} lockedLine={w.filter.line ?? null} /></Cell>;
}

async function IssuanceBand({ run, w, shared, hrefs }: BandProps) {
  const [d, lost, biz] = await Promise.all([
    shared.issuance, shared.lost,
    run((tx) => loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }])),
  ]);
  const names = await namesFor(run, d.rows.flatMap((r) => [r.ownerId, r.opsId]));
  const m = pick(biz, "cur");
  return (
    <Cell order="issuance" id="issuance">
      <IssuancePanel d={d} issued={{ count: m.policies, premium: m.total }} cancelledBeforeIssue={lost.newBiz} names={names} hrefs={hrefs}
        slaDays={w.t.insIssuanceSlaDays} highPremium={w.t.insHighPremium} />
    </Cell>
  );
}

async function BookBand({ run, w, shared, hrefs, hrefWith }: BandProps & { hrefWith: (o: Record<string, string | null>, h?: string) => string }) {
  const [openClaims, buckets, issuance, lost, branches] = await Promise.all([
    run((tx) => loadOpenClaimsByInsurer(tx, w)), shared.buckets, shared.issuance, shared.lost, shared.branches,
  ]);
  const [insurers, biz] = await run(async (tx) => [
    await loadInsurers(tx, w, openClaims),
    await loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }]),
  ] as const);
  const conc = await run((tx) => loadBiz(tx, w, [{ k: "cur", from: w.from, to: w.to }], ["grp", "branch", "source", "investor", "ctype"]));
  const total = pick(biz, "cur");
  const top = (dim: "grp" | "branch" | "source", label: (k: string | null) => string) => {
    const m = byDim(conc, "cur", dim);
    return [...m.entries()].map(([k, v]) => ({ label: label(k), premium: v.total })).filter((r) => r.premium > 0).sort((a, b) => b.premium - a.premium).slice(0, 5);
  };
  const corp = new Map<string, number>();
  for (const r of conc) if (r.d.ctype === "corporate" && r.d.investor) corp.set(r.d.investor, (corp.get(r.d.investor) ?? 0) + r.newAmt + r.renAmt);
  const corpNames = corp.size ? await run(async (tx) => new Map(((await tx.execute(sql`
    SELECT id::text AS id, name FROM investors WHERE id IN (${sql.join([...corp.keys()].map((k) => sql`${k}::uuid`), sql`, `)})
  `)).rows as Row[]).map((r) => [String(r.id), String(r.name)]))) : new Map<string, string>();
  const blocks = [
    { title: "Top products", rows: top("grp", (k) => GROUP_LABEL[k ?? ""] ?? "Type not recognised"), total: total.total },
    { title: "Top branches", rows: top("branch", (k) => (k ? branches.get(k) ?? "Branch" : "No branch recorded")), total: total.total },
    { title: "Top sources", rows: top("source", (k) => (k ? leadSourceLabel(k) : "Source not recorded")), total: total.total },
    { title: "Top corporate clients", rows: [...corp.entries()].map(([k, v]) => ({ label: corpNames.get(k) ?? "Corporate", premium: v })).sort((a, b) => b.premium - a.premium).slice(0, 5), total: total.total },
    { title: "Premium by insurer", rows: insurers.filter((i) => i.money.total > 0).slice(0, 5).map((i) => ({ label: i.name, premium: i.money.total })), total: total.total },
  ];
  const pastGrace = buckets.pastGrace.count;
  return (
    <>
      <Cell order="rest" id="insurers"><InsurerPanel rows={insurers} periodLabel={w.periodLabel} hrefFor={(k) => hrefWith({ insurer: k })} /></Cell>
      <Cell order="rest" id="policy-count">
        <PolicyCountPanel periodLabel={w.periodLabel} hrefs={hrefs}
          v={{ newN: total.newN, renN: total.renN, total: total.policies, cancelled: lost.count, pastGrace, pending: issuance.proposed.count + issuance.underwriting.count }} />
      </Cell>
      <Cell order="rest" id="concentration"><ConcentrationPanel blocks={blocks} /></Cell>
    </>
  );
}

async function ClaimsBand({ run, w, shared, hrefs }: BandProps) {
  const snap = await shared.claims;
  return <Cell order="claims" id="claims"><ClaimSnapshotPanel s={snap} periodLabel={w.periodLabel} slaDays={w.t.claimSlaDays} hrefs={hrefs} lockedLine={w.filter.line ?? null} /></Cell>;
}

async function QualityBand({ run, w, shared, hrefWith }: { run: Run; w: InsWindow; shared: Shared; hrefWith: (o: Record<string, string | null>, h?: string) => string }) {
  const [q, branches] = await Promise.all([shared.quality, shared.branches]);
  const names = await namesFor(run, q.byOwner.map((o) => o.key));
  return (
    <Cell order="rest" id="quality">
      <QualityPanel q={q} names={names} branches={branches}
        hrefFor={(gap) => registerHref(w, { gap, status: [...STATUS_IN_FORCE, ...STATUS_PENDING].join(",") })}
        branchHref={(id) => hrefWith({ branch: id }, "#quality")} ownerHref={(id) => hrefWith({ rm: id }, "#quality")} />
    </Cell>
  );
}

async function AttentionBand({ run, w, shared, hrefs }: BandProps) {
  const [proposals, issuance, lost, claims, quality] = await Promise.all([shared.proposals, shared.issuance, shared.lost, shared.claims, shared.quality]);
  const [ren, gaps] = await run(async (tx) => [await loadRenewalAttention(tx, w), await loadBranchGaps(tx, w)] as const);
  const pendingLarge = issuance.rows.filter((r) => r.highPremium);
  const gapPolicies = Object.values(quality.counts).reduce((a, n) => a + n, 0);
  const cards: AttentionCard[] = [
    { key: "d7", label: "Renewal due within 7 days — not yet renewed", count: ren.due7.count, amount: ren.due7.premium, oldestDays: null, owner: ren.due7.owner,
      definition: "In force, due today to 7 days out, not marked renewed.", href: hrefs["bucket:d7"], tone: "warn" },
    { key: "overdue", label: "Overdue renewal", count: ren.overdue.count, amount: ren.overdue.premium, oldestDays: ren.overdue.oldest, owner: ren.overdue.owner,
      definition: "Renewal date passed, not marked renewed.", href: hrefs["bucket:overdue"], tone: "bad" },
    { key: "highrisk", label: "High-premium renewal at risk", count: ren.highRisk.count, amount: ren.highRisk.premium, oldestDays: ren.highRisk.oldest, owner: ren.highRisk.owner,
      definition: "Due within 30 days or overdue, high premium, no client contact in 30 days.", href: hrefs.atRisk, tone: "bad" },
    { key: "lost", label: "Lost business", count: lost.count, amount: lost.premium, oldestDays: null, owner: null,
      definition: `Lapsed, surrendered or cancelled in ${w.periodLabel}.`, href: hrefs.lostTable, tone: "bad" },
    { key: "large", label: "Large proposal pending", count: proposals.large + pendingLarge.length, amount: proposals.largePremium + pendingLarge.reduce((a, r) => a + r.premium, 0),
      oldestDays: null, owner: null, definition: "Open insurance proposals and policies awaiting issue at or above the high-premium threshold.", href: hrefs.pending, tone: "warn" },
    { key: "aged", label: "Proposal ageing past threshold", count: proposals.aged, amount: proposals.agedPremium, oldestDays: proposals.oldestDays, owner: null,
      definition: `Open insurance proposals older than ${w.t.proposalAgeingDays} days.`, href: "/dashboard/proposals?tab=sent", tone: "warn" },
    { key: "issuance", label: "Policy issuance delayed", count: issuance.breached, amount: issuance.rows.filter((r) => r.slaBreached).reduce((a, r) => a + r.premium, 0),
      oldestDays: issuance.rows.reduce((m, r) => Math.max(m, r.slaBreached ? r.ageDays : 0), 0) || null, owner: null,
      definition: `Proposed or in underwriting for more than ${w.t.insIssuanceSlaDays} days.`, href: hrefs.pending, tone: "bad" },
    { key: "sla", label: "Claims past SLA", count: claims.all.pastSla, amount: null, oldestDays: null, owner: null,
      definition: `Open more than ${w.t.claimSlaDays} days from intimation.`, href: hrefs.escalations, tone: "bad" },
    { key: "fnr", label: "Claim file not received", count: claims.all.fnr, amount: null, oldestDays: null, owner: null,
      definition: "Claim intimated, file awaited.", href: hrefs.fnr, tone: "bad" },
    { key: "data", label: "Insurance data missing", count: gapPolicies, amount: null, oldestDays: null, owner: null,
      definition: "Required fields blank on in-force or pending policies.", href: hrefs.quality, tone: "warn" },
    { key: "branch", label: "Branch below target", count: gaps.length, amount: gaps.reduce((a, g) => a + Math.max(0, g.expected - g.actual), 0), oldestDays: null,
      owner: gaps[0]?.name ?? null, definition: `Behind the FY insurance target at today's pace, below the ${formatPercent(w.t.targetNearFraction * 100, 0)} near band.`,
      href: hrefs.branchWise, tone: "warn" },
  ];
  return <Cell order="rest" id="attention"><AttentionPanel cards={cards} /></Cell>;
}

async function ReviewBand({ run, w, shared, hrefs, mode }: BandProps & { mode: "weekly" | "monthly" }) {
  const [proposals, claims, quality] = await Promise.all([shared.proposals, shared.claims, shared.quality]);
  const c = await run((tx) => (mode === "weekly" ? loadWeekly(tx, w, { proposals: proposals.open, claims: claims.all.open }) : loadMonthly(tx, w)));
  return (
    <Cell order="rest" id="review">
      <ReviewPanel mode={mode} c={c} hrefs={hrefs} qualityPct={quality.pct == null ? "—" : formatPercent(quality.pct * 100, 1)} />
    </Cell>
  );
}

async function FyBand({ run, w, fyLabel }: { run: Run; w: InsWindow; fyLabel: string }) {
  const s = await run((tx) => loadFyScorecard(tx, w));
  return <Cell order="rest" id="fy"><FyScorecard rows={s.rows} fyLabel={fyLabel} comparable={s.comparable} /></Cell>;
}
