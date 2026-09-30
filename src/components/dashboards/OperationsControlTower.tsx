/**
 * The Operations Dashboard — pending work across the team, one of the role
 * dashboards picked from the Dashboard dropdown (a system dashboard at
 * /dashboard/<id>). Built from the 50-section operations brief, laid out by
 * the dashboard cleanup's D5; the sections and what they count are unchanged:
 *
 *   [Operations Dashboard ▾] ☆                                   ⋯
 *   Showing: whole firm                                    Updated 5:21 PM
 *                    [Today ▾] [RM ▾] [Status ▾] [+ Filter]  Apply  Save filter
 *   [Queue] [SLA & escalations ⓘ] [Team load] [Rejections] [Compliance]   [New transaction request] [Assign records]
 *   ─ the active tab's sections, and only those are loaded ─
 *
 * The Compliance tab is the compliance cards of the widget library (gaps,
 * expiries, complaints), through the viewer's record access.
 *
 * Filters are the shared dashboard filter bar's (lib/dashboards/system), saved
 * under this dashboard. The dashboard resolves them (URL → the viewer's saved
 * filter → defaults Today + Open; components/dashboards/system/centres.tsx);
 * this component maps them onto the tower's own filter model through the same
 * parser the CSV export uses (lib/dashboard/ops/params.ts), so an export is
 * exactly what is on screen.
 *
 * What a "request" is, and every derived field (type, value, pending-with), is
 * defined once in lib/dashboard/ops/window.ts; who sees what, in
 * lib/dashboard/ops/access.ts. Each band streams in its own Suspense and its
 * transaction goes through runLimit(4).
 */

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { sql } from "drizzle-orm";

import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DashboardFilterBar } from "@/components/dashboards/system/DashboardFilterBar";
import { EmbeddedWidgets } from "@/components/dashboards/system/EmbeddedWidgets";
import { formatMoney } from "@/lib/format";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { runLimit } from "@/lib/dashboard/run-limit";
import { opsAccess } from "@/lib/dashboard/ops/access";
import { istToday, parseOpsFilter, parseOpsPeriod, parseRupees } from "@/lib/dashboard/ops/params";
import {
  AGE_BUCKETS, MODE_FILTERS, OPS_KINDS, OPS_ROLES, PENDING_WITH, PRIORITIES, SLA_STATES, STATUS_FILTERS, textArray, type OpsWindow,
} from "@/lib/dashboard/ops/window";
import { loadAttention, loadCommandStrip, loadDayCounts, loadQueue } from "@/lib/dashboard/ops/queue";
import {
  loadAgeing, loadCarryForward, loadFeedValue, loadFunnel, loadReview, loadSla, loadTatByKind, loadTrend, loadVolume,
} from "@/lib/dashboard/ops/flow";
import { loadRejections, loadSipControl } from "@/lib/dashboard/ops/sip";
import {
  loadApprovals, loadBackOffice, loadBranchWise, loadFinancialTasks, loadNonFinancialTasks, loadProductivity, loadRmWise, loadTeam,
} from "@/lib/dashboard/ops/people";
import {
  loadClientMaster, loadDocs, loadExternal, loadHighValue, loadNoUpdate, loadOpsDataQuality, loadPendingWith, loadQueries,
  loadRejected, loadRework, loadUnassigned,
} from "@/lib/dashboard/ops/exceptions";
import { SYSTEM_DASHBOARD_BY_KEY } from "@/lib/dashboards/system/definitions";
import type { DataAccess } from "@/lib/dashboards/system/access";
import { FILTER_FIELDS, filterStateToParams, type FilterKey, type FilterState } from "@/lib/dashboards/system/filters";
import { CATEGORY_OPTIONS, type FilterOptions, type Option } from "@/lib/dashboards/system/options";
import { cn } from "@/lib/utils";

import {
  AgeingPanel, ApprovalsPanel, AttentionPanel, BackOfficePanel, BranchRmPanel, CommandStripPanel, DocsPanel, ExternalPanel,
  FunnelPanel, HighValuePanel, NoUpdatePanel, OpsQuickActions, OpsTrend, PendingWithPanel, ProcessingQueue,
  ProductivityPanel, QualityPanel, QueriesPanel, RejectedPanel, RejectionsPanel, ReviewPanel, SipControlPanel, SlaPanel,
  StandupPanel, TaskQueuePanel, TatQualityPanel, TeamPanel, TimelinePanel, UnassignedPanel, ValuePanel, VolumePanel,
} from "./ops";

/* ───────────────────────────── tabs ───────────────────────────── */

export const OPS_TABS = [
  { key: "queue", label: "Queue" },
  { key: "sla", label: "SLA & escalations" },
  { key: "team", label: "Team load" },
  { key: "rejections", label: "Rejections" },
  { key: "compliance", label: "Compliance" },
] as const;
export type OpsTab = (typeof OPS_TABS)[number]["key"];

/** Which tab each section lives on — a link to a section opens its tab first. */
const TAB_OF: Record<string, OpsTab> = {
  standup: "queue", attention: "queue", queue: "queue", "high-value": "queue", volume: "queue", queries: "queue",
  financial: "queue", unassigned: "queue",
  sla: "sla", tat: "sla", carry: "sla", "no-update": "sla", quality: "sla", review: "sla",
  team: "team", "pending-with": "team", external: "team", "branch-rm": "team",
  sip: "rejections", rejected: "rejections", docs: "rejections",
};

/** Params that choose a view inside a tab, not a filter. Carried from tab to tab. */
const VIEW_PARAMS = ["hv", "nu", "eod", "vh", "review"] as const;
/** Params the filter bar owns. */
const FILTER_PARAMS = new Set<string>(["period", "from", "to", ...Object.values(FILTER_FIELDS).map((f) => f.param)]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────────── layout cells ───────────────────────────── */

/** The brief's MOBILE priority on the Queue tab; from `lg` up every cell is `order-none` (desktop row order). */
const ORDER = {
  standup: "order-1", attention: "order-2", queue: "order-3", queries: "order-4", tasks: "order-5",
  strip: "order-6", highValue: "order-7", rest: "order-10",
} as const;
type OrderKey = keyof typeof ORDER;

function Cell({ order = "rest", wide = true, id, children }: { order?: OrderKey; wide?: boolean; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={cn(ORDER[order], "min-w-0 scroll-mt-20 lg:order-none", wide && "2xl:col-span-2")}>
      {children}
    </div>
  );
}

function Loading({ order = "rest", wide = true }: { order?: OrderKey; wide?: boolean }) {
  return (
    <Cell order={order} wide={wide}>
      <div className="card-surface animate-pulse space-y-3 p-5" aria-hidden>
        <div className="h-4 w-1/3 rounded bg-secondary" />
        <div className="h-24 rounded-lg bg-secondary" />
        <div className="h-3 w-2/3 rounded bg-secondary" />
      </div>
    </Cell>
  );
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
type Hrefs = Record<string, string>;
type Over = Record<string, string | null>;
type Person = { id: string; name: string | null };

const HV_PRESETS = [100_000, 500_000, 1_000_000, 2_500_000, 5_000_000];
const HV_LABEL: Record<number, string> = { 100000: "₹1 L+", 500000: "₹5 L+", 1000000: "₹10 L+", 2500000: "₹25 L+", 5000000: "₹50 L+" };
const NU_PRESETS = [1, 2, 3, 5];

export async function OperationsControlTower({
  session, basePath, sp, state, defaults, explicit, usingSaved, dashboardId,
}: {
  session: SessionUser;
  /** Where this dashboard lives (/dashboard/<id>) — every link it builds back to itself starts here. */
  basePath: string;
  /** The URL. Filters come in through `state`; only the tab and view params are read from here. */
  sp: Record<string, string | string[] | undefined>;
  /** The filters in force: the URL's, else the viewer's saved filter, else `defaults`. */
  state: FilterState;
  defaults: FilterState;
  /** The URL set the filters (so links carry them); otherwise links leave them out and the page resolves them again. */
  explicit: boolean;
  usingSaved: boolean;
  /** This dashboard's id — where "Save filter" stores this viewer's filter. */
  dashboardId: string;
}) {
  const now = new Date();
  const access = opsAccess(session);
  const def = SYSTEM_DASHBOARD_BY_KEY.operations;
  const fieldKeys: FilterKey[] = [...(def.filters.pinned ?? []), ...def.filters.fields];

  const limit = runLimit(4);
  const run: Run = (fn) =>
    limit(() => withTenant(session.tenantId, fn, {
      userId: session.userId,
      branchId: session.branchId ?? undefined,
      roles: session.roles,
    }));

  // Thresholds and the filter bar's choices — small, and the header needs them first.
  const [t, meta] = await run(async (tx) => {
    const th = await loadDashboardThresholds(tx);
    const branches = access.scope.kind === "firm"
      ? (await tx.execute(sql`SELECT id::text AS id, name FROM branches WHERE tenant_id = ${session.tenantId}::uuid ORDER BY name`)).rows as Person[]
      : [];
    const rms = (await tx.execute(sql`
      SELECT DISTINCT u.id::text AS id, u.name FROM users u
       WHERE u.tenant_id = ${session.tenantId}::uuid AND u.roles && ARRAY['rm', 'branch_head']::text[]
         AND u.status <> 'offboarded'
         ${access.scope.kind === "branch" ? sql`AND u.branch_id = ${access.scope.branchId}::uuid` : sql``}
       ORDER BY u.name
    `)).rows as Person[];
    const execs = (await tx.execute(sql`
      SELECT u.id::text AS id, u.name FROM users u
       WHERE u.tenant_id = ${session.tenantId}::uuid AND u.status = 'active'
         AND (u.roles && ${textArray(OPS_ROLES)} OR u.id IN (
               SELECT DISTINCT assignee_id FROM tasks WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
                  AND status IN ('open', 'in_progress', 'blocked') AND assignee_id IS NOT NULL
                  AND (department IN ('operations', 'back_office') OR type = 'back_office_work')))
       ORDER BY u.name
    `)).rows as Person[];
    // A drill-down (an RM row, a team member) can filter on someone the lists
    // above leave out — an RM who has left, an assignee outside operations.
    // Their names are fetched so the chip reads as a name, not an id.
    const known = new Set([...rms, ...execs].map((u) => u.id));
    const referenced = [...new Set([...(state.values.rm ?? []), ...(state.values.executive ?? [])])]
      .filter((x) => UUID.test(x) && !known.has(x));
    const others = referenced.length
      ? (await tx.execute(sql`
          SELECT id::text AS id, name FROM users
           WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${sql.join(referenced.map((x) => sql`${x}::uuid`), sql`, `)})
        `)).rows as Person[]
      : [];
    return [th, { branches, rms, execs, others }] as const;
  });

  /* ── the filter bar's choices, and the filters they allow ─────────────── */
  const opt = (xs: Person[]): Option[] => xs.map((x) => ({ value: x.id, label: x.name ?? "—" }));
  const options: FilterOptions = {
    // "Me" = work assigned to the viewer (lib/dashboard/ops/window.ts, OpsFilter.mine).
    rm: [{ value: "me", label: "Me" }, ...opt(meta.rms), ...opt(meta.others.filter((u) => state.values.rm?.includes(u.id)))],
    status: STATUS_FILTERS.map((s) => ({ value: s.key, label: s.label })),
    ...(meta.branches.length ? { branch: opt(meta.branches) } : {}),
    executive: [
      { value: "none", label: "Not assigned" },
      ...opt(meta.execs),
      ...opt(meta.others.filter((u) => state.values.executive?.includes(u.id))),
    ],
    requestType: OPS_KINDS.map((k) => ({ value: k.key, label: k.label })),
    priority: PRIORITIES.map((p) => ({ value: p.key, label: p.label })),
    slaState: SLA_STATES.map((s) => ({ value: s.key, label: s.label })),
    pendingWith: PENDING_WITH.map((p) => ({ value: p.key, label: p.label })),
    ageing: AGE_BUCKETS.map((b) => ({ value: b.key, label: b.label })),
    mode: MODE_FILTERS.map((m) => ({ value: m.key, label: m.label })),
    category: CATEGORY_OPTIONS,
  };
  // Only fields this page offers, and only values it knows. A filter the
  // viewer cannot use (Branch, for anyone locked to a branch) is dropped,
  // never silently applied.
  const values: FilterState["values"] = {};
  for (const k of fieldKeys) {
    const keep = (state.values[k] ?? []).filter((v) => options[k]?.some((o) => o.value === v));
    if (keep.length) values[k] = keep;
  }
  const clean: FilterState = { ...state, values };
  const bar = {
    rm: false,
    branch: false,
    pinned: def.filters.pinned ?? [],
    extras: def.filters.fields.filter((k) => (options[k]?.length ?? 0) > 0),
  };

  /* ── the tower's window, parsed exactly as the export parses it ────────── */
  const filterQuery = filterStateToParams(clean);
  const filterParams = Object.fromEntries(filterQuery.entries());
  const filter = parseOpsFilter(filterParams, session.userId);
  const p = parseOpsPeriod(filterParams, now);
  const today = istToday(now);
  const fyStart = `${Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0)}-04-01`;
  const w: OpsWindow = {
    tenantId: session.tenantId, userId: session.userId, scope: access.scope, filter,
    from: p.from, to: p.to, today, periodLabel: p.label, t,
  };
  const exportQuery = filterQuery.toString();

  /* ── URL state: tab and view params ───────────────────────────────────── */
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const tab: OpsTab = OPS_TABS.find((x) => x.key === one("tab"))?.key ?? "queue";
  const view = new URLSearchParams();
  for (const k of VIEW_PARAMS) if (one(k)) view.set(k, one(k));

  /**
   * A link inside the page. The filters in force are written into it when the
   * URL set them, or when the link changes one — a drill-down only narrows
   * what is on screen. A plain tab switch on the default view leaves them out,
   * so the saved filter (or the defaults) keeps applying.
   */
  const params = (tabKey: OpsTab, over: Over = {}) => {
    const out = new URLSearchParams();
    if (explicit || Object.keys(over).some((k) => FILTER_PARAMS.has(k))) for (const [k, v] of filterQuery) out.set(k, v);
    for (const [k, v] of view) out.set(k, v);
    if (tabKey !== "queue") out.set("tab", tabKey);
    for (const [k, v] of Object.entries(over)) {
      if (v == null) out.delete(k);
      else out.set(k, v);
    }
    return out;
  };
  const href = (tabKey: OpsTab, over: Over = {}, anchor = "") => {
    const q = params(tabKey, over).toString();
    return `${basePath}${q ? `?${q}` : ""}${anchor ? `#${anchor}` : ""}`;
  };
  /** A section by its anchor, on whichever tab holds it. */
  const at = (anchor: string, over: Over = {}) => href(TAB_OF[anchor] ?? "queue", over, anchor);
  /** Loaders speak in bare anchors ("#rejected"); here they become the right tab. */
  const resolve = (h: string) => (h.startsWith("#") ? at(h.slice(1)) : h);

  const highValue = parseRupees(one("hv"), t.opsHighValue);
  const nuRaw = Number(one("nu"));
  const noUpdateDays = Number.isInteger(nuRaw) && nuRaw >= 1 && nuRaw <= 60 ? nuRaw : t.opsNoUpdateDays;
  const eod = one("eod") === "1";
  const vh = one("vh") === "week" || one("vh") === "mtd" ? one("vh") : "today";
  const reviewMode = one("review") === "weekly" || one("review") === "monthly" ? (one("review") as "weekly" | "monthly") : null;
  const monday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  const vFrom = vh === "week" ? monday : vh === "mtd" ? `${today.slice(0, 8)}01` : today;
  const vLabel = vh === "week" ? "This week" : vh === "mtd" ? "This month" : "Today";

  const hrefs: Hrefs = {
    queue: at("queue"),
    breached: at("queue", { sla: "breached" }),
    within: at("queue", { sla: "within" }),
    approaching: at("queue", { sla: "approaching" }),
    highValue: at("high-value"),
    sip: at("sip"),
    docs: at("queue", { kind: "documentation" }),
    docsBreached: at("queue", { kind: "documentation", sla: "breached" }),
    unassigned: at("queue", { exec: "none" }),
    queries: at("queries"),
    rejected: at("rejected"),
    pendingWith: at("pending-with"),
    tat: at("tat"),
    morning: at("standup", { eod: null }),
    closure: at("standup", { eod: "1" }),
    reg: at("queue", { kind: "sip_registration" }),
    mod: at("queue", { kind: "sip_modification" }),
    stop: at("queue", { kind: "sip_stop" }),
    today: at("volume", { vh: null }),
    week: at("volume", { vh: "week" }),
    mtd: at("volume", { vh: "mtd" }),
    weekly: at("review", { review: "weekly" }),
    monthly: at("review", { review: "monthly" }),
    ...Object.fromEntries(OPS_KINDS.map((k) => [`kind:${k.key}`, at("queue", { kind: k.key })])),
  };

  const canEditAll = can(session.roles, "task.edit.all", session.permissions);
  const canEditOwn = can(session.roles, "task.edit.assigned", session.permissions);
  const team = meta.execs.map((e) => ({ value: e.id, label: e.name ?? "—" }));

  // §45 — the escalation levels, beside the SLA tab rather than a paragraph on the page.
  const escalation = [
    "Escalation levels",
    `Level 1, attention: SLA due within ${t.opsSlaWarnHours} h.`,
    "Level 2, overdue: SLA breached.",
    `Level 3, escalate: breached by more than ${t.opsEscalateHours} h, or a ${formatMoney(highValue)}+ request past SLA.`,
    "SLA is the due time the CRM sets on each request from its priority. The thresholds are in Settings → Dashboard thresholds.",
  ].join("\n");

  return (
    <div className="max-w-screen-2xl space-y-5">
      <DashboardFilterBar
        dashboardId={dashboardId}
        state={clean}
        defaults={defaults}
        options={options}
        bar={bar}
        usingSaved={usingSaved}
      />

      {/* Quick actions first in reading order (and on a phone); tabs on the left from lg. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="lg:order-2">
          <OpsQuickActions canCreate={canEditAll || canEditOwn} assignHref={hrefs.unassigned} />
        </div>
        <div role="tablist" aria-label="Operations views"
             className="inline-flex max-w-full flex-wrap items-center gap-1 self-start rounded-lg border border-border bg-secondary/40 p-1 lg:order-1">
          {OPS_TABS.map((x) => {
            const active = x.key === tab;
            return (
              <Link
                key={x.key}
                href={href(x.key)}
                role="tab"
                aria-selected={active}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors",
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                {x.label}
                {x.key === "sla" && (
                  <span role="img" aria-label={escalation} title={escalation} className="cursor-help text-muted-foreground">
                    <Info className="size-3.5" aria-hidden />
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" aria-label={OPS_TABS.find((x) => x.key === tab)?.label}
           className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2">
        {tab === "queue" && (
          <>
            {/* §46–47 */}
            <Suspense fallback={<Loading order="standup" />}>
              <StandupBand run={run} w={w} highValue={highValue} eod={eod} hrefs={hrefs} />
            </Suspense>
            {/* §1 */}
            <Suspense fallback={<Loading order="strip" />}>
              <StripBand run={run} w={w} hrefs={hrefs} />
            </Suspense>
            {/* §2 */}
            <Suspense fallback={<Loading order="attention" />}>
              <AttentionBand run={run} w={w} highValue={highValue} resolve={resolve} />
            </Suspense>
            {/* §3 */}
            <Suspense fallback={<Loading order="queue" />}>
              <QueueBand run={run} w={w} highValue={highValue} canEditAll={canEditAll} canEditOwn={canEditOwn}
                userId={session.userId} team={team} exportQuery={exportQuery} />
            </Suspense>
            {/* §16 */}
            <Suspense fallback={<Loading order="highValue" />}>
              <HighValueBand run={run} w={w} threshold={highValue}
                presets={HV_PRESETS.map((v) => ({ value: v, label: HV_LABEL[v], href: at("high-value", { hv: String(v) }) }))}
                customAction={`${basePath}#high-value`}
                customHidden={[...params(TAB_OF["high-value"], { hv: null })]} />
            </Suspense>
            {/* §4–6 */}
            <Suspense fallback={<Loading />}>
              <VolumeBand run={run} w={w} vFrom={vFrom} vLabel={vLabel} vh={vh} hrefs={hrefs} />
            </Suspense>
            {/* §23–24 */}
            <Suspense fallback={<Loading order="queries" />}>
              <QueriesBand run={run} w={w} exportQuery={exportQuery} />
            </Suspense>
            {/* §20–22, §25 */}
            <Suspense fallback={<Loading order="tasks" />}>
              <TasksBand run={run} w={w} />
            </Suspense>
            {/* §30 */}
            <Suspense fallback={<Loading />}>
              <UnassignedBand run={run} w={w} hrefs={hrefs} />
            </Suspense>
          </>
        )}

        {tab === "sla" && (
          <>
            {/* §7–8 */}
            <Suspense fallback={<Loading />}>
              <SlaBand run={run} w={w} hrefs={hrefs} />
            </Suspense>
            {/* §33–35 */}
            <Suspense fallback={<Loading />}>
              <TatBand run={run} w={w} />
            </Suspense>
            {/* §36–37 */}
            <Suspense fallback={<Loading />}>
              <CarryBand run={run} w={w} highValue={highValue} />
            </Suspense>
            {/* §31, §28–29 */}
            <Suspense fallback={<Loading />}>
              <QualityBand run={run} w={w} noUpdateDays={noUpdateDays} resolve={resolve}
                presets={NU_PRESETS.map((v) => ({ value: v, href: at("no-update", { nu: String(v) }) }))}
                customAction={`${basePath}#no-update`}
                customHidden={[...params(TAB_OF["no-update"], { nu: null })]} />
            </Suspense>
            {/* §38–40 */}
            <Suspense fallback={<Loading />}>
              <ReviewBand run={run} w={w} mode={reviewMode} hrefs={hrefs} fyStart={fyStart} />
            </Suspense>
          </>
        )}

        {tab === "team" && (
          <>
            {/* §17–19 */}
            <Suspense fallback={<Loading />}>
              <TeamBand run={run} w={w} at={at} />
            </Suspense>
            {/* §14, §32 */}
            <Suspense fallback={<Loading />}>
              <DependencyBand run={run} w={w} />
            </Suspense>
            {/* §26–27 */}
            <Suspense fallback={<Loading />}>
              <BranchRmBand run={run} w={w} at={at} />
            </Suspense>
          </>
        )}

        {tab === "rejections" && (
          <>
            {/* §9–12 */}
            <Suspense fallback={<Loading />}>
              <SipBand run={run} w={w} hrefs={hrefs} exportQuery={exportQuery} />
            </Suspense>
            {/* §15, §13 */}
            <Suspense fallback={<Loading />}>
              <RejectedDocsBand run={run} w={w} hrefs={hrefs} exportQuery={exportQuery} />
            </Suspense>
          </>
        )}

        {tab === "compliance" && (
          <Suspense fallback={<Loading />}>
            <Cell id="compliance">
              <EmbeddedWidgets
                session={session}
                access={dataAccessOf(access.scope)}
                items={[
                  { key: "compliance_gaps", size: "M" },
                  { key: "complaints", size: "M" },
                  { key: "expiry_pipeline", size: "L" },
                ]}
                // The Branch filter and named RMs reach these cards; "Me" and
                // the request filters describe work, not clients, and do not.
                state={{
                  period: "month",
                  values: {
                    ...(clean.values.branch?.length ? { branch: clean.values.branch } : {}),
                    ...((clean.values.rm ?? []).some((x) => UUID.test(x)) ? { rm: (clean.values.rm ?? []).filter((x) => UUID.test(x)) } : {}),
                  },
                }}
                emptyMessage="No compliance gaps, expiries or open complaints for these clients."
              />
            </Cell>
          </Suspense>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── bands ───────────────────────────── */

function dataAccessOf(scope: OpsWindow["scope"]): DataAccess {
  return scope.kind === "firm" ? { kind: "firm" }
    : scope.kind === "branch" ? { kind: "branch", branchId: scope.branchId }
    : { kind: "self", userId: scope.userId };
}

type At = (anchor: string, over?: Over) => string;

async function StandupBand({ run, w, highValue, eod, hrefs }: { run: Run; w: OpsWindow; highValue: number; eod: boolean; hrefs: Hrefs }) {
  const counts = await run((tx) => loadDayCounts(tx, w, highValue));
  return <Cell order="standup" id="standup"><StandupPanel counts={counts} eod={eod} hrefs={hrefs} /></Cell>;
}

async function StripBand({ run, w, hrefs }: { run: Run; w: OpsWindow; hrefs: Hrefs }) {
  const s = await run((tx) => loadCommandStrip(tx, w));
  return <Cell order="strip"><CommandStripPanel s={s} periodLabel={w.periodLabel} hrefs={hrefs} /></Cell>;
}

async function AttentionBand({ run, w, highValue, resolve }: { run: Run; w: OpsWindow; highValue: number; resolve: (h: string) => string }) {
  const cards = await run((tx) => loadAttention(tx, w, highValue));
  return (
    <Cell order="attention" id="attention">
      <AttentionPanel cards={cards.map((c) => ({ ...c, href: resolve(c.href) }))} />
    </Cell>
  );
}

async function QueueBand({ run, w, highValue, canEditAll, canEditOwn, userId, team, exportQuery }: {
  run: Run; w: OpsWindow; highValue: number; canEditAll: boolean; canEditOwn: boolean; userId: string;
  team: Array<{ value: string; label: string }>; exportQuery: string;
}) {
  const q = await run((tx) => loadQueue(tx, w, highValue, 200));
  return (
    <Cell order="queue" id="queue">
      <ProcessingQueue items={q.items} total={q.total} canEditAll={canEditAll} canEditOwn={canEditOwn} userId={userId}
        team={team} exportQuery={exportQuery} highValue={highValue} />
    </Cell>
  );
}

async function HighValueBand({ run, w, threshold, presets, customAction, customHidden }: {
  run: Run; w: OpsWindow; threshold: number; presets: Array<{ value: number; label: string; href: string }>;
  customAction: string; customHidden: Array<[string, string]>;
}) {
  const rows = await run((tx) => loadHighValue(tx, w, threshold));
  return (
    <Cell order="highValue" id="high-value">
      <HighValuePanel rows={rows} threshold={threshold} presets={presets} customAction={customAction} customHidden={customHidden} />
    </Cell>
  );
}

async function VolumeBand({ run, w, vFrom, vLabel, vh, hrefs }: {
  run: Run; w: OpsWindow; vFrom: string; vLabel: string; vh: string; hrefs: Hrefs;
}) {
  const [vol, val, funnel] = await run(async (tx) => [
    await loadVolume(tx, w, vFrom, w.today),
    await loadFeedValue(tx, w, vFrom, w.today),
    await loadFunnel(tx, w),
  ] as const);
  return (
    <>
      <Cell wide={false} id="volume"><VolumePanel rows={vol} horizon={vh} horizonLabel={vLabel} hrefs={hrefs} /></Cell>
      <Cell wide={false}><ValuePanel data={val} horizonLabel={vLabel} /></Cell>
      <Cell><FunnelPanel funnel={funnel} periodLabel={w.periodLabel} /></Cell>
    </>
  );
}

async function QueriesBand({ run, w, exportQuery }: { run: Run; w: OpsWindow; exportQuery: string }) {
  const q = await run((tx) => loadQueries(tx, w));
  return <Cell order="queries" id="queries"><QueriesPanel d={q} periodLabel={w.periodLabel} exportQuery={exportQuery} /></Cell>;
}

async function TasksBand({ run, w }: { run: Run; w: OpsWindow }) {
  const [fin, nonFin, approvals, bo] = await run(async (tx) => [
    await loadFinancialTasks(tx, w),
    await loadNonFinancialTasks(tx, w),
    await loadApprovals(tx, w),
    await loadBackOffice(tx, w),
  ] as const);
  return (
    <>
      <Cell order="tasks" wide={false} id="financial">
        <TaskQueuePanel q={fin} financial periodLabel={w.periodLabel} href="/dashboard/tasks?department=operations,back_office" />
      </Cell>
      <Cell order="tasks" wide={false}>
        <TaskQueuePanel q={nonFin} financial={false} periodLabel={w.periodLabel} href="/dashboard/tasks" />
      </Cell>
      <Cell wide={false}><ApprovalsPanel a={approvals} /></Cell>
      <Cell wide={false}><BackOfficePanel d={bo} periodLabel={w.periodLabel} /></Cell>
    </>
  );
}

async function UnassignedBand({ run, w, hrefs }: { run: Run; w: OpsWindow; hrefs: Hrefs }) {
  const u = await run((tx) => loadUnassigned(tx, w));
  return <Cell id="unassigned"><UnassignedPanel u={u} hrefs={hrefs} /></Cell>;
}

async function SlaBand({ run, w, hrefs }: { run: Run; w: OpsWindow; hrefs: Hrefs }) {
  const [sla, ageing] = await run(async (tx) => [await loadSla(tx, w), await loadAgeing(tx, w)] as const);
  return (
    <>
      <Cell wide={false} id="sla"><SlaPanel sla={sla} periodLabel={w.periodLabel} hrefs={hrefs} /></Cell>
      <Cell wide={false}><AgeingPanel rows={ageing} /></Cell>
    </>
  );
}

async function TatBand({ run, w }: { run: Run; w: OpsWindow }) {
  const [tat, rw] = await run(async (tx) => [await loadTatByKind(tx, w), await loadRework(tx, w)] as const);
  return (
    <Cell id="tat">
      <TatQualityPanel tat={tat} rework={rw.rework} indicators={rw.indicators} periodLabel={w.periodLabel} />
    </Cell>
  );
}

async function CarryBand({ run, w, highValue }: { run: Run; w: OpsWindow; highValue: number }) {
  const [counts, days] = await run(async (tx) => [await loadDayCounts(tx, w, highValue), await loadCarryForward(tx, w)] as const);
  return <Cell id="carry"><TimelinePanel counts={counts} days={days} /></Cell>;
}

async function QualityBand({ run, w, noUpdateDays, resolve, presets, customAction, customHidden }: {
  run: Run; w: OpsWindow; noUpdateDays: number; resolve: (h: string) => string;
  presets: Array<{ value: number; href: string }>; customAction: string; customHidden: Array<[string, string]>;
}) {
  const [stale, cards, master] = await run(async (tx) => [
    await loadNoUpdate(tx, w, noUpdateDays),
    await loadOpsDataQuality(tx, w),
    await loadClientMaster(tx, w),
  ] as const);
  return (
    <>
      <Cell id="no-update">
        <NoUpdatePanel d={stale} days={noUpdateDays} presets={presets} customAction={customAction} customHidden={customHidden} />
      </Cell>
      <Cell id="quality">
        <QualityPanel cards={cards.map((c) => (c.href ? { ...c, href: resolve(c.href) } : c))} master={master} />
      </Cell>
    </>
  );
}

async function ReviewBand({ run, w, mode, hrefs, fyStart }: {
  run: Run; w: OpsWindow; mode: "weekly" | "monthly" | null; hrefs: Hrefs; fyStart: string;
}) {
  const [review, trend] = await run(async (tx) => [
    mode ? await loadReview(tx, w, mode) : null,
    await loadTrend(tx, w, fyStart),
  ] as const);
  return (
    <>
      <Cell id="review"><ReviewPanel review={review} mode={mode} hrefs={hrefs} /></Cell>
      <Cell><OpsTrend points={trend} /></Cell>
    </>
  );
}

async function TeamBand({ run, w, at }: { run: Run; w: OpsWindow; at: At }) {
  const [team, prod] = await run(async (tx) => [await loadTeam(tx, w), await loadProductivity(tx, w)] as const);
  const hrefFor: Record<string, string> = { none: at("queue", { exec: "none" }) };
  for (const r of team) if (r.id) hrefFor[r.id] = at("queue", { exec: r.id });
  return (
    <>
      <Cell id="team"><TeamPanel rows={team} hrefFor={hrefFor} /></Cell>
      <Cell><ProductivityPanel p={prod} /></Cell>
    </>
  );
}

async function DependencyBand({ run, w }: { run: Run; w: OpsWindow }) {
  const [pending, external] = await run(async (tx) => [await loadPendingWith(tx, w), await loadExternal(tx, w)] as const);
  return (
    <>
      <Cell wide={false} id="pending-with"><PendingWithPanel rows={pending} /></Cell>
      <Cell wide={false} id="external"><ExternalPanel d={external} /></Cell>
    </>
  );
}

async function BranchRmBand({ run, w, at }: { run: Run; w: OpsWindow; at: At }) {
  const [branches, rms] = await run(async (tx) => [await loadBranchWise(tx, w), await loadRmWise(tx, w)] as const);
  return (
    <Cell id="branch-rm">
      <BranchRmPanel branches={branches} rms={rms} periodLabel={w.periodLabel}
        branchHref={(id) => (id && w.scope.kind === "firm" ? at("queue", { branch: id }) : at("queue"))}
        rmHref={(id) => (id ? at("queue", { rm: id }) : at("queue"))} />
    </Cell>
  );
}

async function SipBand({ run, w, hrefs, exportQuery }: { run: Run; w: OpsWindow; hrefs: Hrefs; exportQuery: string }) {
  const [control, rejections] = await run(async (tx) => [await loadSipControl(tx, w), await loadRejections(tx, w)] as const);
  return (
    <>
      <Cell id="sip"><SipControlPanel c={control} periodLabel={w.periodLabel} hrefs={hrefs} /></Cell>
      <Cell><RejectionsPanel d={rejections} periodLabel={w.periodLabel} exportQuery={exportQuery} sla={w.t.sipRejectionSlaDays} /></Cell>
    </>
  );
}

async function RejectedDocsBand({ run, w, hrefs, exportQuery }: { run: Run; w: OpsWindow; hrefs: Hrefs; exportQuery: string }) {
  const [rejected, docs] = await run(async (tx) => [await loadRejected(tx, w), await loadDocs(tx, w)] as const);
  return (
    <>
      <Cell wide={false} id="rejected"><RejectedPanel d={rejected} periodLabel={w.periodLabel} exportQuery={exportQuery} /></Cell>
      <Cell wide={false} id="docs"><DocsPanel d={docs} exportQuery={exportQuery} hrefs={hrefs} /></Cell>
    </>
  );
}
