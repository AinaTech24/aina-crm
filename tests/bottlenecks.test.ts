/**
 * Bottlenecks (CEO review S10): time in each stage, by branch and person,
 * and the cases stuck longest — lib/reports/bottlenecks-core.ts.
 */
import { describe, expect, it } from "vitest";
import { formatWait, groupStats, median, percentile, slowestStage, stageStats, stuckLongest, type Stay } from "@/lib/reports/bottlenecks-core";

const NOW = new Date("2026-10-26T10:00:00Z");
const FROM = new Date("2026-07-28T10:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

let n = 0;
function stay(stageKey: string, enteredDaysAgo: number, stayedDays: number | null, o: Partial<Stay> = {}): Stay {
  const order = { kyc: 1, ucc: 2, mandate: 3 }[stageKey] ?? 9;
  return {
    journey: "leads", stageKey, stageName: stageKey.toUpperCase(), stageOrder: order, slaDays: stageKey === "mandate" ? 3 : null,
    subjectId: `s${++n}`, subjectName: `Client ${n}`, branchId: "b1", branchName: "Ahmedabad", personId: "p1", personName: "Priya",
    enteredAt: ago(enteredDaysAgo), exitedAt: stayedDays == null ? null : ago(enteredDaysAgo - stayedDays), ...o,
  };
}

describe("median / percentile", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([], 90)).toBeNull();
  });
});

describe("stageStats", () => {
  const stays = [
    stay("kyc", 40, 1), stay("kyc", 30, 2), stay("kyc", 20, 3),
    stay("mandate", 40, 9), stay("mandate", 30, 10), stay("mandate", 20, 2),
    stay("mandate", 12, null), // still waiting, 12 days
    stay("ucc", 200, 1), // finished before the period
  ];
  const stats = stageStats(stays, FROM, NOW);

  it("lists stages in journey order and drops one with nothing in the period", () => {
    expect(stats.map((s) => s.key)).toEqual(["kyc", "mandate"]);
  });

  it("gives the typical and slow waits of the stays that finished", () => {
    const m = stats.find((s) => s.key === "mandate")!;
    expect(m.done).toBe(3);
    expect(m.medianDays).toBeCloseTo(9);
    expect(m.p90Days).toBeCloseTo(10);
    expect(m.overSla).toBe(2);
    expect(m.open).toBe(1);
    expect(m.oldestOpenDays).toBeCloseTo(12);
  });

  it("names the slowest stage", () => {
    expect(slowestStage(stats)?.key).toBe("mandate");
    expect(slowestStage([])).toBeNull();
    // A typical wait beats one long current wait; with no finished stays, the longest wait decides.
    const s2 = stageStats([stay("kyc", 10, 2), stay("ucc", 90, null)], FROM, NOW);
    expect(slowestStage(s2)?.key).toBe("kyc");
    expect(slowestStage(stageStats([stay("kyc", 5, null), stay("ucc", 9, null)], FROM, NOW))?.key).toBe("ucc");
  });
});

describe("groupStats / stuckLongest", () => {
  const stays = [
    stay("mandate", 40, 9), stay("mandate", 30, 11),
    stay("mandate", 20, 2, { branchId: "b2", branchName: "Surat", personId: "p2", personName: "Ravi" }),
    stay("mandate", 5, null, { branchId: null, branchName: null, personId: null, personName: null }),
    stay("kyc", 25, null),
  ];

  it("splits a stage by branch, slowest first, and keeps the unassigned", () => {
    const b = groupStats(stays.filter((s) => s.stageKey === "mandate"), "branch", FROM, NOW);
    expect(b.map((g) => g.name)).toEqual(["Ahmedabad", "Surat", "No branch"]);
    expect(b[0].medianDays).toBeCloseTo(10);
    expect(b[2].open).toBe(1);
    const p = groupStats(stays.filter((s) => s.stageKey === "mandate"), "person", FROM, NOW);
    expect(p.find((g) => g.id === null)?.name).toBe("Unassigned");
  });

  it("lists the open cases by how long they have waited", () => {
    const s = stuckLongest(stays, NOW);
    expect(s.map((x) => x.stageKey)).toEqual(["kyc", "mandate"]);
    expect(s[0].waitingDays).toBeCloseTo(25);
  });
});

describe("formatWait", () => {
  it("reads as hours under a day, days after", () => {
    expect(formatWait(null)).toBe("—");
    expect(formatWait(0.25)).toBe("6 h");
    expect(formatWait(0.001)).toBe("1 h");
    expect(formatWait(3.46)).toBe("3.5 d");
    expect(formatWait(12.6)).toBe("13 d");
  });
});
