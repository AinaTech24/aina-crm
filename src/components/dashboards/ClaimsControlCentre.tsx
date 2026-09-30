/**
 * The Claims Dashboard — the claims team's live queue (the 60-section brief),
 * one of the role dashboards picked from the Dashboard dropdown (a system
 * dashboard at /dashboard/<id>; components/dashboards/system/centres.tsx
 * decides who may open it).
 *
 * Built around the lifecycle, not "logged versus settled": every open claim
 * answers where it is, with whom, since when, what is missing, what happens
 * next, who owns it and whether it is past SLA. Read top to bottom: the
 * headline figures; what needs action today (attention, escalations, the
 * worklist, high value and stale claims, documents, queries); the team that
 * owns them; then the analysis, trends and reviews.
 *
 * One read of the claim set (lib/dashboard/claims/set.ts) feeds every
 * section; lib/dashboard/claims/analysis.ts and review.ts turn it into each
 * section's figures. The vocabulary — what pending with, documents awaited,
 * a query and a stage are — is lib/insurance/claims-book.ts. Nothing the CRM
 * does not record (approval, TPA, hospital, claim number, rejection reason,
 * legal stage, priority) is shown as a figure; each place it would appear
 * says it is not recorded.
 */

import { Suspense, type ReactNode } from "react";
import { FileText, Landmark } from "lucide-react";

import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { CardSkeleton } from "./DashboardSkeletons";
import { DashboardHeaderBar } from "./DashboardHeaderBar";
import { AppliedFilterChips, type AppliedFilter } from "./AppliedFilterChips";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { runLimit } from "@/lib/dashboard/run-limit";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GROUP_LABEL, PRODUCT_GROUPS } from "@/lib/insurance/book";
import {
  CLAIM_AGE_BUCKETS, CLAIM_MODE_LABEL, CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL, CLAIM_VALUE_BANDS, PENDING_WITH, claimModeLabel, claimTypeLabel,
} from "@/lib/insurance/claims-book";
import { claimsAccess } from "@/lib/dashboard/claims/access";
import {
  CLAIM_FILTER_KEYS, CLIENT_UPDATE_PRESETS, HIGH_VALUE_PRESETS, NO_UPDATE_PRESETS, parseClaimFilter, parseClaimView, type WorklistFocus,
} from "@/lib/dashboard/claims/params";
import { addDays, fyLabelOf, fyStartOf, hasFilter, monthBefore, monthStart, type ClaimWindow, type Tx } from "@/lib/dashboard/claims/window";
import { applyDerived, loadClaimSet, type ClaimRec } from "@/lib/dashboard/claims/set";
import { loadClaimNames } from "@/lib/dashboard/claims/search";
import {
  FOCUS_LABEL, ageing, attention, byMode, documents, escalationCentre, funnel, groupBy, insurerName, kpiStrip, legal, levels, lineSummary,
  pendingWith, quality, queries, rejected, settledRows, settlement, slaTat, statusDistribution, tatBy, valueSummary, withoutNextAction, worklist,
} from "@/lib/dashboard/claims/analysis";
import { dailyFlow, fyScorecard, monthlyReview, monthlyTrend, weeklyReview } from "@/lib/dashboard/claims/review";
import { istToday, parseInsPeriod } from "@/lib/dashboard/insurance/params";

import { ClaimFilters } from "./claims/ClaimFilters";
import { ClaimDrawer } from "./claims/ClaimDrawer";
import { KpiStrip, ValueSummary } from "./claims/ClaimKpis";
import { AttentionPanel, EscalationCentre } from "./claims/ClaimAttention";
import { WorklistPanel } from "./claims/ClaimWorklist";
import { FunnelPanel } from "./claims/ClaimFunnel";
import {
  AgeingPanel, ClaimedVsSettledPanel, DocumentsPanel, LegalPanel, LinePanel, ModePanel, PendingWithPanel, QueriesPanel, RejectedPanel,
  SettlementPanel, SlaPanel, StatusPanel, TatTable,
} from "./claims/ClaimPanels";
import { BranchPanel, DistributionPanel, InsurerPanel, OwnerPanel, RmPanel, TypeModePanel } from "./claims/ClaimPeople";
import { ClientServicePanel, HighValuePanel, NoActionPanel, QualityPanel, StalePanel } from "./claims/ClaimWatch";
import { ClaimTrend } from "./claims/ClaimTrend";
import { DailyFlowPanel, FyPanel, ReviewPanel } from "./claims/ClaimReview";
import { ClaimQuickActions } from "./claims/ClaimTop";
import { FilterDisclosure } from "./FilterDisclosure";
import type { Names } from "./claims/parts";

/* ───────────────────────────── layout cells ───────────────────────────── */

/** The brief's MOBILE priority; from `lg` up every cell is `order-none` (the desktop rows). */
const ORDER = {
  sla: "order-1", attention: "order-2", worklist: "order-3", docs: "order-4", queries: "order-5", hv: "order-6",
  settlement: "order-7", ageing: "order-8", open: "order-9", today: "order-10", rest: "order-11",
} as const;
type OrderKey = keyof typeof ORDER;

function Cell({ order, wide = true, id, children }: { order: OrderKey; wide?: boolean; id?: string; children: ReactNode }) {
  return <div id={id} className={cn(ORDER[order], "min-w-0 scroll-mt-40 lg:order-none", wide && "2xl:col-span-2")}>{children}</div>;
}

type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export async function ClaimsControlCentre({ session, sp, basePath }: {
  session: SessionUser;
  sp: Record<string, string | string[] | undefined>;
  /** Where this dashboard lives (/dashboard/<id>) — every link it builds back to itself starts here. */
  basePath: string;
}) {
  const now = new Date();
  const access = claimsAccess(session);
  const filter = parseClaimFilter(sp);
  const p = parseInsPeriod(sp, now);
  const today = istToday(now);

  const limit = runLimit(4);
  const run: Run = (fn) =>
    limit(() => withTenant(session.tenantId, fn, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles }));

  const [t, meta] = await run(async (tx) => [await loadDashboardThresholds(tx), await loadClaimNames(tx, session.tenantId)] as const);
  const view = parseClaimView(sp, t);
  const w: ClaimWindow = {
    tenantId: session.tenantId, userId: session.userId, scope: access.scope, filter,
    from: p.from, to: p.to, periodLabel: p.label, prevFrom: p.prevFrom, prevTo: p.prevTo, prevLabel: p.prevLabel,
    fyStart: fyStartOf(today), today, t,
    highValue: view.highValue, noUpdateDays: view.noUpdateDays, clientUpdateDays: view.clientUpdateDays,
  };
  // The earliest day any section looks back to: the period, its comparison, the FY, last month, last week.
  const lo = [p.from, p.prevFrom, fyStartOf(p.to), fyStartOf(today), monthStart(monthBefore(today)), addDays(today, -14)].sort()[0];
  const setP = run((tx) => loadClaimSet(tx, w, lo));
  setP.catch(() => {});

  /* ── URL state ── */
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v !== "") base.set(k, v);
  base.delete("scope"); // left over from a /dashboard?scope=claims link; means nothing here
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
  const focusHref = (k: WorklistFocus) => hrefWith({ wf: k }, "#worklist");
  const resetHref = (() => {
    const q = new URLSearchParams(base);
    for (const k of [...CLAIM_FILTER_KEYS, "wf"]) q.delete(k);
    return at(q);
  })();

  /* ── header ── */
  const userName = (id?: string) => (id === "none" ? "Owner missing" : id ? meta.userName.get(id) ?? "Former user" : "");
  const chips: AppliedFilter[] = [];
  if (filter.line) chips.push({ params: ["line"], label: "Business type", value: filter.line === "personal" ? "Personal Lines" : "Commercial Lines" });
  if (filter.groups?.length) chips.push({ params: ["grp"], label: "Product", value: filter.groups.map((g) => GROUP_LABEL[g] ?? g).join(", ") });
  if (filter.claimType) chips.push({ params: ["ctyp"], label: "Claim type", value: claimTypeLabel(filter.claimType) });
  if (filter.statuses?.length) chips.push({ params: ["cst"], label: "Status", value: filter.statuses.length > 3 ? `${filter.statuses.length} statuses` : filter.statuses.map((x) => CLAIM_STATUS_LABEL[x] ?? x).join(", ") });
  if (filter.mode) chips.push({ params: ["mode"], label: "Claim mode", value: filter.mode === "none" ? "Not recorded" : claimModeLabel(filter.mode) });
  if (filter.branchId) chips.push({ params: ["branch"], label: "Branch", value: meta.branchName.get(filter.branchId) ?? "Branch" });
  if (filter.rmId) chips.push({ params: ["rm"], label: "Client RM", value: userName(filter.rmId) });
  if (filter.ownerId) chips.push({ params: ["own"], label: "Claim owner", value: userName(filter.ownerId) });
  if (filter.insurer) chips.push({ params: ["insurer"], label: "Insurer", value: meta.insurers.find((i) => i.value === filter.insurer!.toLowerCase())?.label ?? filter.insurer });
  if (filter.band) chips.push({ params: ["val"], label: "Claim value", value: CLAIM_VALUE_BANDS.find((b) => b.key === filter.band)?.label ?? filter.band });
  if (filter.pendingWith) chips.push({ params: ["pw"], label: "Pending with", value: PENDING_WITH.find((x) => x.key === filter.pendingWith)?.label ?? filter.pendingWith });
  if (filter.docs) chips.push({ params: ["doc"], label: "Documents", value: filter.docs === "complete" ? "Checklist complete" : filter.docs === "partial" ? "Checklist incomplete" : "None on file" });
  if (filter.sla) chips.push({ params: ["sla"], label: "SLA", value: filter.sla === "within" ? "Within" : filter.sla === "approaching" ? "Approaching" : "Breached" });
  if (filter.age) chips.push({ params: ["age"], label: "Ageing", value: CLAIM_AGE_BUCKETS.find((b) => b.key === filter.age)?.label ?? filter.age });
  if (filter.outcome) chips.push({ params: ["out"], label: "Outcome", value: CLAIM_STATUS_LABEL[filter.outcome] ?? filter.outcome });
  if (filter.actionWith) chips.push({ params: ["act"], label: "Next action with", value: filter.actionWith === "none" ? "No next action" : userName(filter.actionWith) });

  const names: Names = { user: Object.fromEntries(meta.userName), branch: Object.fromEntries(meta.branchName) };
  const canTask = can(session.roles, "task.edit.all", session.permissions) || can(session.roles, "task.edit.assigned", session.permissions);
  const canTaskAll = can(session.roles, "task.edit.all", session.permissions);

  return (
    <div className="max-w-screen-2xl space-y-6">
      {/* One row: register · search · More · period · Filters — pinned under
          the top bar on desktop. The filters fold behind "Filters"; what is
          applied still shows as chips below. */}
      <div className="space-y-2.5 border-b border-border bg-background pb-3 lg:sticky lg:top-16 lg:z-30 lg:pt-3">
        <FilterDisclosure
          keys={CLAIM_FILTER_KEYS}
          start={
            <ClaimQuickActions can={{ write: access.canWrite }}
              hrefs={{ focusFnr: focusHref("fnr"), focusSla: focusHref("sla"), focusHv: focusHref("hv") }} />
          }
          leading={<DashboardHeaderBar period={p.period} currentLabel={p.label} variant="light" />}
        >
        <ClaimFilters
          branches={access.scope.kind === "firm" ? meta.branches : null}
          staff={meta.staff}
          groups={PRODUCT_GROUPS.map((g) => ({ value: g.key, label: `${g.label} (${g.line === "personal" ? "Personal" : "Commercial"})` }))}
          insurers={meta.insurers}
          statuses={[{ value: "open", label: "Any open status" }, { value: "closed", label: "Any closed status" },
            ...Object.entries(CLAIM_STATUS_LABEL).map(([value, label]) => ({ value, label }))]}
          types={Object.entries(CLAIM_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          modes={[...Object.entries(CLAIM_MODE_LABEL).map(([value, label]) => ({ value, label })), { value: "none", label: "Mode not recorded" }]}
          bands={CLAIM_VALUE_BANDS.map((b) => ({ value: b.key, label: b.label }))}
          pendingWith={PENDING_WITH.map((x) => ({ value: x.key, label: x.label }))}
          ages={CLAIM_AGE_BUCKETS.map((b) => ({ value: b.key, label: b.label }))}
          resetHref={resetHref}
          active={hasFilter(w)}
        />
        </FilterDisclosure>
        <AppliedFilterChips periodLabel={`Open claims today · flows ${p.label}`} filters={chips} resetHref={resetHref} showReset={hasFilter(w)} />
      </div>

      <Suspense fallback={<div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">{[0, 1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>}>
        <Body setP={setP} w={w} view={view} names={names} hrefWith={hrefWith} focusHref={focusHref}
          can={{ write: access.canWrite, task: canTask }} />
      </Suspense>

      <ClaimDrawer can={{ write: access.canWrite, task: canTask, taskAll: canTaskAll, client360: access.canClient360 }}
        staff={meta.staff} me={session.userId} highValue={w.highValue} />
    </div>
  );
}

/* ───────────────────────────── the sections ───────────────────────────── */

async function Body({ setP, w, view, names, hrefWith, focusHref, can }: {
  setP: Promise<ClaimRec[]>;
  w: ClaimWindow;
  view: ReturnType<typeof parseClaimView>;
  names: Names;
  hrefWith: (o: Record<string, string | null>, h?: string) => string;
  focusHref: (k: WorklistFocus) => string;
  can: { write: boolean; task: boolean };
}) {
  const set = applyDerived(await setP, w);
  const open = set.filter((c) => c.isOpen);
  const P = w.periodLabel;
  const fyLabel = fyLabelOf(w.today);
  const lockedLine = w.filter.line ?? null;

  const k = kpiStrip(set, w);
  const wl = worklist(set, w, view.focus);
  const docs = documents(set, w);
  const q = queries(set, w);
  const settle = settlement(set, w);
  const hv = open.filter((c) => c.highValue).sort((a, b) => b.claimed - a.claimed);
  const stale = open.filter((c) => c.noUpdate);
  const due = open.filter((c) => c.clientUpdateDue).sort((a, b) => (b.daysSinceContact ?? 9999) - (a.daysSinceContact ?? 9999));
  const owners = groupBy(set, w, (c) => c.ownerId);
  const ageSorted = [...open].sort((a, b) =>
    view.ageSort === "amount" ? b.claimed - a.claimed
    : view.ageSort === "insurer" ? (a.insurer ?? "~").localeCompare(b.insurer ?? "~") || (b.ageDays ?? 0) - (a.ageDays ?? 0)
    : view.ageSort === "type" ? claimTypeLabel(a.type).localeCompare(claimTypeLabel(b.type)) || (b.ageDays ?? 0) - (a.ageDays ?? 0)
    : (b.ageDays ?? 0) - (a.ageDays ?? 0));
  const userLabel = (id: string | null) => (id ? names.user[id] ?? "Former user" : "Owner missing");
  const hrefs = {
    logged: hrefWith({}, "#lifecycle"), open: hrefWith({ wf: null }, "#worklist"), settled: hrefWith({}, "#settlement"),
    pending: hrefWith({}, "#status"), fnr: focusHref("fnr"), rejected: hrefWith({}, "#rejected"), settlement: hrefWith({}, "#settlement"),
    sla: focusHref("sla"), focusFnr: focusHref("fnr"), focusSla: focusHref("sla"), focusHv: focusHref("hv"),
  };
  const toggle = (param: string, current: number, presets: readonly number[], label: (n: number) => string, firm: number, hash: string) => ({
    current: String(current),
    options: [...new Set([firm, ...presets])].sort((a, b) => a - b).map((n) => ({
      key: String(n), label: `${label(n)}${n === firm ? " · firm" : ""}`, href: hrefWith({ [param]: n === firm ? null : String(n) }, hash),
    })),
  });
  const types = [...new Set(open.map((c) => c.type ?? "none"))].map((ty) => {
    const xs = open.filter((c) => (c.type ?? "none") === ty);
    return { label: ty === "none" ? "Type not recorded" : claimTypeLabel(ty), n: xs.length, amount: xs.reduce((a, c) => a + c.claimed, 0) };
  }).sort((a, b) => b.n - a.n);
  const lines = (["personal", "commercial", "unlinked", "unclassified"] as const).map((l) => {
    const xs = open.filter((c) => c.line === l);
    return { label: l === "personal" ? "Personal Lines" : l === "commercial" ? "Commercial Lines" : l === "unlinked" ? "No policy linked" : "Type not recognised", n: xs.length, amount: xs.reduce((a, c) => a + c.claimed, 0) };
  }).filter((x) => x.n > 0);

  return (
    <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2">
      {/* The headline · §1–2 */}
      <Cell order="open" id="kpis"><KpiStrip k={k} periodLabel={P} hrefs={hrefs} /></Cell>
      <Cell order="rest"><ValueSummary v={valueSummary(set, w)} periodLabel={P} /></Cell>
      {/* Today · §3 + §39 attention */}
      <Cell order="attention" id="attention">
        <AttentionPanel cards={attention(set, w)} names={names} focusHref={focusHref} lv={levels(set)}
          t={{ sla: w.t.claimSlaDays, warn: w.t.claimSlaWarnDays, escalate: w.t.claimEscalateDays }} />
      </Cell>
      {/* Today · §40 escalation centre */}
      <Cell order="rest" id="escalations"><EscalationCentre cards={escalationCentre(set, w)} names={names} focusHref={focusHref} /></Cell>
      {/* Today · §4 worklist */}
      <Cell order="worklist" id="worklist">
        <WorklistPanel rows={wl} names={names} focusLabel={view.focus ? FOCUS_LABEL[view.focus] : null} clearHref={hrefWith({ wf: null }, "#worklist")}
          can={can} total={open.length} />
      </Cell>
      {/* Today · §31–33 high value, stale, no next action */}
      <Cell order="hv" wide={false} id="high-value">
        <HighValuePanel rows={hv} names={names} threshold={w.highValue}
          toggle={toggle("hv", w.highValue, HIGH_VALUE_PRESETS, (n) => formatMoney(n), w.t.insHighClaim, "#high-value")} />
      </Cell>
      <Cell order="rest" wide={false} id="stale">
        <StalePanel rows={stale} names={names} days={w.noUpdateDays}
          toggle={toggle("nu", w.noUpdateDays, NO_UPDATE_PRESETS, (n) => `${n} day${n === 1 ? "" : "s"}`, w.t.claimNoUpdateDays, "#stale")} />
      </Cell>
      <Cell order="rest"><NoActionPanel n={withoutNextAction(set)} focusHref={focusHref} /></Cell>
      {/* Today · §12, §14, §41–42 documents, pending with, client updates */}
      <Cell order="docs" id="documents"><DocumentsPanel d={docs} names={names} periodLabel={P} docsDays={w.t.claimDocsDays} focusHref={focusHref} /></Cell>
      <Cell order="rest" id="pending-with"><PendingWithPanel rows={pendingWith(set)} focusHref={(pw) => hrefWith({ pw, wf: null }, "#worklist")} /></Cell>
      <Cell order="rest" id="client-service">
        <ClientServicePanel open={open.length} due={due} names={names} days={w.clientUpdateDays}
          clientsDue={new Set(due.map((c) => c.investorId ?? c.id)).size}
          actionToday={open.filter((c) => c.actionState === "today").length} actionOverdue={open.filter((c) => c.actionState === "overdue").length}
          noContact={open.filter((c) => c.daysSinceContact == null).length}
          toggle={toggle("cu", w.clientUpdateDays, CLIENT_UPDATE_PRESETS, (n) => `${n} days`, w.t.claimClientUpdateDays, "#client-service")}
          focusHref={focusHref} />
      </Cell>
      {/* Today · §15 queries */}
      <Cell order="queries" id="queries"><QueriesPanel q={q} names={names} periodLabel={P} queryDays={w.t.claimQueryDays} focusHref={focusHref} /></Cell>
      {/* The team · §28–29 owners */}
      <Cell order="rest" id="owners">
        <OwnerPanel rows={owners} periodLabel={P}
          labelOf={(k) => (k ? names.user[k] ?? "Former user" : <span className="text-warning-foreground">Owner missing</span>)}
          hrefOf={(k) => hrefWith({ own: k })} />
      </Cell>
      <Cell order="rest"><DistributionPanel owners={owners} types={types} lines={lines} labelOf={userLabel} /></Cell>
      {/* The team · §26–27 branches and RMs */}
      <Cell order="rest" wide={false} id="branches">
        <BranchPanel rows={groupBy(set, w, (c) => c.branchId)} periodLabel={P}
          labelOf={(k) => (k ? names.branch[k] ?? "Branch" : <span className="text-muted-foreground">No branch recorded</span>)}
          hrefOf={(k) => hrefWith({ branch: k })} />
      </Cell>
      <Cell order="rest" wide={false} id="rms">
        <RmPanel rows={groupBy(set, w, (c) => c.clientRmId)} periodLabel={P}
          labelOf={(k) => (k ? names.user[k] ?? "Former user" : <span className="text-muted-foreground">No RM / no client</span>)}
          hrefOf={(k) => hrefWith({ rm: k })} />
      </Cell>
      {/* Analysis · §5–6 lifecycle */}
      <Cell order="rest" wide={false} id="lifecycle">
        <FunnelPanel periodLabel={P} lockedLine={lockedLine}
          funnels={{ all: funnel(set, w, "all"), personal: funnel(set, w, "personal"), commercial: funnel(set, w, "commercial") }} />
      </Cell>
      <Cell order="rest" wide={false} id="status"><StatusPanel rows={statusDistribution(set, w)} periodLabel={P} /></Cell>
      {/* Analysis · §7–11 ageing, SLA, TAT */}
      <Cell order="ageing" id="ageing">
        <AgeingPanel buckets={ageing(set)} rows={ageSorted} names={names} sort={view.ageSort}
          sortOptions={[["oldest", "Oldest"], ["amount", "Highest amount"], ["insurer", "Insurer"], ["type", "Claim type"]].map(([key, label]) => ({
            key, label, href: hrefWith({ as: key === "oldest" ? null : key }, "#ageing-detail"),
          }))} />
      </Cell>
      <Cell order="sla" id="sla"><SlaPanel s={slaTat(set, w)} periodLabel={P} slaDays={w.t.claimSlaDays} warnDays={w.t.claimSlaWarnDays} focusHref={focusHref} /></Cell>
      <Cell order="rest" wide={false}>
        <TatTable title="TAT by claim type" subtitle={`Logged and settled in ${P}; open today.`} keyLabel="Claim type" icon={<FileText className="size-4" />}
          rows={tatBy(set, w, (c) => c.type ?? "none", (key) => (key === "none" ? "Type not recorded" : claimTypeLabel(key)))}
          note="The CRM's own claim types. TAT is intimation to settlement or rejection, for claims closed in the period; grievance cases are left out."
          hrefFor={(key) => hrefWith({ ctyp: key === "none" ? null : key })} />
      </Cell>
      <Cell order="rest" wide={false}>
        <TatTable title="TAT by insurer / TPA" subtitle={`Logged and settled in ${P}; open today.`} keyLabel="Insurer" icon={<Landmark className="size-4" />}
          rows={tatBy(set, w, (c) => c.insurerKey, insurerName)}
          note="Descriptive operational data — no insurer is rated. The CRM records the insurer only; a TPA is not a field."
          hrefFor={(key) => hrefWith({ insurer: key || null })} />
      </Cell>
      {/* Analysis · §16–18 cashless and reimbursement */}
      <Cell order="rest" wide={false}><ModePanel mode="cashless" m={byMode(set, w, "cashless")} names={names} periodLabel={P} /></Cell>
      <Cell order="rest" wide={false}><ModePanel mode="reimbursement" m={byMode(set, w, "reimbursement")} names={names} periodLabel={P} /></Cell>
      <Cell order="rest"><ClaimedVsSettledPanel rows={settledRows(set, w)} names={names} periodLabel={P} /></Cell>
      {/* Analysis · §19–20 settlement */}
      <Cell order="settlement" id="settlement"><SettlementPanel s={settle} periodLabel={P} /></Cell>
      {/* Analysis · §21–23 rejected and legal */}
      <Cell order="rest" wide={false} id="rejected"><RejectedPanel r={rejected(set, w)} names={names} periodLabel={P} focusHref={focusHref} /></Cell>
      <Cell order="rest" wide={false} id="legal"><LegalPanel l={legal(set, w)} names={names} periodLabel={P} /></Cell>
      {/* Analysis · §24–25 lines */}
      {lockedLine !== "commercial" && (
        <Cell order="rest" wide={lockedLine === "personal"}><LinePanel line="personal" s={lineSummary(set, w, "personal")} periodLabel={P} groupHref={(g) => hrefWith({ grp: g })} /></Cell>
      )}
      {lockedLine !== "personal" && (
        <Cell order="rest" wide={lockedLine === "commercial"}><LinePanel line="commercial" s={lineSummary(set, w, "commercial")} periodLabel={P} groupHref={(g) => hrefWith({ grp: g })} /></Cell>
      )}
      {/* Analysis · §30, §51–52 insurers, types, modes */}
      <Cell order="rest" id="insurers">
        <InsurerPanel rows={groupBy(set, w, (c) => c.insurerKey || null)} periodLabel={P}
          labelOf={(k) => (k ? insurerName(k, set.filter((c) => c.insurerKey === k)) : <span className="text-muted-foreground">Insurer not recorded</span>)}
          hrefOf={(k) => hrefWith({ insurer: k })} />
      </Cell>
      <Cell order="rest">
        <TypeModePanel periodLabel={P}
          types={groupBy(set, w, (c) => c.type)} modes={groupBy(set, w, (c) => c.mode)}
          labelOfType={(k) => (k ? claimTypeLabel(k) : "Type not recorded")} labelOfMode={(k) => claimModeLabel(k)}
          typeHref={(k) => hrefWith({ ctyp: k })} modeHref={(k) => hrefWith({ mode: k })} />
      </Cell>
      {/* Analysis · §34–35 data quality */}
      <Cell order="rest" id="quality"><QualityPanel q={quality(set, w)} periodLabel={P} /></Cell>
      {/* Analysis · §43–45 trend */}
      <Cell order="rest" id="trend"><ClaimTrend points={monthlyTrend(set, w)} fyLabel={fyLabel} lockedLine={lockedLine} /></Cell>
      {/* Reviews · §46–50 the day, the week or month, the FY */}
      <Cell order="today" id="today"><DailyFlowPanel d={dailyFlow(set, w)} /></Cell>
      <Cell order="rest" id="review">
        <ReviewPanel mode={view.review} r={view.review === "weekly" ? weeklyReview(set, w) : monthlyReview(set, w)}
          toggle={[{ key: "weekly", label: "Weekly", href: hrefWith({ rv: "weekly" }, "#review") }, { key: "monthly", label: "Monthly", href: hrefWith({ rv: null }, "#review") }]} />
      </Cell>
      <Cell order="rest" id="fy"><FyPanel s={fyScorecard(set, w)} fyLabel={fyLabel} /></Cell>
    </div>
  );
}
