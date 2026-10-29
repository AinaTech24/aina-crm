/**
 * Bottlenecks (CEO review S10, 2026-10-24) — the pure half. No database.
 *
 * Input: every STAY in a journey stage the report can see — one row per time
 * a case entered a stage, with when it left (null = still there). Output: per
 * stage, how long a case typically waits there (median and 90th percentile
 * of the stays that finished in the period), how many are there now and the
 * longest current wait; then the same for one stage split by branch and by
 * person, and the cases stuck longest.
 *
 * A finished stay counts in the period it ENDED in; an open stay counts as
 * "in it now" whatever the period. Ages are in days.
 */

export type Stay = {
  journey: string;
  stageKey: string;
  stageName: string;
  stageOrder: number;
  slaDays: number | null;
  subjectId: string;
  subjectName: string | null;
  branchId: string | null;
  branchName: string | null;
  personId: string | null;
  personName: string | null;
  enteredAt: Date;
  /** null = still in this stage. */
  exitedAt: Date | null;
};

export type StageStat = {
  key: string;
  name: string;
  order: number;
  slaDays: number | null;
  /** Stays that finished in the period. */
  done: number;
  medianDays: number | null;
  p90Days: number | null;
  /** Finished stays that took longer than the stage's SLA. */
  overSla: number;
  /** Cases in this stage right now. */
  open: number;
  oldestOpenDays: number | null;
};

export type GroupStat = { id: string | null; name: string; done: number; medianDays: number | null; p90Days: number | null; open: number; oldestOpenDays: number | null };

const DAY = 86_400_000;

/** Nearest-rank percentile of a list of numbers; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.min(s.length, Math.max(1, rank)) - 1];
}

/** Median: the middle value, or the mean of the two middle values. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const days = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / DAY);

function summarise(stays: Stay[], from: Date, now: Date) {
  const doneDays = stays.filter((s) => s.exitedAt && s.exitedAt >= from).map((s) => days(s.enteredAt, s.exitedAt!));
  const openDays = stays.filter((s) => !s.exitedAt).map((s) => days(s.enteredAt, now));
  return {
    done: doneDays,
    open: openDays,
    stat: {
      done: doneDays.length,
      medianDays: median(doneDays),
      p90Days: percentile(doneDays, 90),
      open: openDays.length,
      oldestOpenDays: openDays.length ? Math.max(...openDays) : null,
    },
  };
}

/** One row per stage of a journey, in journey order. */
export function stageStats(stays: Stay[], from: Date, now: Date): StageStat[] {
  const byStage = new Map<string, Stay[]>();
  for (const s of stays) {
    const list = byStage.get(s.stageKey);
    if (list) list.push(s);
    else byStage.set(s.stageKey, [s]);
  }
  const out: StageStat[] = [];
  for (const [key, list] of byStage) {
    const first = list[0];
    const { done, stat } = summarise(list, from, now);
    out.push({
      key,
      name: first.stageName,
      order: first.stageOrder,
      slaDays: first.slaDays,
      ...stat,
      overSla: first.slaDays == null ? 0 : done.filter((d) => d > first.slaDays!).length,
    });
  }
  return out.filter((s) => s.done > 0 || s.open > 0).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * The stage where cases wait longest — the default one to break down: the
 * longest typical wait; when nothing finished a stage in the period, the
 * longest current wait.
 */
export function slowestStage(stats: StageStat[]): StageStat | null {
  const pick = (score: (s: StageStat) => number | null) => {
    let best: StageStat | null = null;
    for (const s of stats) {
      const v = score(s);
      if (v != null && (!best || v > score(best)!)) best = s;
    }
    return best;
  };
  return pick((s) => s.medianDays) ?? pick((s) => s.oldestOpenDays);
}

/** One stage, split by branch or by person; slowest first. */
export function groupStats(stays: Stay[], by: "branch" | "person", from: Date, now: Date): GroupStat[] {
  const groups = new Map<string, { id: string | null; name: string; stays: Stay[] }>();
  for (const s of stays) {
    const id = by === "branch" ? s.branchId : s.personId;
    const name = (by === "branch" ? s.branchName : s.personName) ?? (by === "branch" ? "No branch" : "Unassigned");
    const k = id ?? "∅";
    const g = groups.get(k);
    if (g) g.stays.push(s);
    else groups.set(k, { id, name, stays: [s] });
  }
  return [...groups.values()]
    .map((g) => ({ id: g.id, name: g.name, ...summarise(g.stays, from, now).stat }))
    .filter((g) => g.done > 0 || g.open > 0)
    .sort((a, b) => (b.medianDays ?? -1) - (a.medianDays ?? -1) || (b.oldestOpenDays ?? -1) - (a.oldestOpenDays ?? -1));
}

/** The cases waiting longest in their current stage. */
export function stuckLongest(stays: Stay[], now: Date, limit = 15): Array<Stay & { waitingDays: number }> {
  return stays
    .filter((s) => !s.exitedAt)
    .map((s) => ({ ...s, waitingDays: days(s.enteredAt, now) }))
    .sort((a, b) => b.waitingDays - a.waitingDays)
    .slice(0, limit);
}

/** "3.5 d", "6 h", "—". */
export function formatWait(d: number | null): string {
  if (d == null) return "—";
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  return d < 10 ? `${(Math.round(d * 10) / 10).toString()} d` : `${Math.round(d)} d`;
}
