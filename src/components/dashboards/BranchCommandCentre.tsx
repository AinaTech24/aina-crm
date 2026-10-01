/**
 * The Branch Head Dashboard — the branch head's operating system, one of the
 * role dashboards picked from the Dashboard dropdown (a system dashboard at
 * /dashboard/<id>; lib/dashboards/system/definitions.ts).
 *
 * ── One page, read top to bottom ─────────────────────────────────────────────
 *
 *   The headline                    KPI strip
 *   What needs me today?            SIP exceptions, tasks and service requests,
 *                                   meetings and reviews
 *   Against target                  targets
 *   The analysis                    pipeline, investment flow, book, insurance
 *                                   and operations, data quality; then month on
 *                                   month and the FY scorecard
 *
 * Taken off at the firm's request (2026-09-30), so do not restore them from the
 * brief: the jump links, the quick-action buttons, the attention centre, the RM
 * scoreboard and target matrix, redemption watch, the business trend, SIP
 * performance, relationship opportunities, RM activity and the weekly /
 * monthly review.
 *
 * Every figure follows the brief's drill-down: branch → RM (the one-on-one
 * view, `?rm=`) → client (the lists and priority tables) → the record itself.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────
 *
 * The dashboard decides which branch this is and whether the viewer may
 * choose another (components/dashboards/system/centres.tsx); by the time a
 * branch reaches this component it is authorised. Nothing here reads
 * `?branch=` itself.
 *
 * Everything shared with the personal cockpit runs the SAME loaders with a
 * branch scope (lib/dashboard/my/*), and every per-RM table is a projection of
 * one RM ledger (lib/dashboard/branch/rm-ledger.ts) loaded once per request,
 * so a branch total and the sum of its RMs cannot disagree.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 *
 * One CSS grid. On a phone the cells take the brief's MOBILE priority through
 * `order-*` (KPIs first, then SIP exceptions, reviews, targets…); from
 * `lg` up `order-none` restores document order, the desktop order above; from
 * `2xl` the paired rows sit side by side. Suspense renders no element of its
 * own, so each band's cells are the grid's real items.
 */

import { Suspense, type ReactNode } from "react";
import { Lock, UserRound } from "lucide-react";

import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CardSkeleton } from "./DashboardSkeletons";
import { DashboardHeaderBar } from "./DashboardHeaderBar";
import { AppliedFilterChips, type AppliedFilter } from "./AppliedFilterChips";
import type { Period } from "@/lib/dashboard/period";
import { loadDashboardThresholds, type DashboardThresholds } from "@/lib/dashboard/thresholds";
import { buildBookWindow } from "@/lib/dashboard/my/build-window";
import { clientsHref, loadBookTargets, type BookScope, type MyWindow } from "@/lib/dashboard/my/window";
import { loadMonthlySummary, loadMyKpis, loadTargetMeters, monthLabels, phaseFraction } from "@/lib/dashboard/my/kpis";
import {
  loadClientBook, loadContactGap, loadDataQuality, loadKeyClients,
  loadReviewDesk, loadRiskDesk, type KeyClientSort,
} from "@/lib/dashboard/my/clients";
import {
  loadLeadFunnel, loadMeetingDesk, loadMyQueries, loadMyTasks, loadProposalDesk,
} from "@/lib/dashboard/my/pipeline";
import { loadRmLedger, sumLedger, type RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import {
  buildFyScorecard, loadAcquisition, loadInsuranceSnapshot, loadInvestmentFlow,
  loadOpsSnapshot, loadWindowMetrics,
} from "@/lib/dashboard/branch/sections";
import { runLimit } from "@/lib/dashboard/run-limit";
import { cn } from "@/lib/utils";

import {
  MyClientBook, MyContactGap, MyDataQuality, MyKeyClients, MyKpiStrip, MyMonthlySummary, MyRiskDesk,
} from "./my";
import { voiceFor, type Voice } from "./my/voice";
import {
  BranchAcquisition, BranchFunnel, BranchInsurance, BranchInvestmentFlow,
  BranchMeetings, BranchOps, BranchProposals, BranchQueries,
  BranchReviews, BranchSipExceptions, BranchTargets, BranchTasks, ClientBookByRm,
  ContactByRm, DataQualityByRm, FyScorecard, ParamSelect, RiskByRm,
  RmOneOnOne, type Horizon,
} from "./branch";

/* ─────────────────────────────── layout cells ─────────────────────────────── */

/** Mobile priority (the brief's list). From `lg` up every cell is `order-none`. */
const ORDER = {
  one: "order-first",
  kpi: "order-1",
  sipx: "order-2",
  reviews: "order-3",
  targets: "order-4",
  work: "order-5",
  meetings: "order-6",
  rest: "order-7",
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

/** An href ready for one more `key=value`: the page may have no query string yet. */
const paramBase = (href: string) => `${href}${href.includes("?") ? "&" : "?"}`;

export type BranchCentreProps = {
  session: SessionUser;
  /** Where this dashboard lives (/dashboard/<id>) — every link it builds back to itself starts here. */
  basePath: string;
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
  /** The viewer sees only their own clients: the view stays on `rmId`, with no RM picker. */
  rmLocked?: boolean;
  /** False for a team lead: the RM picker offers their team only, with no "All branch". */
  rmAll?: boolean;
  period: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
  sp: Record<string, string | string[] | undefined>;
};

export async function BranchCommandCentre({
  session, basePath, branch, branchOptions, staff, staffIds, rmId, rmLocked = false, rmAll = true, period, customStart, customFrom, customTo, sp,
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
  base.delete("scope"); // left over from a /dashboard?scope=branch link; means nothing here
  if (!branchOptions) base.delete("branch"); // locked: a branch in the URL means nothing
  const hrefWith = (over: Record<string, string | null>, hash = "") => {
    const q = new URLSearchParams(base);
    for (const [k, v] of Object.entries(over)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    const qs = q.toString();
    return `${basePath}${qs ? `?${qs}` : ""}${hash}`;
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
  const flowH: "mtd" | "fytd" = sp.flow === "fytd" ? "fytd" : "mtd";
  const keySort = (["aum", "sip", "interaction", "review", "category"] as KeyClientSort[])
    .includes(sp.myclients as KeyClientSort) ? (sp.myclients as KeyClientSort) : "aum";

  /* ── header ──────────────────────────────────────────────────────────── */
  const filters: AppliedFilter[] = [];
  if (oneRm && !rmLocked && rmAll) filters.push({ params: ["rm", "myclients"], label: "RM", value: oneRm.name });
  const touched = ["period", "rm", "tgt", "flow", ...(branchOptions ? ["branch"] : [])]
    .some((k) => typeof sp[k] === "string" && sp[k] !== "");
  const canQueries = can(session.roles, "service_request.view.all", session.permissions)
    || can(session.roles, "service_request.view.assigned", session.permissions);

  return (
    <div className="max-w-screen-2xl space-y-6">
      {/* The dashboard header above names the dashboard and the branch; this
          line is whose view it is. */}
      {(!branchOptions || oneRm) && (
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      )}

      {/* ── Row 1 · global filters — sticky under the top bar on desktop ── */}
      <div className="space-y-2.5 border-b border-border bg-background pb-4 lg:sticky lg:top-16 lg:z-30 lg:pt-3">
        {/* Which branch / RM / period, on the right. */}
        <div className="flex flex-wrap items-center justify-start gap-3 sm:justify-end">
          <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
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
            {!rmLocked && (
              <ParamSelect
                param="rm"
                value={oneRm?.id ?? ""}
                allLabel={rmAll ? "All branch" : undefined}
                options={staff.map((s) => ({ value: s.id, label: s.active ? s.name : `${s.name} (inactive)` }))}
                ariaLabel="Relationship manager"
                clear={["myclients"]}
              />
            )}
            <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light" />
          </div>
        </div>
        <AppliedFilterChips
          periodLabel={periodLabel}
          comparisonLabel={comparisonLabel}
          filters={filters}
          resetHref={basePath}
          showReset={touched}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2">
        {oneRm && (
          <Suspense fallback={<Loading order="one" />}>
            <OneOnOneBand ledgerP={ledgerP} rmId={oneRm.id} t={t} periodPhase={periodPhase} noPhase={noPhase}
              periodLabel={periodLabel} backHref={rmLocked || !rmAll ? null : hrefWith({ rm: null, myclients: null })} scope={scope} />
          </Suspense>
        )}

        {/* The headline · KPI strip */}
        <Suspense fallback={<Loading order="kpi" />}>
          <KpiBand run={run} w={w} periodLabel={periodLabel} oneRm={oneRm?.name ?? null} />
        </Suspense>

        {/* Today · SIP exception centre */}
        <Suspense fallback={<Loading order="sipx" />}>
          <SipExceptionBand ledgerP={ledgerP} t={t} rmHref={rmHref} periodLabel={periodLabel}
            book={{ branchId: branch.id, rmId: oneRm?.id ?? null }} period={{ from: w.from, to: w.to }} />
        </Suspense>

        {/* Today · tasks + service requests */}
        <Suspense fallback={<Loading order="work" />}>
          <WorkBand run={run} w={w} ledgerP={ledgerP} rmHref={rmHref} periodLabel={periodLabel}
            canQueries={canQueries} showRm={voice.showRm} />
        </Suspense>

        {/* Today · meetings + reviews */}
        <Suspense fallback={<Loading order="reviews" />}>
          <MeetingsBand run={run} w={w} ledgerP={ledgerP} voice={voice} rmHref={rmHref} periodLabel={periodLabel}
            periodPhase={periodPhase} ageingDays={t.proposalAgeingDays} />
        </Suspense>

        {/* The team · targets */}
        <Suspense fallback={<Loading order="targets" />}>
          <TargetsBand run={run} w={w} since={since} phase={horizonPhase} horizon={horizon}
            hrefs={{ mtd: hrefWith({ tgt: "mtd" }), qtd: hrefWith({ tgt: "qtd" }), fytd: hrefWith({ tgt: "fytd" }) }}
            phasing={t.targetPhasing} oneRm={oneRm?.name ?? null} />
        </Suspense>

        {/* Pipeline · new clients + lead funnel */}
        <Suspense fallback={<Loading order="rest" />}>
          <AcquisitionBand run={run} w={w} ledgerP={ledgerP} t={t} voice={voice} rmHref={rmHref} periodLabel={periodLabel} />
        </Suspense>

        {/* Analysis · investment flow */}
        <Suspense fallback={<Loading order="rest" />}>
          <FlowBand run={run} w={w} flowH={flowH} rmHref={rmHref}
            flowHrefs={{ mtd: hrefWith({ flow: "mtd" }), fytd: hrefWith({ flow: "fytd" }) }} />
        </Suspense>

        {/* Analysis · client book + contact health (+ key clients for one RM) */}
        <Suspense fallback={<Loading order="rest" />}>
          <BookBand run={run} w={w} ledgerP={ledgerP} voice={voice} rmHref={rmHref} oneRm={!!oneRm}
            keySort={keySort} keyBaseHref={paramBase(hrefWith({ myclients: null }))} />
        </Suspense>

        {/* Analysis · insurance + operations */}
        <Suspense fallback={<Loading order="rest" />}>
          <ServiceBand run={run} w={w} ledgerP={ledgerP} rmHref={rmHref} periodLabel={periodLabel} showRm={voice.showRm}
            opsHref={can(session.roles, "dashboard.view.ops", session.permissions) ? "/dashboard/operations" : null} />
        </Suspense>

        {/* Analysis · data quality + risk profile */}
        <Suspense fallback={<Loading order="rest" />}>
          <QualityBand run={run} w={w} ledgerP={ledgerP} voice={voice} rmHref={rmHref} />
        </Suspense>

        {/* Reviews · month on month */}
        <Suspense fallback={<Loading order="rest" />}>
          <MonthOnMonthBand run={run} w={w} />
        </Suspense>

        {/* Reviews · FY scorecard */}
        <Suspense fallback={<Loading order="rest" />}>
          <ScorecardBand run={run} w={w} ledgerP={ledgerP} t={t} />
        </Suspense>
      </div>
    </div>
  );
}

/* ──────────────────────────────── bands ──────────────────────────────── */

async function OneOnOneBand({
  ledgerP, rmId, t, periodPhase, noPhase, periodLabel, backHref, scope,
}: {
  ledgerP: Promise<RmLedgerRow[]>; rmId: string; t: DashboardThresholds; periodPhase: number | null;
  noPhase: string; periodLabel: string; backHref: string | null; scope: BookScope;
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
  run, w, periodLabel, oneRm,
}: {
  run: Run; w: MyWindow; periodLabel: string; oneRm: string | null;
}) {
  // Each tile opens its own list (clients, SIPs, transactions), where the
  // viewer's access scope applies.
  const kpis = await run((tx) => loadMyKpis(tx, w));
  return (
    <Cell order="kpi">
      <MyKpiStrip kpis={kpis} periodLabel={periodLabel} title={oneRm ? `${oneRm} — business` : "Branch business"} />
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

async function FlowBand({
  run, w, flowH, rmHref, flowHrefs,
}: {
  run: Run; w: MyWindow; flowH: "mtd" | "fytd"; rmHref: (id: string) => string;
  flowHrefs: Record<"mtd" | "fytd", string>;
}) {
  const flow = await run((tx) => loadInvestmentFlow(tx, w, flowH));
  // Full width: the card it used to share a row with (redemption watch) is gone.
  return (
    <Cell order="rest">
      <BranchInvestmentFlow data={flow} hrefs={flowHrefs} rmHref={rmHref} />
    </Cell>
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
  run, w, ledgerP, voice, rmHref,
}: {
  run: Run; w: MyWindow; ledgerP: Promise<RmLedgerRow[]>; voice: Voice; rmHref: (id: string) => string;
}) {
  const ledger = await ledgerP;
  const [quality, risk] = await run(async (tx) => [
    await loadDataQuality(tx, w),
    await loadRiskDesk(tx, w),
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
    </>
  );
}

async function MonthOnMonthBand({ run, w }: { run: Run; w: MyWindow }) {
  const months = await run((tx) => loadMonthlySummary(tx, w));
  const { monthLabel, prevMonthLabel } = monthLabels(w.to);
  return (
    <Cell order="rest" id="month-on-month">
      <MyMonthlySummary rows={months} monthLabel={monthLabel} prevLabel={prevMonthLabel} />
    </Cell>
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
