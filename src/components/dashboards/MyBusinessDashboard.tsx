/**
 * The Relationship Manager Dashboard — the RM's daily work desk, client
 * cockpit and target tracker in one page, one of the role dashboards picked
 * from the Dashboard dropdown (a system dashboard at /dashboard/<id>). The
 * same dashboard serves a director or branch head who carries clients: on it
 * they ARE an RM.
 *
 * ── Action before analytics ────────────────────────────────────────────────
 *
 * The brief's first rule. The page answers "whom do I contact today, what is
 * pending, how is my business going" in that order:
 *
 *   morning brief · My Day · Needs my attention     what to do, what is late
 *   KPIs · targets                                   how the business is going
 *   worklist · 7 days · meetings · reviews           the work, row by row
 *   book · contact · leads · proposals · SIP · flows · tasks · queries …
 *   scorecards · FY performance                      the review of it all
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * Always the signed-in user's own book — clients whose `investors.rm_id` is
 * them, and their own tasks, leads, meetings and proposals (see
 * lib/dashboard/my/window.ts). There is no owner picker: the brief wants the
 * owner locked to "Me", and nothing on this page can show another RM's book.
 * Client filters (category, type, city, source, family…) narrow the client
 * side of that book only.
 *
 * ── Layout and streaming ───────────────────────────────────────────────────
 *
 * One CSS grid, the same technique as the branch command centre: on a phone
 * the cells take the brief's MOBILE priority through `order-*`; from `lg` up
 * `order-none` restores the desktop row order; from `2xl` paired rows sit
 * side by side. Each band is its own Suspense boundary, and the loaders that
 * two bands share (My Day, the worklist) run once per request.
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
import type { Period } from "@/lib/dashboard/period";
import { loadDashboardThresholds, type DashboardThresholds } from "@/lib/dashboard/thresholds";
import { clientIds, clientsWhere, loadBookTargets, num, type BookScope, type ClientFilter, type MyWindow } from "@/lib/dashboard/my/window";
import { buildBookWindow } from "@/lib/dashboard/my/build-window";
import { loadMonthlySummary, loadMyKpis, loadMyTrend, loadTargetMeters, monthLabels, phaseFraction } from "@/lib/dashboard/my/kpis";
import { loadClientBook, loadDataQuality, loadReviewDesk, loadRiskDesk } from "@/lib/dashboard/my/clients";
import {
  loadInsuranceView, loadLeadFunnel, loadMeetingDesk, loadMyQueries, loadMyTasks, loadProposalDesk,
  loadRedemptionWatch, loadSipHealth,
} from "@/lib/dashboard/my/pipeline";
import {
  addDaysISO, loadFlowByMonth, loadLeadActions, loadMeetingPrep, loadMyDay, loadOnboarding, loadOverdue,
  loadTodayProgress, loadUpcoming, loadWorklist,
  type MyDay, type WorkItem,
} from "@/lib/dashboard/my/desk";
import { buildFyScorecard, loadWindowMetrics } from "@/lib/dashboard/branch/sections";
import { runLimit } from "@/lib/dashboard/run-limit";
import { cn } from "@/lib/utils";

import {
  MyClientBook, MyDataQuality, MyInsurance, MyKpiStrip, MyMonthlySummary,
  MyQueryPanel, MyRiskDesk, MySipHealth, MyTrendChart, QuickActions,
} from "./my";
import { MY_VOICE } from "./my/voice";
import {
  BranchFunnel, BranchProposals, BranchRedemptions, BranchReviews, BranchTargets, FyScorecard, HV_PRESETS,
  type Horizon,
} from "./branch";
import {
  DeskFilters, DeskMeetings, DeskTasks, FlowChart, LeadsNeedingAction, MorningBrief, MyDayPanel,
  NeedsMyAttention, OnboardingPipeline, UpcomingWeek,
} from "./desk";
import { ParamSelect } from "./branch/ParamSelect";

/* ─────────────────────────────── layout cells ─────────────────────────────── */

/** The brief's MOBILE priority. From `lg` up every cell is `order-none`. */
const ORDER = {
  brief: "order-1", day: "order-2", attention: "order-3", work: "order-4", reviews: "order-5",
  sip: "order-6", tasks: "order-7", meetings: "order-8", kpi: "order-9", targets: "order-10",
  leads: "order-11", rest: "order-12",
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

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

const UUID = /^[0-9a-f-]{36}$/i;

/** The client filters in the URL, validated — anything unrecognised is dropped. */
function parseClientFilter(sp: Record<string, string | string[] | undefined>, fyStart: string): ClientFilter | undefined {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const f: ClientFilter = {};
  const cats = s("cat").split(",").map((c) => c.trim()).filter((c) => ["A", "B", "C", "D", "none"].includes(c));
  if (cats.length) f.categories = cats;
  if (["head", "member", "individual"].includes(s("ctype"))) f.type = s("ctype") as ClientFilter["type"];
  if (s("cnew") === "new" || s("cnew") === "existing") f.cohort = { kind: s("cnew") as "new" | "existing", since: fyStart };
  if (s("cstatus") === "active" || s("cstatus") === "inactive") f.activity = s("cstatus") as "active" | "inactive";
  if (s("city") && s("city").length <= 80) f.city = s("city");
  if (s("src") && s("src").length <= 60) f.source = s("src");
  if (UUID.test(s("fam"))) f.familyId = s("fam");
  return Object.keys(f).length ? f : undefined;
}

export async function MyBusinessDashboard({
  session,
  period = "mtd",
  customStart,
  customFrom,
  customTo,
  sp,
  basePath,
  team,
  viewing = null,
}: {
  session: SessionUser;
  /** Where this dashboard lives (/dashboard/<id>) — every link it builds back to itself starts here. */
  basePath: string;
  period?: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
  sp: Record<string, string | string[] | undefined>;
  /**
   * The people who report to the viewer (lib/dashboards/team.ts). With any,
   * a "Team member" picker opens one of their desks; `viewing` is the one
   * open, already checked to be in `team`.
   */
  team?: Array<{ id: string; name: string }>;
  viewing?: { id: string; name: string } | null;
}) {
  const now = new Date();
  // Whose desk: the viewer's own, or a team member's they chose.
  const whoId = viewing?.id ?? session.userId;
  const possessive = viewing ? `${viewing.name.split(/\s+/)[0]}'s` : "My";
  // The FY start for the "new this FY" filter comes from an unfiltered window.
  const bare = buildBookWindow({
    scope: { kind: "rm", userId: whoId }, staff: [whoId], possessive, period, customStart, customFrom, customTo, now,
  });
  const filter = parseClientFilter(sp, bare.w.fyStart);
  const scope: BookScope = { kind: "rm", userId: whoId, filter };
  const { w, periodLabel, comparisonLabel } = filter
    ? buildBookWindow({ scope, staff: [whoId], possessive, period, customStart, customFrom, customTo, now })
    : bare;

  // Four transactions at a time for this render — see lib/dashboard/run-limit.ts.
  const limit = runLimit(4);
  const run: Run = (fn) =>
    limit(() => withTenant(session.tenantId, fn, {
      userId: session.userId,
      branchId: session.branchId ?? undefined,
      roles: session.roles,
    }));

  // Thresholds and the filter options: small, and needed by the filter row
  // before anything streams.
  const [t, meta] = await run(async (tx) => {
    const th = await loadDashboardThresholds(tx);
    // Options come from the WHOLE book, not the filtered one — otherwise
    // picking a city would leave that city as the only choice in its menu.
    const bookIds = clientIds({ kind: "rm", userId: whoId });
    const cities = (await tx.execute(sql`
      SELECT DISTINCT btrim(address->>'city') AS v FROM investors
       WHERE id IN ${bookIds} AND btrim(COALESCE(address->>'city', '')) <> '' ORDER BY 1 LIMIT 60
    `)).rows as Array<{ v: string }>;
    const sources = (await tx.execute(sql`
      SELECT DISTINCT btrim(source) AS v FROM leads
       WHERE converted_investor_id IN ${bookIds} AND btrim(COALESCE(source, '')) <> '' ORDER BY 1 LIMIT 40
    `)).rows as Array<{ v: string }>;
    const families = (await tx.execute(sql`
      SELECT DISTINCT f.id::text AS id, COALESCE(NULLIF(btrim(f.family_name), ''), f.head_name, 'Family') AS name
        FROM investors i JOIN families f ON f.id = i.family_id
       WHERE i.id IN ${bookIds} ORDER BY 2 LIMIT 200
    `)).rows as Array<{ id: string; name: string }>;
    return [th, { cities, sources, families }] as const;
  });

  /* ── URL state ──────────────────────────────────────────────────────── */
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "") base.set(k, v);
  base.delete("scope"); // left over from a /dashboard?scope=mine link; means nothing here
  const hrefWith = (over: Record<string, string | null>, hash = "") => {
    const q = new URLSearchParams(base);
    for (const [k, v] of Object.entries(over)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    const qs = q.toString();
    return `${basePath}${qs ? `?${qs}` : ""}${hash}`;
  };
  const tomorrow = addDaysISO(w.today, 1);
  const actionDay = sp.day === "tomorrow" ? tomorrow : w.today;
  const showProgress = sp.eod === "1";
  const horizon: Horizon = sp.tgt === "wtd" || sp.tgt === "fytd" ? sp.tgt : "mtd";
  const monday = (() => {
    const d = new Date(`${w.today}T00:00:00`);
    return addDaysISO(w.today, -((d.getDay() + 6) % 7));
  })();
  const since = horizon === "wtd" ? monday : horizon === "fytd" ? w.fyStart : `${w.today.slice(0, 8)}01`;
  const horizonPhase = t.targetPhasing === "linear"
    ? phaseFraction(since, w.today, w.fyStart, "linear")
    : horizon === "fytd" ? 1 : null;
  const monthPhase = t.targetPhasing === "linear" ? phaseFraction(`${w.today.slice(0, 8)}01`, w.today, w.fyStart, "linear") : null;
  const hvNum = Number(sp.hv);
  const highValue = Number.isFinite(hvNum) && hvNum >= 10_000 && hvNum <= 1e10 ? Math.round(hvNum) : t.largeRedemptionAbsolute;
  const staffIds = w.staff.join(",");

  const perms = {
    complete: can(session.roles, "task.edit.assigned", session.permissions) || can(session.roles, "task.edit.all", session.permissions),
  };

  // Loaded ONCE and shared: the morning brief reads My Day and the worklist.
  const dayP = run((tx) => loadMyDay(tx, w, t, actionDay));
  const workP = run((tx) => loadWorklist(tx, w, t, actionDay));
  dayP.catch(() => {});
  workP.catch(() => {});

  /* ── header ─────────────────────────────────────────────────────────── */
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now));
  const firstName = (session.name ?? session.email ?? "").split(/[\s@]/)[0] || "there";
  const greeting = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, ${firstName}`;
  const filters: AppliedFilter[] = [];
  const label: Record<string, (v: string) => string> = {
    cat: (v) => v.split(",").map((c) => (c === "none" ? "Uncategorised" : c)).join(", "),
    ctype: (v) => ({ head: "Family head", member: "Family member", individual: "Individual" } as Record<string, string>)[v] ?? v,
    cnew: (v) => (v === "new" ? "New this FY" : "Existing"),
    cstatus: (v) => (v === "active" ? "Active" : "Inactive"),
    city: (v) => v,
    src: (v) => (v === "__none__" ? "Not recorded" : v.replace(/_/g, " ")),
    fam: (v) => meta.families.find((f) => f.id === v)?.name ?? "Family",
  };
  const names: Record<string, string> = { cat: "Category", ctype: "Type", cnew: "Clients", cstatus: "Status", city: "City", src: "Source", fam: "Family" };
  for (const k of Object.keys(names)) {
    const v = typeof sp[k] === "string" ? (sp[k] as string) : "";
    if (v) filters.push({ params: [k], label: names[k], value: label[k](v) });
  }
  const touched = ["period", "day", "eod", "tgt", "hv", ...Object.keys(names)]
    .some((k) => typeof sp[k] === "string" && sp[k] !== "");

  return (
    <div className="max-w-screen-2xl space-y-6">
      {/* ── One row: actions · period · Filters — sticky under the top bar on
          desktop. The client filters fold behind "Filters"; whatever is
          applied still shows as chips below. ── */}
      <div className="dash-toolbar space-y-2.5 border-b border-border bg-background pb-3 lg:sticky lg:top-16 lg:z-30 lg:pt-3">
        <FilterDisclosure
          keys={["cat", "ctype", "cnew", "cstatus", "city", "src", "fam"]}
          start={<QuickActions session={session} />}
          leading={
            <>
              {team && team.length > 0 && (
                <ParamSelect
                  param="member"
                  value={viewing?.id ?? ""}
                  allLabel="My desk"
                  options={team.map((m) => ({ value: m.id, label: m.name }))}
                  ariaLabel="Team member"
                />
              )}
              <DashboardHeaderBar period={period} currentLabel={periodLabel} variant="light" />
            </>
          }
        >
          <DeskFilters
            cities={meta.cities.map((c) => ({ value: c.v, label: c.v }))}
            sources={[...meta.sources.map((s) => ({ value: s.v, label: s.v.replace(/_/g, " ") })), { value: "__none__", label: "Not recorded" }]}
            families={meta.families.map((f) => ({ value: f.id, label: f.name }))}
          />
        </FilterDisclosure>
        <AppliedFilterChips
          periodLabel={periodLabel}
          comparisonLabel={comparisonLabel}
          filters={filters}
          resetHref={basePath}
          showReset={touched}
        />
        <nav aria-label="Jump to section" className="dash-nav -mx-1 px-1">
          {([
            ["my-day", "My Day"], ["attention", "Needs attention"], ["meetings", "Meetings"],
            ["reviews", "Reviews"], ["leads", "Leads"], ["sip", "SIP"], ["tasks", "Tasks & service requests"],
            ["insurance", "Insurance & risk"], ["month-on-month", "Month on month"], ["fy", "FY performance"],
          ] as const).map(([id, l]) => (
            <a key={id} href={`#${id}`}>{l}</a>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2">
        {/* §35 morning priorities */}
        <Suspense fallback={<Loading order="brief" />}>
          <BriefBand dayP={dayP} workP={workP} userKey={session.userId} today={w.today} greeting={greeting} />
        </Suspense>

        {/* Row 2 · §1 My Day (+ §36 today's progress) */}
        <Suspense fallback={<Loading order="day" />}>
          <DayBand dayP={dayP} run={run} w={w} showProgress={showProgress}
            hrefs={{
              today: hrefWith({ day: null }, "#my-day"),
              tomorrow: hrefWith({ day: "tomorrow" }, "#my-day"),
              progressOn: hrefWith({ eod: "1" }, "#my-day"),
              progressOff: hrefWith({ eod: null }, "#my-day"),
            }} />
        </Suspense>

        {/* Row 3 · §2 Needs my attention */}
        <Suspense fallback={<Loading order="attention" />}>
          <OverdueBand run={run} w={w} t={t} />
        </Suspense>

        {/* Row 4 · §3 KPI strip */}
        <Suspense fallback={<Loading order="kpi" />}>
          <KpiBand run={run} w={w} periodLabel={periodLabel} />
        </Suspense>

        {/* Row 5 · §4 targets */}
        <Suspense fallback={<Loading order="targets" />}>
          <TargetsBand run={run} w={w} since={since} phase={horizonPhase} horizon={horizon} phasing={t.targetPhasing}
            hrefs={{ wtd: hrefWith({ tgt: "wtd" }, "#targets"), mtd: hrefWith({ tgt: null }, "#targets"), fytd: hrefWith({ tgt: "fytd" }, "#targets") }} />
        </Suspense>

        {/* Row 6 · §6 upcoming 7 days. The §5 worklist table was removed at the
            firm's request on 2026-10-01; the morning brief still shows its head. */}
        <Suspense fallback={<Loading order="work" />}>
          <UpcomingBand run={run} w={w} />
        </Suspense>

        {/* Row 7 · §7–8 meetings + §9 reviews */}
        <Suspense fallback={<Loading order="meetings" />}>
          <MeetingsBand run={run} w={w} periodLabel={periodLabel} staffIds={staffIds} monthPhase={monthPhase} />
        </Suspense>

        {/* Row 8 · §10 client book */}
        <Suspense fallback={<Loading order="rest" />}>
          <BookBand run={run} w={w} />
        </Suspense>

        {/* Row 9 · §13–14 leads + §15–16 proposals */}
        <Suspense fallback={<Loading order="leads" />}>
          <LeadsBand run={run} w={w} t={t} periodLabel={periodLabel} />
        </Suspense>

        {/* Row 10 · §17–18 SIP health */}
        <Suspense fallback={<Loading order="sip" />}>
          <SipBand run={run} w={w} periodLabel={periodLabel} />
        </Suspense>

        {/* Row 11 · trend, §21 investment flow + §20 redemption watch */}
        <Suspense fallback={<Loading order="rest" />}>
          <FlowBand run={run} w={w} periodLabel={periodLabel} highValue={highValue}
            presetHrefs={HV_PRESETS.map((v) => ({ value: v, href: hrefWith({ hv: String(v) }, "#redemptions") }))}
            customAction={basePath} customHidden={[...base.entries()].filter(([k]) => k !== "hv")} />
        </Suspense>

        {/* Row 12 · §24 tasks + §25 queries */}
        <Suspense fallback={<Loading order="tasks" />}>
          <TasksBand run={run} w={w} periodLabel={periodLabel} staffIds={staffIds} canComplete={perms.complete} />
        </Suspense>

        {/* Row 13 · §23 insurance + §26 risk; Row 14 · §27 data */}
        <Suspense fallback={<Loading order="rest" />}>
          <RelationshipBand run={run} w={w} />
        </Suspense>

        {/* §28 onboarding */}
        <Suspense fallback={<Loading order="rest" />}>
          <OnboardingBand run={run} w={w} />
        </Suspense>

        {/* Row 15 · §33 month on month */}
        <Suspense fallback={<Loading order="rest" />}>
          <MonthBand run={run} w={w} />
        </Suspense>

        {/* Row 16 · §32 FY performance */}
        <Suspense fallback={<Loading order="rest" />}>
          <FyBand run={run} w={w} t={t} />
        </Suspense>
      </div>
    </div>
  );
}

/* ──────────────────────────────── bands ──────────────────────────────── */

async function BriefBand({
  dayP, workP, userKey, today, greeting,
}: {
  dayP: Promise<MyDay>; workP: Promise<{ items: WorkItem[] }>; userKey: string; today: string; greeting: string;
}) {
  const [day, work] = [await dayP, await workP];
  const card = (k: string) => day.cards.find((c) => c.key === k);
  const counts = [
    { label: "Meetings", key: "meetings" }, { label: "Reviews", key: "reviews" }, { label: "Follow-ups", key: "followups" },
    { label: "Tasks", key: "tasks" }, { label: "SIP exceptions", key: "sip" }, { label: "Service requests", key: "queries" },
    { label: "Renewals", key: "renewals" },
  ].map((c) => ({ label: c.label, value: card(c.key)?.count ?? null, href: card(c.key)?.href ?? "#my-day" }));
  const top = work.items.slice(0, 8).map((i) => ({
    key: i.key, action: i.action, client: i.client, why: i.why.join(" · "), dueText: i.dueText,
    href: i.related.href, priority: i.priority, overdue: i.bucket === "overdue",
  }));
  return (
    <Cell order="brief">
      <MorningBrief userKey={userKey} today={today} greeting={greeting} counts={counts} top={top} />
    </Cell>
  );
}

async function DayBand({
  dayP, run, w, showProgress, hrefs,
}: {
  dayP: Promise<MyDay>; run: Run; w: MyWindow; showProgress: boolean;
  hrefs: { today: string; tomorrow: string; progressOn: string; progressOff: string };
}) {
  const [day, progress] = [await dayP, showProgress ? await run((tx) => loadTodayProgress(tx, w)) : null];
  return (
    <Cell order="day" id="my-day">
      <MyDayPanel data={day} hrefs={hrefs} progress={progress} showProgress={showProgress} />
    </Cell>
  );
}

async function OverdueBand({ run, w, t }: { run: Run; w: MyWindow; t: DashboardThresholds }) {
  const cards = await run((tx) => loadOverdue(tx, w, t));
  return <Cell order="attention"><NeedsMyAttention cards={cards} /></Cell>;
}

async function KpiBand({ run, w, periodLabel }: { run: Run; w: MyWindow; periodLabel: string }) {
  const kpis = await run((tx) => loadMyKpis(tx, w));
  return <Cell order="kpi"><MyKpiStrip kpis={kpis} periodLabel={periodLabel} title="My business" /></Cell>;
}

async function TargetsBand({
  run, w, since, phase, horizon, phasing, hrefs,
}: {
  run: Run; w: MyWindow; since: string; phase: number | null; horizon: Horizon; phasing: "linear" | "none";
  hrefs: Partial<Record<Horizon, string>>;
}) {
  const meters = await run((tx) => loadTargetMeters(tx, { ...w, to: w.today }, { since, phase }));
  return (
    <Cell order="targets" id="targets">
      <BranchTargets
        meters={meters} horizon={horizon} hrefs={hrefs} phasing={phasing} fyLabel={w.fiscalYear} oneRm={null}
        title="My target tracker" personal
        options={[{ key: "wtd", label: "Weekly" }, { key: "mtd", label: "Monthly" }, { key: "fytd", label: "FYTD" }]}
      />
    </Cell>
  );
}

async function UpcomingBand({ run, w }: { run: Run; w: MyWindow }) {
  const upcoming = await run((tx) => loadUpcoming(tx, w, 7));
  return (
    <Cell order="work" id="upcoming">
      <UpcomingWeek items={upcoming} today={w.today} />
    </Cell>
  );
}

async function MeetingsBand({
  run, w, periodLabel, staffIds, monthPhase,
}: {
  run: Run; w: MyWindow; periodLabel: string; staffIds: string; monthPhase: number | null;
}) {
  const [desk, prep, reviews, targetOf, monthMeetings] = await run(async (tx) => [
    await loadMeetingDesk(tx, w),
    await loadMeetingPrep(tx, w, 6),
    await loadReviewDesk(tx, w),
    await loadBookTargets(tx, w),
    await loadWindowMetrics(tx, w, `${w.today.slice(0, 8)}01`, w.today),
  ] as const);
  const annual = targetOf("meetings");
  const target = {
    target: annual != null && monthPhase != null ? annual * monthPhase : null,
    actual: monthMeetings.meetings,
    missing: annual == null ? "No meetings target set" : monthPhase == null ? "Not phased" : null,
  };
  return (
    <>
      <Cell order="meetings" wide={false} id="meetings">
        <DeskMeetings desk={desk} prep={prep} periodLabel={periodLabel} staffIds={staffIds} target={target} today={w.today} />
      </Cell>
      <Cell order="reviews" wide={false} id="reviews">
        <BranchReviews data={reviews} ledger={[]} voice={MY_VOICE} rmHref={() => "#"} />
      </Cell>
    </>
  );
}

async function BookBand({ run, w }: { run: Run; w: MyWindow }) {
  const book = await run((tx) => loadClientBook(tx, w));
  return (
    <Cell order="rest" id="client-book">
      <MyClientBook book={book} voice={MY_VOICE} />
    </Cell>
  );
}

async function LeadsBand({ run, w, t, periodLabel }: { run: Run; w: MyWindow; t: DashboardThresholds; periodLabel: string }) {
  const [funnel, actions, proposals] = await run(async (tx) => [
    await loadLeadFunnel(tx, w, t.staleLeadDays),
    await loadLeadActions(tx, w, t.staleLeadDays),
    await loadProposalDesk(tx, w),
  ] as const);
  return (
    <>
      <Cell order="leads" wide={false} id="leads">
        <BranchFunnel funnel={funnel} ledger={[]} voice={MY_VOICE} rmHref={() => "#"} />
      </Cell>
      <Cell order="leads" wide={false}>
        <BranchProposals desk={proposals} ledger={[]} voice={MY_VOICE} rmHref={() => "#"} periodLabel={periodLabel}
          ageingDays={t.proposalAgeingDays} />
      </Cell>
      <Cell order="leads">
        <LeadsNeedingAction data={actions} voice={MY_VOICE} />
      </Cell>
    </>
  );
}

async function SipBand({ run, w, periodLabel }: { run: Run; w: MyWindow; periodLabel: string }) {
  const sip = await run((tx) => loadSipHealth(tx, w));
  return (
    <Cell order="sip" id="sip">
      <MySipHealth data={sip} periodLabel={periodLabel} />
    </Cell>
  );
}

async function FlowBand({
  run, w, periodLabel, highValue, presetHrefs, customAction, customHidden,
}: {
  run: Run; w: MyWindow; periodLabel: string; highValue: number;
  presetHrefs: Array<{ value: number; href: string }>; customAction: string; customHidden: Array<[string, string]>;
}) {
  const [trend, flow, red] = await run(async (tx) => [
    await loadMyTrend(tx, w),
    await loadFlowByMonth(tx, w),
    await loadRedemptionWatch(tx, w, highValue),
  ] as const);
  return (
    <>
      <Cell order="rest">
        <MyTrendChart trend={trend} title="My business trend" showBalances />
      </Cell>
      <Cell order="rest" wide={false}>
        <FlowChart data={flow} />
      </Cell>
      <Cell order="rest" wide={false} id="redemptions">
        <BranchRedemptions data={red} periodLabel={periodLabel} presetHrefs={presetHrefs}
          customAction={customAction} customHidden={customHidden} showRm={false} personal />
      </Cell>
    </>
  );
}

async function TasksBand({
  run, w, periodLabel, staffIds, canComplete,
}: {
  run: Run; w: MyWindow; periodLabel: string; staffIds: string; canComplete: boolean;
}) {
  const [tasks, queries] = await run(async (tx) => [
    await loadMyTasks(tx, w),
    await loadMyQueries(tx, w),
  ] as const);
  return (
    <>
      <Cell order="tasks" wide={false} id="tasks">
        <DeskTasks data={tasks} periodLabel={periodLabel} staffIds={staffIds} canComplete={canComplete} />
      </Cell>
      <Cell order="tasks" wide={false}>
        <MyQueryPanel data={queries} periodLabel={periodLabel} />
      </Cell>
    </>
  );
}

async function RelationshipBand({ run, w }: { run: Run; w: MyWindow }) {
  const [insurance, risk, quality] = await run(async (tx) => [
    await loadInsuranceView(tx, w),
    await loadRiskDesk(tx, w),
    await loadDataQuality(tx, w),
  ] as const);
  return (
    <>
      <Cell order="rest" wide={false} id="insurance">
        <MyInsurance data={insurance} />
      </Cell>
      <Cell order="rest" wide={false}>
        <MyRiskDesk data={risk} voice={MY_VOICE} />
      </Cell>
      <Cell order="rest">
        <MyDataQuality data={quality} voice={MY_VOICE} />
      </Cell>
    </>
  );
}

async function OnboardingBand({ run, w }: { run: Run; w: MyWindow }) {
  const onboarding = await run((tx) => loadOnboarding(tx, w));
  return (
    <Cell order="rest">
      <OnboardingPipeline data={onboarding} fyLabel={w.fiscalYear} />
    </Cell>
  );
}

async function MonthBand({ run, w }: { run: Run; w: MyWindow }) {
  const months = await run((tx) => loadMonthlySummary(tx, w));
  const { monthLabel, prevMonthLabel } = monthLabels(w.to);
  return (
    <Cell order="rest" id="month-on-month">
      <MyMonthlySummary rows={months} monthLabel={monthLabel} prevLabel={prevMonthLabel} />
    </Cell>
  );
}

async function FyBand({ run, w, t }: { run: Run; w: MyWindow; t: DashboardThresholds }) {
  const [fy, targetOf, balances] = await run(async (tx) => [
    await loadWindowMetrics(tx, w, w.fyStart, w.today),
    await loadBookTargets(tx, w),
    // The same two sums the KPI strip shows, so the FY card cannot disagree with it.
    (await tx.execute(sql`
      SELECT COALESCE(SUM(aum::numeric), 0) AS aum, COALESCE(SUM(active_sip_amount::numeric), 0) AS sip_book
        FROM investors WHERE ${clientsWhere(w.scope)}
    `)).rows[0] as { aum?: unknown; sip_book?: unknown } | undefined,
  ] as const);
  const elapsed = phaseFraction(w.fyStart, w.today, w.fyStart, "linear") ?? 0;
  const rows = buildFyScorecard(
    {
      aum: num(balances?.aum),
      sip_book: num(balances?.sip_book),
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
    <Cell order="rest" id="fy">
      <FyScorecard rows={rows} fyLabel={w.fiscalYear} phasing={t.targetPhasing} elapsed={elapsed}
        title={`My FY ${w.fiscalYear} performance`} />
    </Cell>
  );
}

