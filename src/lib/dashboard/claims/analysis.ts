/**
 * Every section of the Claims Control Centre, computed from the claim set
 * (./set.ts). Pure functions: no database, no clock beyond the window's
 * `today`, so each figure can be read — and tested — as a definition.
 *
 * Conventions, the same everywhere:
 *  · A COUNT and an AMOUNT are always carried together and never blended.
 *  · "Claim amount" is the claimed amount; "settled amount" is what was paid.
 *    Outstanding is the claimed amount on claims still OPEN — never claimed
 *    less settled across the book, which rejected and withdrawn claims would
 *    distort.
 *  · Flows (logged, settled, rejected) belong to a period; stocks (open,
 *    pending, ageing, SLA) are today. Each section says which.
 *  · Grievance-mode claims (the CRM's only legal / consumer-court marker) are
 *    excluded from TAT figures and shown on their own.
 */

import { CLAIM_AGE_BUCKETS, CLAIM_FUNNEL, PENDING_WITH } from "@/lib/insurance/claims-book";
import { GROUP_LABEL } from "@/lib/insurance/book";
import { closedIn, loggedIn, type ClaimRec } from "./set";
import { daysBetween, istDate, monthStart, type ClaimWindow } from "./window";
import type { WorklistFocus } from "./params";

export type Tally = { n: number; amount: number };

const sum = (xs: ClaimRec[], f: (c: ClaimRec) => number) => xs.reduce((a, c) => a + f(c), 0);
export const tally = (xs: ClaimRec[], f: (c: ClaimRec) => number = (c) => c.claimed): Tally => ({ n: xs.length, amount: sum(xs, f) });
const SETTLED = ["settled_fully", "settled_partially"];
const isSettled = (c: ClaimRec) => SETTLED.includes(c.status);
const FNR = ["file_awaited", "empty"];

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Owners of a group of claims, most claims first. */
function owners(xs: ClaimRec[]): Array<string | null> {
  const m = new Map<string | null, number>();
  for (const c of xs) m.set(c.ownerId, (m.get(c.ownerId) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
const oldest = (xs: ClaimRec[]): number | null => (xs.length ? Math.max(...xs.map((c) => c.ageDays ?? 0)) : null);

/* ───────────────────────── §1–2 · the strip and the value summary ───────────────────────── */

export function kpiStrip(set: ClaimRec[], w: ClaimWindow) {
  const open = set.filter((c) => c.isOpen);
  const inPeriod = (c: ClaimRec) => closedIn(c, w.from, w.to);
  return {
    loggedToday: tally(set.filter((c) => c.openedOn === w.today)),
    loggedMtd: tally(set.filter((c) => loggedIn(c, monthStart(w.today), w.today))),
    loggedFytd: tally(set.filter((c) => loggedIn(c, w.fyStart, w.today))),
    loggedPeriod: tally(set.filter((c) => loggedIn(c, w.from, w.to))),
    open: tally(open),
    settled: tally(set.filter((c) => isSettled(c) && inPeriod(c)), (c) => c.settled),
    pending: tally(open.filter((c) => !FNR.includes(c.status))),
    fnr: tally(open.filter((c) => FNR.includes(c.status))),
    rejected: tally(set.filter((c) => c.status === "rejected" && inPeriod(c))),
    slaBreached: tally(open.filter((c) => c.sla === "breached")),
    legalOpen: open.filter((c) => c.legal).length,
  };
}

export function valueSummary(set: ClaimRec[], w: ClaimWindow) {
  const logged = set.filter((c) => loggedIn(c, w.from, w.to));
  return {
    claimed: sum(logged, (c) => c.claimed),
    claimedMissing: logged.filter((c) => c.claimedMissing).length,
    settled: sum(set.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)), (c) => c.settled),
    outstanding: sum(set.filter((c) => c.isOpen), (c) => c.claimed),
    rejected: sum(set.filter((c) => c.status === "rejected" && closedIn(c, w.from, w.to)), (c) => c.claimed),
  };
}

/* ───────────────────────── worklist focus (§3, §33, §40 → §4) ───────────────────────── */

export function focusMatch(c: ClaimRec, f: WorklistFocus, w: ClaimWindow): boolean {
  switch (f) {
    case "sla": return c.isOpen && c.sla === "breached";
    case "approaching": return c.isOpen && c.sla === "approaching";
    case "escalated": return c.isOpen && c.level === 3;
    case "hv": return c.isOpen && c.highValue;
    case "fnr": return c.isOpen && FNR.includes(c.status);
    case "docs": return c.isOpen && c.docsOverdue;
    case "query": return c.isOpen && (c.status === "query" || c.status === "add_info_awaited");
    case "repeat": return c.isOpen && c.queryCount >= 2;
    case "assess": return c.isOpen && c.assessLong;
    case "rejected": return c.status === "rejected" && closedIn(c, w.from, w.to) && !c.nextAction;
    case "rejectedReview": return c.status === "rejected" && closedIn(c, w.from, w.to) && !!c.nextAction;
    case "legal": return c.isOpen && c.legal;
    case "noowner": return c.isOpen && !c.ownerId;
    case "noremark": return c.isOpen && !c.comments;
    case "noaction": return c.isOpen && !c.nextAction;
    case "actiondue": return c.isOpen && (c.actionState === "today" || c.actionState === "overdue");
    case "stale": return c.isOpen && c.noUpdate;
    case "update": return c.isOpen && c.clientUpdateDue;
    case "age90": return c.isOpen && (c.ageDays ?? 0) > 90;
  }
}

export const FOCUS_LABEL: Record<WorklistFocus, string> = {
  sla: "SLA breached", approaching: "Approaching SLA", escalated: "Escalation level", hv: "High-value open claims",
  fnr: "File not received", docs: "Documents pending beyond SLA", query: "Insurer query pending", repeat: "Repeated insurer query",
  assess: "Under process too long", rejected: "Rejected, no review scheduled", rejectedReview: "Rejected claims under review", legal: "Grievance cases", noowner: "Claims without an owner",
  noremark: "Claims without remarks", noaction: "Claims without a next action", actiondue: "Follow-ups due", stale: "No update",
  update: "Client update due", age90: "Open 90+ days",
};

export type AttentionCard = { key: WorklistFocus; label: string; n: number; amount: number | null; oldest: number | null; owners: Array<string | null>; tone: "bad" | "warn" | "neutral"; hint?: string };

function card(set: ClaimRec[], w: ClaimWindow, key: WorklistFocus, tone: AttentionCard["tone"], opts: { amount?: boolean; hint?: string } = {}): AttentionCard {
  const xs = set.filter((c) => focusMatch(c, key, w));
  return {
    key, label: FOCUS_LABEL[key], n: xs.length, amount: opts.amount === false ? null : sum(xs, (c) => c.claimed),
    oldest: oldest(xs.filter((c) => c.isOpen)), owners: owners(xs), tone: xs.length ? tone : "neutral", hint: opts.hint,
  };
}

/** §3 — the claims that need someone today. */
export function attention(set: ClaimRec[], w: ClaimWindow): AttentionCard[] {
  return [
    card(set, w, "sla", "bad"),
    card(set, w, "hv", "warn", { hint: `At or above the high-value line` }),
    card(set, w, "fnr", "warn"),
    card(set, w, "docs", "bad", { hint: `Awaited over ${w.t.claimDocsDays} days` }),
    card(set, w, "query", "warn", { hint: "Insurer or TPA — the CRM does not tell them apart" }),
    card(set, w, "assess", "warn", { hint: `Under process over ${w.t.claimAssessDays} days` }),
    card(set, w, "rejected", "warn", { hint: `Rejected in the period with no follow-up` }),
    card(set, w, "legal", "bad", { hint: "Claim mode Grievance" }),
    card(set, w, "noowner", "warn", { amount: false }),
    card(set, w, "noremark", "neutral", { amount: false }),
    card(set, w, "noaction", "warn", { amount: false }),
  ];
}

/** §39 — the three escalation levels, with the rules spelled out. */
export function levels(set: ClaimRec[]) {
  const open = set.filter((c) => c.isOpen);
  return ([3, 2, 1] as const).map((lv) => ({ level: lv, ...tally(open.filter((c) => c.level === lv)) }));
}

/** §40 — what a manager has to step into. */
export function escalationCentre(set: ClaimRec[], w: ClaimWindow): AttentionCard[] {
  return [
    card(set, w, "age90", "bad"),
    card(set, w, "hv", "warn"),
    card(set, w, "rejectedReview", "warn", { hint: "Rejected in the period with an open follow-up" }),
    card(set, w, "legal", "bad"),
    card(set, w, "repeat", "warn", { hint: "Two or more insurer queries" }),
    card(set, w, "docs", "bad"),
    card(set, w, "escalated", "bad", { hint: `Breached by over ${w.t.claimEscalateDays} days, or high value and breached` }),
  ];
}

/* ───────────────────────── §4 · the worklist ───────────────────────── */

/** SLA breached first, then high value (the CRM has no priority field), then oldest, then largest. */
export function worklist(set: ClaimRec[], w: ClaimWindow, focus: WorklistFocus | null): ClaimRec[] {
  const xs = focus ? set.filter((c) => focusMatch(c, focus, w)) : set.filter((c) => c.isOpen);
  return [...xs].sort((a, b) =>
    Number(b.sla === "breached") - Number(a.sla === "breached")
    || Number(b.highValue) - Number(a.highValue)
    || (b.ageDays ?? -1) - (a.ageDays ?? -1)
    || b.claimed - a.claimed);
}

/* ───────────────────────── §5–6 · lifecycle and status ───────────────────────── */

export type FunnelStage = { key: string; label: string; hint: string; n: number; amount: number; avgDays: number | null };
export type Funnel = { stages: FunnelStage[]; rejected: Tally; withdrawn: Tally; open: Tally };

const firstAt = (c: ClaimRec, statuses: readonly string[]): string | null => {
  const ts = statuses.map((s) => c.hist[s]?.f).filter(Boolean) as string[];
  return ts.length ? ts.sort()[0] : null;
};

/** §5 — claims intimated in the period, and how far each got. Average days are from intimation to first reaching the stage. */
export function funnel(set: ClaimRec[], w: ClaimWindow, line: "all" | "personal" | "commercial"): Funnel {
  const cohort = set.filter((c) => loggedIn(c, w.from, w.to) && (line === "all" || c.line === line));
  const days = (c: ClaimRec, when: string | null) => (when ? Math.max(0, daysBetween(c.openedOn, istDate(when) ?? c.openedOn)) : null);
  const stage = (key: string, pick: (c: ClaimRec) => boolean, at: (c: ClaimRec) => string | null): FunnelStage => {
    const xs = cohort.filter(pick);
    const def = CLAIM_FUNNEL.find((s) => s.key === key)!;
    const ds = xs.map((c) => days(c, at(c))).filter((d): d is number => d != null);
    return { key, label: def.label, hint: def.hint, n: xs.length, amount: sum(xs, (c) => c.claimed), avgDays: key === "logged" ? 0 : mean(ds) };
  };
  return {
    stages: [
      stage("logged", () => true, (c) => c.openedOn),
      stage("docs", (c) => c.reached.docs, (c) => firstAt(c, ["file_received", "add_info_awaited", "query", "query_replied", "under_process", "settled_fully", "settled_partially"])),
      stage("submitted", (c) => c.reached.submitted, (c) => c.submissionDate ? `${c.submissionDate}T00:00:00+05:30` : firstAt(c, ["add_info_awaited", "query", "query_replied", "under_process"])),
      stage("assessment", (c) => c.reached.assessment, (c) => firstAt(c, ["add_info_awaited", "query", "query_replied", "under_process"])),
      stage("settled", (c) => c.reached.settled, (c) => c.settlementDate ? `${c.settlementDate}T00:00:00+05:30` : firstAt(c, SETTLED)),
    ],
    rejected: tally(cohort.filter((c) => c.status === "rejected")),
    withdrawn: tally(cohort.filter((c) => c.status === "withdrawn")),
    open: tally(cohort.filter((c) => c.isOpen)),
  };
}

/** §6 — open claims by their status now; closed claims by the outcome reached in the period. */
export function statusDistribution(set: ClaimRec[], w: ClaimWindow) {
  const order = ["claim_intimated", "file_awaited", "file_received", "add_info_awaited", "query", "query_replied", "under_process",
    "settled_fully", "settled_partially", "rejected", "withdrawn", "empty"];
  return order.map((s) => {
    const open = !["settled_fully", "settled_partially", "rejected", "withdrawn"].includes(s);
    const xs = set.filter((c) => c.status === s && (open ? c.isOpen : closedIn(c, w.from, w.to)));
    return { status: s, open, ...tally(xs, open || s === "rejected" || s === "withdrawn" ? (c) => c.claimed : (c) => c.settled) };
  });
}

/* ───────────────────────── §7–11 · ageing, SLA, TAT ───────────────────────── */

export function ageing(set: ClaimRec[]) {
  const open = set.filter((c) => c.isOpen);
  return CLAIM_AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, ...tally(open.filter((c) => c.bucket === b.key)) }));
}

/** TAT population: claims settled or rejected in the window, grievance cases excluded. */
const tatSet = (set: ClaimRec[], from: string, to: string) =>
  set.filter((c) => (isSettled(c) || c.status === "rejected") && closedIn(c, from, to) && !c.legal && c.tatDays != null);

export function slaTat(set: ClaimRec[], w: ClaimWindow) {
  const open = set.filter((c) => c.isOpen);
  const tats = tatSet(set, w.from, w.to).map((c) => c.tatDays!);
  const oldestOpen = [...open].sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))[0] ?? null;
  return {
    within: tally(open.filter((c) => c.sla === "within")),
    approaching: tally(open.filter((c) => c.sla === "approaching")),
    breached: tally(open.filter((c) => c.sla === "breached")),
    avgTat: mean(tats),
    medianTat: median(tats),
    closedN: tats.length,
    oldest: oldestOpen ? { id: oldestOpen.id, client: oldestOpen.client, days: oldestOpen.ageDays ?? 0 } : null,
  };
}

export type TatRow = { key: string; label: string; logged: number; open: number; settled: number; avgTat: number | null; medianTat: number | null; breachPct: number | null };

export function tatBy(set: ClaimRec[], w: ClaimWindow, keyOf: (c: ClaimRec) => string, labelOf: (k: string, xs: ClaimRec[]) => string): TatRow[] {
  const keys = new Map<string, ClaimRec[]>();
  for (const c of set) {
    if (!(c.isOpen || loggedIn(c, w.from, w.to) || closedIn(c, w.from, w.to))) continue;
    const k = keyOf(c);
    keys.set(k, [...(keys.get(k) ?? []), c]);
  }
  return [...keys.entries()].map(([k, xs]) => {
    const open = xs.filter((c) => c.isOpen);
    const tats = tatSet(xs, w.from, w.to).map((c) => c.tatDays!);
    return {
      key: k, label: labelOf(k, xs), logged: xs.filter((c) => loggedIn(c, w.from, w.to)).length, open: open.length,
      settled: xs.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)).length,
      avgTat: mean(tats), medianTat: median(tats),
      breachPct: open.length ? open.filter((c) => c.sla === "breached").length / open.length : null,
    };
  }).sort((a, b) => b.open - a.open || b.logged - a.logged);
}

/** The commonest spelling of an insurer across its claims. */
export const insurerName = (key: string, xs: ClaimRec[]): string => {
  if (!key) return "Insurer not recorded";
  const m = new Map<string, number>();
  for (const c of xs) if (c.insurer) m.set(c.insurer, (m.get(c.insurer) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
};

/* ───────────────────────── §12, §14–15 · documents, pending with, queries ───────────────────────── */

const enteredIn = (c: ClaimRec, statuses: readonly string[], from: string, to: string) =>
  statuses.some((s) => {
    const h = c.hist[s];
    if (!h) return false;
    const f = istDate(h.f);
    const l = istDate(h.l);
    return (!!f && f >= from && f <= to) || (!!l && l >= from && l <= to);
  });

export function documents(set: ClaimRec[], w: ClaimWindow) {
  const open = set.filter((c) => c.isOpen);
  const waiting = open.filter((c) => c.status === "file_awaited" || c.status === "add_info_awaited");
  return {
    requested: set.filter((c) => enteredIn(c, ["file_awaited", "add_info_awaited"], w.from, w.to)).length,
    received: set.filter((c) => enteredIn(c, ["file_received", "query_replied"], w.from, w.to)).length,
    pending: tally(open.filter((c) => c.status === "file_awaited")),
    incomplete: tally(open.filter((c) => c.docState === "partial")),
    none: tally(open.filter((c) => c.docState === "none")),
    overdue: tally(open.filter((c) => c.docsOverdue)),
    rows: [...waiting].sort((a, b) => b.daysInStatus - a.daysInStatus),
  };
}

export function pendingWith(set: ClaimRec[]) {
  const open = set.filter((c) => c.isOpen);
  return PENDING_WITH.map((p) => {
    const xs = open.filter((c) => c.pendingWith === p.key);
    return { key: p.key, label: p.label, hint: p.hint, ...tally(xs), avgAge: mean(xs.map((c) => c.ageDays ?? 0)) };
  });
}

export function queries(set: ClaimRec[], w: ClaimWindow) {
  const open = set.filter((c) => c.isOpen && (c.status === "query" || c.status === "add_info_awaited"));
  return {
    raised: set.filter((c) => enteredIn(c, ["query", "add_info_awaited"], w.from, w.to)).length,
    answered: set.filter((c) => enteredIn(c, ["query_replied"], w.from, w.to)).length,
    pending: tally(open),
    overdue: tally(open.filter((c) => c.queryOverdue)),
    repeated: set.filter((c) => c.isOpen && c.queryCount >= 2).length,
    rows: [...open].sort((a, b) => b.daysInStatus - a.daysInStatus),
  };
}

/* ───────────────────────── §16–20 · cashless, reimbursement, settlement ───────────────────────── */

export function byMode(set: ClaimRec[], w: ClaimWindow, mode: "cashless" | "reimbursement") {
  const xs = set.filter((c) => c.mode === mode);
  const open = xs.filter((c) => c.isOpen);
  return {
    logged: tally(xs.filter((c) => loggedIn(c, w.from, w.to))),
    open: tally(open),
    preAuth: tally(open.filter((c) => c.type === "pre_authorization")),
    docsPending: tally(open.filter((c) => c.status === "file_awaited")),
    submitted: tally(open.filter((c) => c.reached.submitted)),
    query: tally(open.filter((c) => c.status === "query" || c.status === "add_info_awaited")),
    settled: tally(xs.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)), (c) => c.settled),
    rejected: tally(xs.filter((c) => c.status === "rejected" && closedIn(c, w.from, w.to))),
    rows: [...open, ...xs.filter((c) => !c.isOpen && closedIn(c, w.from, w.to))]
      .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || (b.ageDays ?? 0) - (a.ageDays ?? 0)),
  };
}

export function settledRows(set: ClaimRec[], w: ClaimWindow): ClaimRec[] {
  return set.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)).sort((a, b) => (b.claimed - b.settled) - (a.claimed - a.settled));
}

export function settlement(set: ClaimRec[], w: ClaimWindow) {
  const settledOn = (from: string, to: string) => set.filter((c) => isSettled(c) && closedIn(c, from, to));
  const fy = settledOn(w.fyStart, w.today);
  const decided = set.filter((c) => (isSettled(c) || c.status === "rejected") && closedIn(c, w.from, w.to));
  const settledP = decided.filter(isSettled);
  const claimedOnSettled = sum(settledP, (c) => c.claimed);
  return {
    today: tally(settledOn(w.today, w.today), (c) => c.settled),
    mtd: tally(settledOn(monthStart(w.today), w.today), (c) => c.settled),
    fytd: tally(fy, (c) => c.settled),
    period: tally(settledP, (c) => c.settled),
    avgDays: mean(fy.filter((c) => !c.legal && c.tatDays != null).map((c) => c.tatDays!)),
    ageing: CLAIM_AGE_BUCKETS.map((b) => {
      const xs = fy.filter((c) => c.tatDays != null && c.tatDays >= b.lo && (b.hi == null || c.tatDays <= b.hi));
      return { key: b.key, label: b.label, ...tally(xs, (c) => c.settled) };
    }),
    /** Settled ÷ decided (settled + rejected) in the period. Withdrawn claims are the client's choice and are left out. */
    countPct: decided.length ? settledP.length / decided.length : null,
    decidedN: decided.length,
    settledN: settledP.length,
    /** Settled amount ÷ claimed amount, on the claims that settled in the period. */
    amountPct: claimedOnSettled > 0 ? sum(settledP, (c) => c.settled) / claimedOnSettled : null,
    claimedOnSettled,
  };
}

/* ───────────────────────── §21–23 · rejected and grievance ───────────────────────── */

export function rejected(set: ClaimRec[], w: ClaimWindow) {
  const xs = set.filter((c) => c.status === "rejected" && closedIn(c, w.from, w.to));
  return {
    all: tally(xs),
    reviewOpen: tally(xs.filter((c) => !!c.nextAction)),
    noReview: tally(xs.filter((c) => !c.nextAction)),
    escalated: tally(xs.filter((c) => c.legal)),
    rows: [...xs].sort((a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? "")),
  };
}

export function legal(set: ClaimRec[], w: ClaimWindow) {
  const xs = set.filter((c) => c.legal && (c.isOpen || closedIn(c, w.from, w.to)));
  const open = xs.filter((c) => c.isOpen);
  return { open: tally(open), closed: tally(xs.filter((c) => !c.isOpen)), rows: [...xs].sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || (b.ageDays ?? 0) - (a.ageDays ?? 0)) };
}

/* ───────────────────────── §24–25 · the two lines ───────────────────────── */

export function lineSummary(set: ClaimRec[], w: ClaimWindow, line: "personal" | "commercial") {
  const xs = set.filter((c) => c.line === line);
  const open = xs.filter((c) => c.isOpen);
  const logged = xs.filter((c) => loggedIn(c, w.from, w.to));
  const settledX = xs.filter((c) => isSettled(c) && closedIn(c, w.from, w.to));
  const groups = [...new Set(xs.map((c) => c.group))];
  return {
    logged: tally(logged),
    settled: tally(settledX, (c) => c.settled),
    pending: tally(open.filter((c) => !FNR.includes(c.status))),
    fnr: tally(open.filter((c) => FNR.includes(c.status))),
    rejected: tally(xs.filter((c) => c.status === "rejected" && closedIn(c, w.from, w.to))),
    open: tally(open),
    byGroup: groups.map((g) => {
      const gx = xs.filter((c) => c.group === g);
      return {
        key: g, label: GROUP_LABEL[g] ?? g,
        logged: gx.filter((c) => loggedIn(c, w.from, w.to)).length,
        open: gx.filter((c) => c.isOpen).length,
        settled: gx.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)).length,
        loggedAmount: sum(gx.filter((c) => loggedIn(c, w.from, w.to)), (c) => c.claimed),
        openAmount: sum(gx.filter((c) => c.isOpen), (c) => c.claimed),
        settledAmount: sum(gx.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)), (c) => c.settled),
      };
    }).filter((g) => g.logged || g.open || g.settled).sort((a, b) => b.open - a.open || b.logged - a.logged),
  };
}

/* ───────────────────────── §26–30 · branch, RM, owner, insurer ───────────────────────── */

export type GroupRow = {
  key: string | null; logged: number; open: number; settled: number; rejected: number; claimed: number; settledAmount: number;
  breached: number; docsPending: number; queryPending: number; highValue: number; newToday: number; avgAge: number | null;
  followUpPending: number; avgTat: number | null; openAmount: number;
};

export function groupBy(set: ClaimRec[], w: ClaimWindow, keyOf: (c: ClaimRec) => string | null): GroupRow[] {
  const m = new Map<string | null, ClaimRec[]>();
  for (const c of set) {
    if (!(c.isOpen || loggedIn(c, w.from, w.to) || closedIn(c, w.from, w.to))) continue;
    const k = keyOf(c);
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  return [...m.entries()].map(([key, xs]) => {
    const open = xs.filter((c) => c.isOpen);
    const logged = xs.filter((c) => loggedIn(c, w.from, w.to));
    const tats = tatSet(xs, w.from, w.to).map((c) => c.tatDays!);
    return {
      key,
      logged: logged.length,
      open: open.length,
      settled: xs.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)).length,
      rejected: xs.filter((c) => c.status === "rejected" && closedIn(c, w.from, w.to)).length,
      claimed: sum(logged, (c) => c.claimed),
      settledAmount: sum(xs.filter((c) => isSettled(c) && closedIn(c, w.from, w.to)), (c) => c.settled),
      breached: open.filter((c) => c.sla === "breached").length,
      docsPending: open.filter((c) => FNR.includes(c.status)).length,
      queryPending: open.filter((c) => c.status === "query" || c.status === "add_info_awaited").length,
      highValue: open.filter((c) => c.highValue).length,
      newToday: xs.filter((c) => c.openedOn === w.today).length,
      avgAge: mean(open.map((c) => c.ageDays ?? 0)),
      followUpPending: open.filter((c) => c.actionState === "none" || c.actionState === "overdue").length,
      avgTat: mean(tats),
      openAmount: sum(open, (c) => c.claimed),
    };
  }).sort((a, b) => b.open - a.open || b.logged - a.logged);
}

/* ───────────────────────── §33–35 · missing next action, data quality, linkage ───────────────────────── */

export function withoutNextAction(set: ClaimRec[]) {
  const open = set.filter((c) => c.isOpen);
  return {
    noAction: open.filter((c) => !c.nextAction).length,
    noOwner: open.filter((c) => !c.ownerId).length,
    noRemarks: open.filter((c) => !c.comments).length,
    noDocuments: open.filter((c) => c.docState === "none").length,
    noStatus: open.filter((c) => c.status === "empty").length,
    open: open.length,
  };
}

export const QUALITY = [
  { key: "policyNumber", label: "Policy number missing", test: (c: ClaimRec) => !c.policyNumber },
  { key: "type", label: "Claim type missing", test: (c: ClaimRec) => !c.type },
  { key: "date", label: "Intimation date missing", test: (c: ClaimRec) => !c.intimationDate },
  { key: "amount", label: "Claim amount missing", test: (c: ClaimRec) => c.claimedMissing },
  { key: "insurer", label: "Insurer missing", test: (c: ClaimRec) => !c.insurer },
  { key: "rm", label: "Client RM missing", test: (c: ClaimRec) => !!c.investorId && !c.clientRmId },
  { key: "branch", label: "Branch missing", test: (c: ClaimRec) => !c.branchId },
  { key: "owner", label: "Owner missing", test: (c: ClaimRec) => !c.ownerId },
  { key: "status", label: "Status not set", test: (c: ClaimRec) => c.status === "empty" },
  { key: "settledAmount", label: "Settled amount missing", test: (c: ClaimRec) => SETTLED.includes(c.status) && c.settled <= 0 },
  { key: "settledDate", label: "Settlement date missing", test: (c: ClaimRec) => SETTLED.includes(c.status) && !c.settlementDate },
  { key: "remarks", label: "Remarks missing (open claims)", test: (c: ClaimRec) => c.isOpen && !c.comments },
] as const;

export function quality(set: ClaimRec[], w: ClaimWindow) {
  const xs = set.filter((c) => c.isOpen || loggedIn(c, w.from, w.to) || closedIn(c, w.from, w.to));
  const counts = Object.fromEntries(QUALITY.map((q) => [q.key, xs.filter(q.test).length])) as Record<(typeof QUALITY)[number]["key"], number>;
  const checks = xs.length * QUALITY.length;
  const gaps = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    claims: xs.length, counts, pct: checks ? 1 - gaps / checks : null,
    noPolicy: xs.filter((c) => !c.policyId).length,
    noClient: xs.filter((c) => !c.investorId).length,
  };
}
