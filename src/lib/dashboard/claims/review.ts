/**
 * Time on the Claims Control Centre: the FY month by month and its backlog
 * (§43–45), today's flow and closure (§46–47), the weekly and monthly
 * reviews (§48–49) and the FY scorecard (§50).
 *
 * What can be known about a PAST day: whether a claim was open (opened by
 * then, not closed by then), how old it was, whether it had passed its SLA.
 * What cannot: its status that day — the CRM overwrites the status, and the
 * audit trail keeps only when each status was first and last entered. So
 * "file not received", "documents pending" and "queries pending" are shown
 * for NOW only and labelled so, never back-filled for last week.
 */

import { formatDate } from "@/lib/format";
import { closedIn, loggedIn, openAt, type ClaimRec } from "./set";
import { addDays, daysBetween, fyStartOf, istDate, monthBefore, monthStart, type ClaimWindow } from "./window";

const SETTLED = ["settled_fully", "settled_partially"];
const isSettled = (c: ClaimRec) => SETTLED.includes(c.status);
const sum = (xs: ClaimRec[], f: (c: ClaimRec) => number) => xs.reduce((a, c) => a + f(c), 0);

/* ───────────────────────── §43–45 ───────────────────────── */

export type MonthFigures = {
  opening: number; logged: number; loggedAmt: number; settled: number; settledAmt: number;
  rejected: number; withdrawn: number; closed: number; closing: number; closingAmt: number;
};
export type MonthPoint = { month: string; label: string; partial: boolean; lines: Record<"all" | "personal" | "commercial", MonthFigures> };

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

function figures(xs: ClaimRec[], start: string, end: string): MonthFigures {
  const closed = xs.filter((c) => closedIn(c, start, end));
  const closing = xs.filter((c) => openAt(c, end));
  return {
    opening: xs.filter((c) => openAt(c, addDays(start, -1))).length,
    logged: xs.filter((c) => loggedIn(c, start, end)).length,
    loggedAmt: sum(xs.filter((c) => loggedIn(c, start, end)), (c) => c.claimed),
    settled: closed.filter(isSettled).length,
    settledAmt: sum(closed.filter(isSettled), (c) => c.settled),
    rejected: closed.filter((c) => c.status === "rejected").length,
    withdrawn: closed.filter((c) => c.status === "withdrawn").length,
    closed: closed.length,
    closing: closing.length,
    closingAmt: sum(closing, (c) => c.claimed),
  };
}

/** April to the current month of the FY containing the period's end. */
export function monthlyTrend(set: ClaimRec[], w: ClaimWindow): MonthPoint[] {
  const end = w.to < w.today ? w.to : w.today;
  const fy = fyStartOf(end);
  const out: MonthPoint[] = [];
  let m = fy;
  while (m <= end) {
    const next = addDays(`${m.slice(0, 7)}-28`, 4).slice(0, 7) + "-01";
    const last = addDays(next, -1);
    const stop = last < end ? last : end;
    const byLine = (line: "all" | "personal" | "commercial") =>
      figures(line === "all" ? set : set.filter((c) => c.line === line), m, stop);
    out.push({
      month: m.slice(0, 7), label: MONTH[Number(m.slice(5, 7)) - 1], partial: stop !== last,
      lines: { all: byLine("all"), personal: byLine("personal"), commercial: byLine("commercial") },
    });
    m = next;
  }
  return out;
}

/* ───────────────────────── §46–47 ───────────────────────── */

const enteredOn = (c: ClaimRec, statuses: string[], day: string) => statuses.some((s) => istDate(c.hist[s]?.l) === day);

export function dailyFlow(set: ClaimRec[], w: ClaimWindow) {
  const today = w.today;
  const yesterday = addDays(today, -1);
  const open = set.filter((c) => c.isOpen);
  return {
    opening: set.filter((c) => openAt(c, yesterday)).length,
    newToday: set.filter((c) => c.openedOn === today).length,
    closedToday: set.filter((c) => closedIn(c, today, today)).length,
    closing: open.length,
    newDocsPending: set.filter((c) => enteredOn(c, ["file_awaited"], today)).length,
    newQueries: set.filter((c) => enteredOn(c, ["query", "add_info_awaited"], today)).length,
    newBreaches: open.filter((c) => daysBetween(c.slaDue, today) === 1).length,
    // Today's closure (§47)
    docsCompleted: set.filter((c) => enteredOn(c, ["file_received"], today)).length,
    submitted: set.filter((c) => c.submissionDate === today).length,
    queriesAnswered: set.filter((c) => enteredOn(c, ["query_replied"], today)).length,
    settled: set.filter((c) => isSettled(c) && closedIn(c, today, today)).length,
    rejected: set.filter((c) => c.status === "rejected" && closedIn(c, today, today)).length,
    slaBreached: open.filter((c) => c.sla === "breached").length,
  };
}

/* ───────────────────────── §48–50 ───────────────────────── */

export type ReviewRow = {
  key: string; label: string; format: "currency" | "count" | "percent";
  values: Array<number | null>;
  /** "up" when more is better, "down" when less is, "neutral" when neither is a verdict (rejections). */
  sense: "up" | "down" | "neutral";
  /** Known only for today: the CRM keeps no status history per day. */
  nowOnly?: boolean;
};
export type Review = { labels: string[]; rows: ReviewRow[] };

const breachedAt = (c: ClaimRec, day: string, slaDays: number) => openAt(c, day) && daysBetween(addDays(c.openedOn, slaDays), day) > 0;
const agedAt = (c: ClaimRec, day: string, n: number) => openAt(c, day) && daysBetween(c.openedOn, day) > n;
/** Closed within the SLA ÷ closed, in the window; grievance cases left out. */
function slaPct(set: ClaimRec[], from: string, to: string, slaDays: number): number | null {
  const closed = set.filter((c) => (isSettled(c) || c.status === "rejected") && closedIn(c, from, to) && !c.legal && c.tatDays != null);
  return closed.length ? closed.filter((c) => (c.tatDays ?? 0) <= slaDays).length / closed.length : null;
}
const fmt = (iso: string) => formatDate(iso, "dayMonth");

export function weeklyReview(set: ClaimRec[], w: ClaimWindow): Review {
  const to = w.today;
  const dow = (new Date(`${to}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(to, -dow);
  const spans = [{ from: addDays(from, -7), to: addDays(to, -7) }, { from, to }];
  const open = set.filter((c) => c.isOpen);
  const flow = (f: (s: { from: string; to: string }) => number) => spans.map(f);
  const nowOnly = (v: number) => [null, v];
  const sla = w.t.claimSlaDays;
  return {
    labels: spans.map((s) => `${fmt(s.from)} – ${fmt(s.to)}`),
    rows: [
      { key: "logged", label: "Claims logged", format: "count", sense: "neutral", values: flow((s) => set.filter((c) => loggedIn(c, s.from, s.to)).length) },
      { key: "settled", label: "Claims settled", format: "count", sense: "up", values: flow((s) => set.filter((c) => isSettled(c) && closedIn(c, s.from, s.to)).length) },
      { key: "rejected", label: "Claims rejected", format: "count", sense: "neutral", values: flow((s) => set.filter((c) => c.status === "rejected" && closedIn(c, s.from, s.to)).length) },
      { key: "open", label: "Open at the end", format: "count", sense: "down", values: flow((s) => set.filter((c) => openAt(c, s.to)).length) },
      { key: "fnr", label: "File not received", format: "count", sense: "down", nowOnly: true, values: nowOnly(open.filter((c) => c.status === "file_awaited" || c.status === "empty").length) },
      { key: "claimed", label: "Claim amount (logged)", format: "currency", sense: "neutral", values: flow((s) => sum(set.filter((c) => loggedIn(c, s.from, s.to)), (c) => c.claimed)) },
      { key: "settledAmt", label: "Settled amount", format: "currency", sense: "up", values: flow((s) => sum(set.filter((c) => isSettled(c) && closedIn(c, s.from, s.to)), (c) => c.settled)) },
      { key: "docs", label: "Documents pending", format: "count", sense: "down", nowOnly: true, values: nowOnly(open.filter((c) => c.status === "file_awaited" || c.status === "add_info_awaited").length) },
      { key: "queries", label: "Queries pending", format: "count", sense: "down", nowOnly: true, values: nowOnly(open.filter((c) => c.status === "query" || c.status === "add_info_awaited").length) },
      { key: "breached", label: "SLA breached (at the end)", format: "count", sense: "down", values: flow((s) => set.filter((c) => breachedAt(c, s.to, sla)).length) },
      { key: "hv", label: "High-value open (at the end)", format: "count", sense: "down", values: flow((s) => set.filter((c) => openAt(c, s.to) && c.highValue).length) },
    ],
  };
}

export function monthlyReview(set: ClaimRec[], w: ClaimWindow): Review {
  const to = w.today;
  const cur = { from: monthStart(to), to };
  const prev = { from: monthStart(monthBefore(to)), to: monthBefore(to) };
  const spans = [prev, cur];
  const open = set.filter((c) => c.isOpen);
  const flow = (f: (s: { from: string; to: string }) => number | null) => spans.map(f);
  const sla = w.t.claimSlaDays;
  return {
    labels: spans.map((s) => `${fmt(s.from)} – ${fmt(s.to)}`),
    rows: [
      { key: "opening", label: "Opening open claims", format: "count", sense: "neutral", values: flow((s) => set.filter((c) => openAt(c, addDays(s.from, -1))).length) },
      { key: "new", label: "New claims", format: "count", sense: "neutral", values: flow((s) => set.filter((c) => loggedIn(c, s.from, s.to)).length) },
      { key: "settled", label: "Settled claims", format: "count", sense: "up", values: flow((s) => set.filter((c) => isSettled(c) && closedIn(c, s.from, s.to)).length) },
      { key: "rejected", label: "Rejected", format: "count", sense: "neutral", values: flow((s) => set.filter((c) => c.status === "rejected" && closedIn(c, s.from, s.to)).length) },
      { key: "closing", label: "Closing open claims", format: "count", sense: "down", values: flow((s) => set.filter((c) => openAt(c, s.to)).length) },
      { key: "claimed", label: "Claim amount (logged)", format: "currency", sense: "neutral", values: flow((s) => sum(set.filter((c) => loggedIn(c, s.from, s.to)), (c) => c.claimed)) },
      { key: "settledAmt", label: "Settled amount", format: "currency", sense: "up", values: flow((s) => sum(set.filter((c) => isSettled(c) && closedIn(c, s.from, s.to)), (c) => c.settled)) },
      { key: "outstanding", label: "Outstanding (claimed on open claims)", format: "currency", sense: "down", values: flow((s) => sum(set.filter((c) => openAt(c, s.to)), (c) => c.claimed)) },
      { key: "fnr", label: "File not received", format: "count", sense: "down", nowOnly: true, values: [null, open.filter((c) => c.status === "file_awaited" || c.status === "empty").length] },
      { key: "d30", label: "Open 30+ days", format: "count", sense: "down", values: flow((s) => set.filter((c) => agedAt(c, s.to, 30)).length) },
      { key: "d60", label: "Open 60+ days", format: "count", sense: "down", values: flow((s) => set.filter((c) => agedAt(c, s.to, 60)).length) },
      { key: "d90", label: "Open 90+ days", format: "count", sense: "down", values: flow((s) => set.filter((c) => agedAt(c, s.to, 90)).length) },
      { key: "slaPct", label: "Closed within SLA", format: "percent", sense: "up", values: flow((s) => slaPct(set, s.from, s.to, sla)) },
    ],
  };
}

export function fyScorecard(set: ClaimRec[], w: ClaimWindow) {
  const from = w.fyStart;
  const to = w.today;
  const logged = set.filter((c) => loggedIn(c, from, to));
  const settledX = set.filter((c) => isSettled(c) && closedIn(c, from, to));
  return {
    logged: logged.length,
    claimed: sum(logged, (c) => c.claimed),
    settled: settledX.length,
    settledAmt: sum(settledX, (c) => c.settled),
    rejected: set.filter((c) => c.status === "rejected" && closedIn(c, from, to)).length,
    open: set.filter((c) => c.isOpen).length,
    aged90: set.filter((c) => c.isOpen && (c.ageDays ?? 0) > 90).length,
    slaPct: slaPct(set, from, to, w.t.claimSlaDays),
  };
}
