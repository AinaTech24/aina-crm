import { describe, expect, it } from "vitest";
import { formatGrowth, growthByKey, growthPct, previousBucket } from "@/lib/reports/growth";

describe("previousBucket", () => {
  it("steps back one month, across a year end", () => {
    expect(previousBucket("month", "2026-05")).toBe("2026-04");
    expect(previousBucket("month", "2026-01")).toBe("2025-12");
  });
  it("steps back a year, an FY and an FY quarter", () => {
    expect(previousBucket("year", "2026")).toBe("2025");
    expect(previousBucket("fy", "FY 2026-27")).toBe("FY 2025-26");
    expect(previousBucket("fy", "FY 2000-01")).toBe("FY 1999-00");
    expect(previousBucket("quarter", "FY 2026-27 Q3")).toBe("FY 2026-27 Q2");
    expect(previousBucket("quarter", "FY 2026-27 Q1")).toBe("FY 2025-26 Q4");
  });
  it("has none for a blank group or another grain", () => {
    expect(previousBucket("month", "—")).toBeNull();
    expect(previousBucket("day", "2026-05-01")).toBeNull();
    expect(previousBucket(null, "2026-05")).toBeNull();
  });
});

describe("growthPct", () => {
  it("is the change on the previous value, one decimal", () => {
    expect(growthPct(12.71, 2.44)).toBe(420.9);
    expect(growthPct(5.28, 12)).toBe(-56);
  });
  it("is not stated on a missing, zero or negative base", () => {
    expect(growthPct(5, null)).toBeNull();
    expect(growthPct(5, 0)).toBeNull();
    expect(growthPct(5, -3)).toBeNull();
  });
});

describe("growthByKey", () => {
  it("compares each month with the calendar month before, not the row before", () => {
    const g = growthByKey("month", [
      { key: "2026-04", aggregates: [4.56] },
      { key: "2026-05", aggregates: [2.44] },
      { key: "2026-07", aggregates: [22.82] }, // June missing
    ]);
    expect(g).toEqual({ "2026-04": null, "2026-05": -46.5, "2026-07": null });
  });
  it("ignores the order the groups were sorted in", () => {
    const g = growthByKey("month", [
      { key: "2026-10", aggregates: [5.28] },
      { key: "2026-09", aggregates: [12] },
    ]);
    expect(g["2026-10"]).toBe(-56);
  });
});

describe("formatGrowth", () => {
  it("signs the figure and says — when there is none", () => {
    expect(formatGrowth(420.9)).toBe("+420.9%");
    expect(formatGrowth(-56)).toBe("−56.0%");
    expect(formatGrowth(0)).toBe("0.0%");
    expect(formatGrowth(null)).toBe("—");
  });
});
