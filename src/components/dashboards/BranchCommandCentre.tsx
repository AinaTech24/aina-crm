/**
 * Branch Business Command Centre — the branch head's operating system.
 *
 * ── One page, three questions, in this order ─────────────────────────────────
 *
 *   Is the branch on target?        KPI strip, target meters, FY scorecard
 *   Which RM, on which metric?      scoreboard, target matrix, RM tables
 *   What needs me today?            attention centre, exception desks
 *
 * Every figure follows the brief's drill-down: branch → RM (the one-on-one
 * view, `?rm=`) → client (the lists and priority tables) → the record itself.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────
 *
 * The PAGE decides which branch this is and whether the viewer may choose
 * another (src/app/dashboard/page.tsx); by the time a branch reaches this
 * component it is authorised. Nothing here reads `?branch=` itself.
 *
 * Everything shared with the personal cockpit runs the SAME loaders with a
 * branch scope (lib/dashboard/my/*), and every per-RM table is a projection of
 * one RM ledger (lib/dashboard/branch/rm-ledger.ts) loaded once per request,
 * so a branch total and the sum of its RMs cannot disagree.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 *
 * One CSS grid. On a phone the cells take the brief's MOBILE priority through
 * `order-*` (attention first, then KPIs, RM performance, SIP exceptions…); from
 * `lg` up `order-none` restores document order, which is the brief's DESKTOP
 * row order; from `2xl` the paired rows sit side by side. Suspense renders no
 * element of its own, so each band's cells are the grid's real items.
 */

import { Suspense, type ReactNode } from "react";
import { AlertOctagon, Lock, Store, UserRound } from "lucide-react";

import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { CardSkeleton } from "./DashboardSkeletons";
import { DashboardHeaderBar } from "./DashboardHeaderBar";
import { AppliedFilterChips, type AppliedFilter } from "./AppliedFilterChips";
import type { Period } from "@/lib/dashboard/period";
import { loadDashboardThresholds, type DashboardThresholds } from "@/lib/dashboard/thresholds";
import { buildBookWindow } from "@/lib/dashboard/my/build-window";
import { clientsHref, loadBookTargets, type BookScope, type MyWindow } from "@/lib/dashboard/my/window";
import { loadMonthlySummary, loadMyKpis, loadMyTrend, loadTargetMeters, phaseFraction, type MyKpi } from "@/lib/dashboard/my/kpis";
import {
  loadClientBook, loadContactGap, loadDataQuality, loadKeyClients, loadOpportunities,
  loadReviewDesk, loadRiskDesk, type KeyClientSort,
} from "@/lib/dashboard/my/clients";
import {
  loadLeadFunnel, loadMeetingDesk, loadMyQueries, loadMyTasks, loadProposalDesk, loadRedemptionWatch,
} from "@/lib/dashboard/my/pipeline";
import { loadRmLedger, sumLedger, type RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import {
  buildFyScorecard, loadAcquisition, loadAttention, loadInsuranceSnapshot, loadInvestmentFlow,
  loadOpsSnapshot, loadReviewMode, loadSipPerformance, loadWindowMetrics, type AttentionItem,
} from "@/lib/dashboard/branch/sections";
import { runLimit } from "@/lib/dashboard/run-limit";
import { cn } from "@/lib/utils";

import {
  MyClientBook, MyContactGap, MyDataQuality, MyKeyClients, MyKpiStrip, MyMonthlySummary,
  MyOpportunities, MyRiskDesk, MyTrendChart,
} from "./my";
import { voiceFor, type Voice } from "./my/voice";
import {
  AttentionCentre, BranchAcquisition, BranchActivity, BranchFunnel, BranchInsurance, BranchInvestmentFlow,
  BranchMeetings, BranchOps, BranchProposals, BranchQueries, BranchQuickActions, BranchRedemptions,
  BranchReviews, BranchSipExceptions, BranchSipPerformance, BranchTargets, BranchTasks, ClientBookByRm,
  ContactByRm, DataQualityByRm, FyScorecard, HV_PRESETS, ParamSelect, ReviewModePanel, RiskByRm,
  RmOneOnOne, RmScoreboard, RmTargetMatrix, SCORE_SORTS, type Horizon, type ScoreSort,
} from "./branch";

/* ─────────────────────────────── layout cells ─────────────────────────────── */

/** Mobile priority (the brief's list). From `lg` up every cell is `order-none`. */
const ORDER = {
  one: "order-first",
  attention: "order-1",
  kpi: "order-2",
  rm: "order-3",
  sipx: "order-4",
  reviews: "order-5",
  redemptions: "order-6",
  targets: "order-7",
  work: "order-8",
  meetings: "order-9",
  trend: "order-10",
  rest: "order-11",
} as const;
type OrderKey = keyof typeof ORDER;

function Cell({ order, wide = true, id, children }: { order: OrderKey; wide?: boolean; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={cn(ORDER[order], "min-w-0 scroll-mt-40 lg:order-none", wide && "2xl:col-span-2")}>
      {children}
    </div>
  );
}

function Loading({ order, wide = true }: { order: OrderKey; wide?: boolean }) {
  return <Cell order={order} wide={wide}><CardSkeleton /></Cell>;
}

/* ─────────────────────────────── the page ─────────────────────────────── */

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export type BranchCentreProps = {
  session: SessionUser;
  branch: { id: string; name: string };
  /** Other branches the viewer may switch to — null when they are locked to theirs. */
  branchOptions: Array<{ id: string; name: string }> | null;
  /** The RM picker's people — the branch's users that are not deleted. */
  staff: Array<{ id: string; name: string; active: boolean }>;
  /** EVERYONE whose users.branch_id is the branch, departed included — the
   *  people whose work counts as the branch's staff facts. */
  staffIds: string[];
  /** Already validated to be one of `staff`. */
  rmId: string | null;
  period: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
  sp: Record<string, string | string[] | undefined>;
  /** The Firm / Branch / Mine switch, rendered by the page (it knows what is allowed). */
  scopeSwitch: ReactNode;
};

export async function BranchCommandCentre({
  session, branch, branchOptions, staff, staffIds, rmId, period, customStart, customFrom, customTo, sp, scopeSwitch,
}: BranchCentreProps) {
  const now = new Date();
  const oneRm = rmId ? staff.find((s) => s.id === rmId) ?? null : null;
  const scope: BookScope = { kind: "branch", branchId: branch.id, rmId: oneRm?.id ?? null };
  const { w, periodLabel, comparisonLabel } = buildBookWindow({
    scope,
    staff: oneRm ? [oneRm.id] : staffIds,
    possessive: oneRm ? null : "Branch",
    period, customStart, customFrom, customTo, now,
  });
  const voice = voiceFor(w);

  // Four transactions at a time for this render — see lib/dashboard/run-limit.ts.
  const limit = runLimit(4);
  const run: Run = (fn) =>
    limit(() => withTenant(session.tenantId, fn, {
      userId: session.userId,
      branchId: session.branchId ?? undefined,
      roles: session.roles,
    }));

  const t = await run((tx) => loadDashboardThresholds(tx));

  // ONE ledger per request, shared by every band that needs an RM breakdown.
  // The no-op catch marks the promise handled; each band still awaits (and
  // surfaces) a failure itself.
  const ledgerP = run((tx) => loadRmLedger(tx, w, { sipRejectionSlaDays: t.sipRejectionSlaDays }));
  ledgerP.catch(() => {});

  /* ── URL state ───────────────────────────────────────────────────────── */
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "") base.set(k, v);
  base.set("scope", "branch");
  if (!branchOptions) base.delete("branch"); // locked: a branch in the URL means nothing
  const hrefWith = (over: Record<string, string | null>, hash = "") => {
    const q = new URLSearchParams(base);
    for (const [k, v] of Object.entries(over)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    return `/dashboard?${q.toString()}${hash}`;
  };
  const rmHref = (id: string) => hrefWith({ rm: id, myclients: null });

  /* ── phasing ─────────────────────────────────────────────────────────── */
  const inFy = w.from >= w.fyStart;
  const periodPhase = !inFy
    ? null
    : t.targetPhasing === "linear"
      ? phaseFraction(w.from, w.to, w.fyStart, "linear")
      : w.from === w.fyStart ? 1 : null;
  const noPhase = inFy ? "Not phased" : "Other FY";

  const horizon: Horizon = sp.tgt === "mtd" || sp.tgt === "qtd" || sp.tgt === "fytd"
    ? sp.tgt
    : period === "qtd" ? "qtd" : period === "fytd" ? "fytd" : "mtd";
  const monthStart = `${w.today.slice(0, 8)}01`;
  const month = Number(w.today.slice(5, 7));
  const quarterStart = `${w.today.slice(0, 4)}-${String(month >= 4 ? Math.floor((month - 4) / 3) * 3 + 4 : 1).padStart(2, "0")}-01`;
  const since = horizon === "mtd" ? monthStart : horizon === "qtd" ? quarterStart : w.fyStart;
  const horizonPhase = t.targetPhasing === "linear"
    ? phaseFraction(since, w.today, w.fyStart, "linear")
    : horizon === "fytd" ? 1 : null;

  /* ── toggles ─────────────────────────────────────────────────────────── */
  const sort: ScoreSort = SCORE_SORTS.some((s) => s.key === sp.rmsort) ? (sp.rmsort as ScoreSort) : "aum";
  const flowH: "mtd" | "fytd" = sp.flow === "fytd" ? "fytd" : "mtd";
  const hvNum = Number(sp.hv);
  const highValue = Number.isFinite(hvNum) && hvNum >= 10_000 && hvNum <= 1e10 ? Math.round(hvNum) : t.largeRedemptionAbsolute;
  const reviewMode = sp.review === "weekly" || sp.review === "monthly" ? sp.review : null;

  // The attention centre loads ONCE and feeds both its band and the header
  // chip — the one line a branch head should be able to read in ten seconds.
  const attentionP = ledgerP.then((ledger) =>
    run((tx) => loadAttention(tx, w, ledger, t, { highValue, phase: periodPhase })));
  attentionP.catch(() => {});
  const keySort = (["aum", "sip", "interaction", "review", "category"] as KeyClientSort[])
    .includes(sp.myclients as KeyClientSort) ? (sp.myclients as KeyClientSort) : "aum";

  /* ── header ──────────────────────────────────────────────────────────── */
  const asOf = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  }).format(now);
  const filters: AppliedFilter[] = [];
  if (oneRm) filters.push({ params: ["rm", "myclients"], label: "RM", value: oneRm.name });
  const touched = ["period", "rm", "tgt", "rmsort", "flow", "hv", "review", ...(branchOptions ? ["branch"] : [])]
    .some((k) => typeof sp[k] === "string" && sp[k] !== "");
  const canQueries = can(session.roles, "service_request.view.all", session.permissions)
    || can(session.roles, "service_request.view.assigned", session.permissions);

  return (
    <div className="max-w-[92rem] space-y-6">
      <PageHeaderCard
        title="Branch Business Command Centre"
        subtitle="Branch Growth | RM Performance | Client Engagement | Service & Exceptions"
        breadcrumb={[{ label: "Branch" }]}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="chip bg-primary/10 text-sm font-semibold text-primary">
            <Store className="size-3.5" aria-hidden />
            Branch: {branch.name}
          </span>
          {!branchOptions && (
            <span className="chip bg-secondary text-secondary-foreground" title="Your access covers your own branch only. Another branch needs cross-branch permission from an administrator.">
              <Lock className="size-3" aria-hidden /> Your branch only
            </span>
          )}
          {oneRm && (
            <span className="chip bg-secondary text-secondary-foreground">
              <UserRound className="size-3" aria-hidden /> RM: {oneRm.name}
            </span>
          )}
          <Suspense fallback={
            <a href="#attention" className="chip bg-secondary text-secondary-foreground hover:bg-accent">
              <AlertOctagon className="size-3" aria-hidden /> Needs attention
            </a>
          }>
            <AttentionChip p={attentionP} />
          </Suspense>
          <span className="text-2xs text-muted-foreground">Last data refresh: {asOf}</span>
        </div>
      </PageHeaderCard>

      {/* ── Row 1 · global filters — sticky under the top bar on desktop ── */}
      <div className="space-y-2.5 border-b border-border bg-background pb-4 lg:sticky lg:top-16 lg:z-30 lg:pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {scopeSwitch}
            {branchOptions && (
              <ParamSelect
                param="branch"
                value={branch.id}
                options={branchOptions.map((b) => ({ value: b.id, label: b.name }))}
                icon="branch"
                ariaLabel="Branch"
                clear={["rm", "myclients"]}
              />
            )}
            <ParamSelect
              param="rm"
              value={oneRm?.id ?? ""}
              allLabel="All branch"
              options={staff.map((s) => ({ value: s.id, label: s.active ? s.name : `${s.name} (inactive)` }))}
              ariaLabel="Relationship manager"
              clear={["myclients"]}
            />
          </div>
          <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light" />
        </div>
        <AppliedFilterChips
          periodLabel={periodLabel}
          comparisonLabel={comparisonLabel}
          filters={filters}
          resetHref="/dashboard?scope=branch"
          showReset={touched}
        />
        {/* Thirty-odd sections is a long page; these are the ways into it. */}
        <nav aria-label="Jump to section" className="flex flex-wrap items-center gap-x-1 text-2xs">
          {([
            ["attention", "Attention"], ["targets", "Targets"], [oneRm ? "rm-targets" : "rm-scoreboard", "RMs"],
            ["sip-performance", "SIP"], ["redemptions", "Redemptions"], ["reviews", "Reviews"],
            ["client-book", "Clients"], ["tasks", "Tasks & queries"], ["insurance", "Insurance & ops"],
            ["review-mode", "Weekly / monthly"], ["scorecard", "FY scorecard"],
          ] as const).map(([id, label]) => (
            <a key={id} href={`#${id}`}
               className="inline-flex min-h-6 items-center rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-primary">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <BranchQuickActions
        session={session}
        hrefs={{
          sipRejections: `/dashboard/sip-rejections?branch=${branch.id}${oneRm ? `&rm=${oneRm.id}` : ""}`,
          pendingReviews: clientsHref(scope, "review=due"),
          overdueTasks: `/dashboard/tasks?assignee=${w.staff.join(",")}&due=overdue`,
          clients: clientsHref(scope),
        }}
      />

      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2">
        {oneRm && (
          <Suspense fallback={<Loading order="one" />}>
            <OneOnOneBand ledgerP={ledgerP} rmId={oneRm.id} t={t} periodPhase={periodPhase} noPhase={noPhase}
              periodLabel={periodLabel} backHref={hrefWith({ rm: null, myclients: null })} scope={scope} />
          </Suspense>
        )}

        {/* Row 2 · KPI strip */}
        <Suspense fallback={<Loading order="kpi" />}>
          <KpiBand run={run} w={w} periodLabel={periodLabel} oneRm={oneRm?.name ?? null}
            hrefFor={(k) => kpiHref(k, hrefWith)} />
        </Suspense>

        {/* Row 3 · targets */}
        <Suspense fallback={<Loading order="targets" />}>
          <TargetsBand run={run} w={w} since={since} phase={horizonPhase} horizon={horizon}
            hrefs={{ mtd: hrefWith({ tgt: "mtd" }), qtd: hrefWith({ tgt: "qtd" }), fytd: hrefWith({ tgt: "fytd" }) }}
            phasing={t.targetPhasing} oneRm={oneRm?.name ?? null} />
        </Suspense>

        {/* Row 4 · RM scoreboard + target matrix */}
        <Suspense fallback={<Loading order="rm" />}>
          <ScoreboardBand ledgerP={ledgerP} t={t} periodPhase={periodPhase} noPhase={noPhase} sort={sort}
            sortHrefs={Object.fromEntries(SCORE_SORTS.map((s) => [s.key, hrefWith({ rmsort: s.key }, "#rm-scoreboard")])) as Record<ScoreSort, string>}
            rmHref={rmHref} periodLabel={periodLabel} fyLabel={w.fiscalYear} oneRm={!!oneRm} />
        </Suspense>

        {/* Row 5 · business trend + SIP performance */}
        <Suspense fallback={<Loading order="trend" />}>
          <TrendBand run={run} w={w} ledgerP={ledgerP} t={t} rmHref={rmHref} periodLabel={periodLabel} oneRm={oneRm?.name ?? null} />
        </Suspense>

        {/* Row 6 · investment flow + redemption watch */}
        <Suspense fallback={<Loading order="redemptions" />}>
          <FlowBand run={run} w={w} flowH={flowH} highValue={highValue} rmHref={rmHref} periodLabel={periodLabel}
            flowHrefs={{ mtd: hrefWith({ flow: "mtd" }), fytd: hrefWith({ flow: "fytd" }) }}
            presetHrefs={HV_PRESETS.map((v) => ({ value: v, href: hrefWith({ hv: String(v) }, "#redemptions") }))}
            customHidden={[...base.entries()].filter(([k]) => k !== "hv")}
            showRm={voice.showRm} />
        </Suspense>

        {/* Row 7 · new clients + lead funnel */}
        <Suspense fallback={<Loading order="rest" />}>
          <AcquisitionBand run={run} w={w} ledgerP={ledgerP} t={t} voice={voice} rmHref={rmHref} periodLabel={periodLabel} />
        </Suspense>

        {/* Row 8 · meetings + reviews */}
        <Suspense fallback={<Loading order="reviews" />}>
          <MeetingsBand run={run} w={w} ledgerP={ledgerP} voice={voice} rmHref={rmHref} periodLabel={periodLabel}
            periodPhase={periodPhase} ageingDays={t.proposalAgeingDays} />
        </Suspense>

        {/* Row 9 · SIP exception centre */}
        <Suspense fallback={<Loading order="sipx" />}>
          <SipExceptionBand ledgerP={ledgerP} t={t} rmHref={rmHref} periodLabel={periodLabel}
            book={{ branchId: branch.id, rmId: oneRm?.id ?? null }} period={{ from: w.from, to: w.to }} />
        </Suspense>

        {/* Row 10 · client book + contact health (+ key clients for one RM) */}
        <Suspense fallback={<Loading order="rest" />}>
          <BookBand run={run} w={w} ledgerP={ledgerP} voice={voice} rmHref={rmHref} oneRm={!!oneRm}
            keySort={keySort} keyBaseHref={`${hrefWith({ myclients: null })}&`} />
        </Suspense>

        {/* Row 11 · tasks + queries */}
        <Suspense fallback={<Loading order="work" />}>
          <WorkBand run={run} w={w} ledgerP={ledgerP} rmHref={rmHref} periodLabel={periodLabel}
            canQueries={canQueries} showRm={voice.showRm} />
        </Suspense>

        {/* Row 12 · insurance + operations */}
        <Suspense fallback={<Loading order="rest" />}>
          <ServiceBand run={run} w={w} ledgerP={ledgerP} rmHref={rmHref} periodLabel={periodLabel} showRm={voice.showRm}
            opsHref={can(session.roles, "dashboard.view.ops", session.permissions) ? "/dashboard/command-center" : null} />
        </Suspense>

        {/* Row 13 · data quality + risk profile, then relationships and activity */}
        <Suspense fallback={<Loading order="rest" />}>
          <QualityBand run={run} w={w} ledgerP={ledgerP} voice={voice} rmHref={rmHref} periodLabel={periodLabel} />
        </Suspense>

        {/* Row 14 · management attention centre */}
        <Suspense fallback={<Loading order="attention" />}>
          <AttentionBand attentionP={attentionP} highValue={highValue} rmHref={rmHref} />
        </Suspense>

        {/* Row 15 · weekly / monthly review, month on month */}
        <Suspense fallback={<Loading order="rest" />}>
          <ReviewBand run={run} w={w} t={t} mode={reviewMode}
            hrefs={{
              weekly: hrefWith({ review: "weekly" }, "#review-mode"),
              monthly: hrefWith({ review: "monthly" }, "#review-mode"),
              off: hrefWith({ review: null }),
            }}
            now={now} />
        </Suspense>

        {/* Row 16 · FY scorecard */}
        <Suspense fallback={<Loading order="rest" />}>
          <ScorecardBand run={run} w={w} ledgerP={ledgerP} t={t} />
        </Suspense>
      </div>
    </div>
  );
}

/** The header's one-line verdict: how many exceptions, how many critical. */
async function AttentionChip({ p }: { p: Promise<AttentionItem[]> }) {
  const items = await p;
  const critical = items.filter((i) => i.severity === "critical").length;
  const rest = items.length - critical;
  return (
    <a
      href="#attention"
      className={cn(
        "chip hover:opacity-90",
        critical > 0 ? "bg-destructive/10 text-destructive"
        : rest > 0 ? "bg-warning/10 text-warning-foreground"
        : "bg-secondary text-secondary-foreground",
      )}
    >
      <AlertOctagon className="size-3" aria-hidden />
      {items.length === 0
        ? "Nothing needs attention"
        : [critical ? `${critical} critical` : null, rest ? `${rest} for attention` : null].filter(Boolean).join(" · ")}
    </a>
  );
}

/** KPI tiles open the RM-wise view of the same figure — the first drill-down step. */
function kpiHref(key: MyKpi["key"], hrefWith: (o: Record<string, string | null>, h?: string) => string): string {
  switch (key) {
    case "aum": return hrefWith({ rmsort: "aum" }, "#rm-scoreboard");
    case "sip_book": return hrefWith({ rmsort: "sip" }, "#rm-scoreboard");
    case "gross_sip": case "sip_stop": case "net_sip": return hrefWith({}, "#sip-performance");
    case "gross_investment": case "redemption": case "net_business": return hrefWith({ rmsort: "net_business" }, "#rm-scoreboard");
    case "new_clients": return hrefWith({ rmsort: "new_clients" }, "#rm-scoreboard");
    case "meetings": return hrefWith({ rmsort: "meetings" }, "#rm-scoreboard");
    case "insurance": return hrefWith({}, "#insurance");
  }
}

/* ──────────────────────────────── bands ──────────────────────────────── */

async function OneOnOneBand({
  ledgerP, rmId, t, periodPhase, noPhase, periodLabel, backHref, scope,
}: {
  ledgerP: Promise<RmLedgerRow[]>; rmId: string; t: DashboardThresholds; periodPhase: number | null;
  noPhase: string; periodLabel: string; backHref: string; scope: BookScope;
}) {
  const ledger = await ledgerP;
  const row = ledger.find((r) => r.id === rmId);
  if (!row) return null;
  return (
    <Cell order="one">
      <RmOneOnOne
        row={row} phase={periodPhase} near={t.targetNearFraction} noPhase={noPhase}
        periodLabel={periodLabel} backHref={backHref}
        links={{
          clients: clientsHref(scope),
          tasks: `/dashboard/tasks?assignee=${rmId}`,
          meetings: `/dashboard/review-meetings?rm=${rmId}`,
          leads: `/dashboard/leads?owner=${rmId}`,
        }}
      />
    </Cell>
  );
}

async function KpiBand({
  run, w, periodLabel, oneRm, hrefFor,
}: {
  run: Run; w: MyWindow; periodLabel: string; oneRm: string | null; hrefFor: (k: MyKpi["key"]) => string;
}) {
  const kpis = await run((tx) => loadMyKpis(tx, w));
  // Narrowed to one RM there is no scoreboard to drill into; the tiles keep
  // their list links (that RM's clients, SIPs, transactions).
  const tiles = oneRm ? kpis : kpis.map((k) => ({ ...k, href: hrefFor(k.key) }));
  return (
    <Cell order="kpi">
      <MyKpiStrip kpis={tiles} periodLabel={periodLabel} title={oneRm ? `${oneRm} — business` : "Branch business"} />
    </Cell>
  );
}

async function TargetsBand({
  run, w, since, phase, horizon, hrefs, phasing, oneRm,
}: {
  run: Run; w: MyWindow; since: string; phase: number | null; horizon: Horizon;
  hrefs: Partial<Record<Horizon, string>>; phasing: "linear" | "none"; oneRm: string | null;
}) {
  // The horizon runs to TODAY whatever period is selected above — "MTD" means
  // this month so far, not the last day of a period picked for the KPIs.
  const meters = await run((tx) => loadTargetMeters(tx, { ...w, to: w.today }, { since, phase }));
  return (
    <Cell order="targets" id="targets">
      <BranchTargets meters={meters} horizon={horizon} hrefs={hrefs} phasing={phasing} fyLabel={w.fiscalYear} oneRm={oneRm} />
    </Cell>
  );
}

async function ScoreboardBand({
  ledgerP, t, periodPhase, noPhase, sort, sortHrefs, rmHref, periodLabel, fyLabel, oneRm,
}: {
  ledgerP: Promise<RmLedgerRow[]>; t: DashboardThresholds; periodPhase: number | null; noPhase: string;
  sort: ScoreSort; sortHrefs: Record<ScoreSort, string>; rmHref: (id: string) => string;
  periodLabel: string; fyLabel: string; oneRm: boolean;
}) {
  const ledger = await ledgerP;
  const rows = ledger.filter((r) => r.isRm);
  return (
    <>
      {!oneRm && (
        <Cell order="rm" id="rm-scoreboard">
          <RmScoreboard rows={rows} phase={periodPhase} near={t.targetNearFraction} noPhase={noPhase}
            sort={sort} sortHrefs={sortHrefs} rmHref={rmHref} periodLabel={periodLabel} />
        </Cell>
      )}
      <Cell order="rm">
        <RmTargetMatrix rows={rows} phase={periodPhase} near={t.targetNearFraction} noPhase={noPhase}
          rmHref={rmHref} periodLabel={periodLabel} fyLabel={fyLabel} />
      </Cell>
    </>
  );
}

async function TrendBand({
  run, w, ledgerP, t, rmHref, periodLabel, oneRm,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; t: DashboardThresholds;
  rmHref: (id: string) => string; periodLabel: string; oneRm: string | null;
}) {
  const ledger = await ledgerP;
  const [trend, sip] = await run(async (tx) => {
    const targetOf = await loadBookTargets(tx, w);
    return [
      await loadMyTrend(tx, w),
      await loadSipPerformance(tx, w, ledger, targetOf("net_sip"), t.targetPhasing),
    ] as const;
  });
  return (
    <>
      <Cell order="trend" wide={false}>
        <MyTrendChart trend={trend} title={oneRm ? `Business trend — ${oneRm}` : "Branch business trend"} showBalances />
      </Cell>
      <Cell order="rest" wide={false}>
        <BranchSipPerformance data={sip} rmHref={rmHref} periodLabel={periodLabel} />
      </Cell>
    </>
  );
}

async function FlowBand({
  run, w, flowH, highValue, rmHref, periodLabel, flowHrefs, presetHrefs, customHidden, showRm,
}: {
  run: Run; w: MyWindow; flowH: "mtd" | "fytd"; highValue: number; rmHref: (id: string) => string;
  periodLabel: string; flowHrefs: Record<"mtd" | "fytd", string>;
  presetHrefs: Array<{ value: number; href: string }>; customHidden: Array<[string, string]>; showRm: boolean;
}) {
  const [flow, red] = await run(async (tx) => [
    await loadInvestmentFlow(tx, w, flowH),
    await loadRedemptionWatch(tx, w, highValue),
  ] as const);
  return (
    <>
      <Cell order="rest" wide={false}>
        <BranchInvestmentFlow data={flow} hrefs={flowHrefs} rmHref={rmHref} />
      </Cell>
      <Cell order="redemptions" wide={false} id="redemptions">
        <BranchRedemptions data={red} periodLabel={periodLabel} presetHrefs={presetHrefs}
          customAction="/dashboard" customHidden={customHidden} showRm={showRm} />
      </Cell>
    </>
  );
}

async function AcquisitionBand({
  run, w, ledgerP, t, voice, rmHref, periodLabel,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; t: DashboardThresholds; voice: Voice;
  rmHref: (id: string) => string; periodLabel: string;
}) {
  const ledger = await ledgerP;
  const [acq, funnel] = await run(async (tx) => {
    const targetOf = await loadBookTargets(tx, w);
    return [
      await loadAcquisition(tx, w, ledger, targetOf("new_clients"), t.targetPhasing),
      await loadLeadFunnel(tx, w, t.staleLeadDays),
    ] as const;
  });
  return (
    <>
      <Cell order="rest" wide={false}>
        <BranchAcquisition data={acq} periodLabel={periodLabel} rmHref={rmHref}
          newClientsHref={voice.clients(`created_from=${w.from}&created_to=${w.to}&sort=created&dir=desc`)} />
      </Cell>
      <Cell order="rest" wide={false}>
        <BranchFunnel funnel={funnel} ledger={ledger} voice={voice} rmHref={rmHref} />
      </Cell>
    </>
  );
}

async function MeetingsBand({
  run, w, ledgerP, voice, rmHref, periodLabel, periodPhase, ageingDays,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; voice: Voice; rmHref: (id: string) => string;
  periodLabel: string; periodPhase: number | null; ageingDays: number;
}) {
  const ledger = await ledgerP;
  const [meetings, reviews, proposals] = await run(async (tx) => [
    await loadMeetingDesk(tx, w),
    await loadReviewDesk(tx, w),
    await loadProposalDesk(tx, w),
  ] as const);
  return (
    <>
      <Cell order="meetings" wide={false}>
        <BranchMeetings desk={meetings} ledger={ledger} voice={voice} rmHref={rmHref} periodLabel={periodLabel}
          phase={periodPhase} staffIds={w.staff.join(",")} />
      </Cell>
      <Cell order="reviews" wide={false}>
        <BranchReviews data={reviews} ledger={ledger} voice={voice} rmHref={rmHref} />
      </Cell>
      <Cell order="rest">
        <BranchProposals desk={proposals} ledger={ledger} voice={voice} rmHref={rmHref} periodLabel={periodLabel}
          ageingDays={ageingDays} />
      </Cell>
    </>
  );
}

async function SipExceptionBand({
  ledgerP, t, rmHref, periodLabel, book, period,
}: {
  ledgerP: Promise<RmLedgerRow[]>; t: DashboardThresholds; rmHref: (id: string) => string; periodLabel: string;
  book: { branchId: string; rmId: string | null }; period: { from: string; to: string };
}) {
  const ledger = await ledgerP;
  return (
    <Cell order="sipx">
      <BranchSipExceptions ledger={ledger} rmHref={rmHref} periodLabel={periodLabel}
        slaDays={t.sipRejectionSlaDays} book={book} period={period} />
    </Cell>
  );
}

async function BookBand({
  run, w, ledgerP, voice, rmHref, oneRm, keySort, keyBaseHref,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; voice: Voice; rmHref: (id: string) => string;
  oneRm: boolean; keySort: KeyClientSort; keyBaseHref: string;
}) {
  const ledger = await ledgerP;
  const [book, contact, keyClients] = await run(async (tx) => [
    await loadClientBook(tx, w),
    await loadContactGap(tx, w),
    oneRm ? await loadKeyClients(tx, w, keySort) : null,
  ] as const);
  const scope = w.scope as Extract<BookScope, { kind: "branch" }>;
  const clientsOf = (r: RmLedgerRow) =>
    r.kind === "person" ? clientsHref({ kind: "branch", branchId: scope.branchId, rmId: r.id }) : null;
  return (
    <>
      {keyClients && (
        <Cell order="rest">
          <MyKeyClients clients={keyClients} sort={keySort} baseHref={keyBaseHref} today={w.today} voice={voice} />
        </Cell>
      )}
      <Cell order="rest" wide={false} id="client-book">
        <MyClientBook book={book} voice={voice}
          extra={voice.showRm ? <ClientBookByRm ledger={ledger} rmHref={rmHref} clientsOf={clientsOf} /> : undefined} />
      </Cell>
      <Cell order="rest" wide={false}>
        <MyContactGap data={contact} voice={voice}
          extra={voice.showRm ? <ContactByRm ledger={ledger} rmHref={rmHref} clientsOf={clientsOf} /> : undefined} />
      </Cell>
    </>
  );
}

async function WorkBand({
  run, w, ledgerP, rmHref, periodLabel, canQueries, showRm,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; rmHref: (id: string) => string; periodLabel: string;
  canQueries: boolean; showRm: boolean;
}) {
  const ledger = await ledgerP;
  const [tasks, queries] = await run(async (tx) => [
    await loadMyTasks(tx, w),
    await loadMyQueries(tx, w),
  ] as const);
  return (
    <>
      <Cell order="work" wide={false} id="tasks">
        <BranchTasks data={tasks} ledger={ledger} rmHref={rmHref} periodLabel={periodLabel} staffIds={w.staff.join(",")} />
      </Cell>
      <Cell order="work" wide={false}>
        <BranchQueries data={queries} ledger={ledger} rmHref={rmHref} periodLabel={periodLabel} canOpen={canQueries} showRm={showRm} />
      </Cell>
    </>
  );
}

async function ServiceBand({
  run, w, ledgerP, rmHref, periodLabel, showRm, opsHref,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; rmHref: (id: string) => string; periodLabel: string;
  showRm: boolean; opsHref: string | null;
}) {
  const ledger = await ledgerP;
  const [ins, ops] = await run(async (tx) => [
    await loadInsuranceSnapshot(tx, w),
    await loadOpsSnapshot(tx, w),
  ] as const);
  return (
    <>
      <Cell order="rest" wide={false} id="insurance">
        <BranchInsurance data={ins} ledger={ledger} rmHref={rmHref} periodLabel={periodLabel} showRm={showRm} />
      </Cell>
      <Cell order="rest" wide={false}>
        <BranchOps data={ops} ledger={ledger} rmHref={rmHref} showRm={showRm} opsHref={opsHref} period={{ from: w.from, to: w.to }} />
      </Cell>
    </>
  );
}

async function QualityBand({
  run, w, ledgerP, voice, rmHref, periodLabel,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; voice: Voice; rmHref: (id: string) => string; periodLabel: string;
}) {
  const ledger = await ledgerP;
  const [quality, risk, opps] = await run(async (tx) => [
    await loadDataQuality(tx, w),
    await loadRiskDesk(tx, w),
    await loadOpportunities(tx, w),
  ] as const);
  const scope = w.scope as Extract<BookScope, { kind: "branch" }>;
  const clientsOf = (r: RmLedgerRow) =>
    r.kind === "person" ? clientsHref({ kind: "branch", branchId: scope.branchId, rmId: r.id }) : null;
  return (
    <>
      <Cell order="rest" wide={false}>
        <MyDataQuality data={quality} voice={voice}
          extra={voice.showRm ? <DataQualityByRm ledger={ledger} rmHref={rmHref} clientsOf={clientsOf} /> : undefined} />
      </Cell>
      <Cell order="rest" wide={false}>
        <MyRiskDesk data={risk} voice={voice}
          extra={voice.showRm ? <RiskByRm ledger={ledger} rmHref={rmHref} clientsOf={clientsOf} /> : undefined} />
      </Cell>
      <Cell order="rest">
        <MyOpportunities items={opps} voice={voice} />
      </Cell>
      {voice.showRm && (
        <Cell order="rest">
          <BranchActivity ledger={ledger} rmHref={rmHref} periodLabel={periodLabel} />
        </Cell>
      )}
    </>
  );
}

async function AttentionBand({
  attentionP, highValue, rmHref,
}: {
  attentionP: Promise<AttentionItem[]>; highValue: number; rmHref: (id: string) => string;
}) {
  const items = await attentionP;
  return (
    <Cell order="attention">
      <AttentionCentre items={items} rmHref={rmHref} highValue={highValue} />
    </Cell>
  );
}

async function ReviewBand({
  run, w, t, mode, hrefs, now,
}: {
  run: Run; w: MyWindow; t: DashboardThresholds; mode: "weekly" | "monthly" | null;
  hrefs: { weekly: string; monthly: string; off: string }; now: Date;
}) {
  const [review, months] = await run(async (tx) => {
    const targetOf = await loadBookTargets(tx, w);
    return [
      mode ? await loadReviewMode(tx, w, mode, targetOf, t.targetPhasing) : null,
      await loadMonthlySummary(tx, w),
    ] as const;
  });
  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "Asia/Kolkata" }).format(now);
  const prevMonthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "Asia/Kolkata" })
    .format(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  return (
    <>
      <Cell order="rest">
        <ReviewModePanel data={review} hrefs={hrefs} phasing={t.targetPhasing}
          balanceRows={months.filter((m) => m.key === "aum" || m.key === "sip_book")} />
      </Cell>
      <Cell order="rest" id="month-on-month">
        <MyMonthlySummary rows={months} monthLabel={monthLabel} prevLabel={prevMonthLabel} />
      </Cell>
    </>
  );
}

async function ScorecardBand({
  run, w, ledgerP, t,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; t: DashboardThresholds;
}) {
  const ledger = await ledgerP;
  const [fy, targetOf] = await run(async (tx) => [
    await loadWindowMetrics(tx, w, w.fyStart, w.today),
    await loadBookTargets(tx, w),
  ] as const);
  const elapsed = phaseFraction(w.fyStart, w.today, w.fyStart, "linear") ?? 0;
  const rows = buildFyScorecard(
    {
      // Balances from the ledger, which reconciles to the branch's clients.
      aum: sumLedger(ledger, "aum"),
      sip_book: sumLedger(ledger, "sipBook"),
      net_sip: fy.netSip,
      net_business: fy.netBusiness,
      new_clients: fy.newClients,
      meetings: fy.meetings,
      reviews: fy.reviewMeetings,
      insurance: fy.insurance,
    },
    targetOf,
    t.targetPhasing === "linear" ? elapsed : null,
  );
  return (
    <Cell order="rest" id="scorecard">
      <FyScorecard rows={rows} fyLabel={w.fiscalYear} phasing={t.targetPhasing} elapsed={elapsed} />
    </Cell>
  );
}
