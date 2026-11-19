/**
 * The Zoho-style reports upgrade (2026-11-19): report periods, date grouping,
 * category columns, the date_period filter and the scheduler's India clock.
 */
import { describe, expect, it } from "vitest";
import { resolveReportPeriod } from "@/lib/reports/period";
import { groupField, groupKeyLabel, splitGroupKey } from "@/lib/reports/grouping";
import { assertValidCategories, categorySql, type CategoryColumn } from "@/lib/reports/categories";
import { compileToSql } from "@/lib/filter/compiler";
import { compileToPredicate } from "@/lib/filter/predicate";
import { and, p } from "@/lib/filter/ast";
import { indiaClock } from "@/workers/report-scheduler";
import { canSeeSavedReport } from "@/lib/reports/visibility";

const TODAY = "2026-11-19";

describe("report periods", () => {
  it("rolling windows end today and include it", () => {
    expect(resolveReportPeriod("last_30", { today: TODAY, fallback: "all" })).toMatchObject({ from: "2026-10-21", to: TODAY });
    expect(resolveReportPeriod("last_90", { today: TODAY, fallback: "all" })).toMatchObject({ from: "2026-08-22", to: TODAY });
    expect(resolveReportPeriod("last_6m", { today: TODAY, fallback: "all" })).toMatchObject({ from: "2026-06-01", to: TODAY });
    expect(resolveReportPeriod("last_12m", { today: TODAY, fallback: "all" })).toMatchObject({ from: "2025-12-01", to: TODAY });
  });

  it("uses the Indian financial year", () => {
    expect(resolveReportPeriod("fy", { today: TODAY, fallback: "all" })).toMatchObject({ from: "2026-04-01", to: TODAY });
    expect(resolveReportPeriod("last_fy", { today: TODAY, fallback: "all" })).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
    expect(resolveReportPeriod("fy", { today: "2027-02-10", fallback: "all" }).from).toBe("2026-04-01");
  });

  it("falls back to the report's default and marks All time unbounded", () => {
    expect(resolveReportPeriod("nonsense", { today: TODAY, fallback: "month" }).key).toBe("month");
    const all = resolveReportPeriod(undefined, { today: TODAY, fallback: "all" });
    expect(all.unbounded).toBe(true);
    expect(all.label).toBe("All time");
  });

  it("reads a custom range the way it was meant", () => {
    const r = resolveReportPeriod("custom", { from: "2026-12-31", to: "2026-10-01", today: TODAY, fallback: "last_30" });
    expect(r).toMatchObject({ key: "custom", from: "2026-10-01", to: TODAY }); // swapped, end capped at today
    expect(resolveReportPeriod("custom", { from: "bad", to: "2026-10-01", today: TODAY, fallback: "last_30" }).key).toBe("last_30");
  });
});

describe("date grouping", () => {
  it("parses a bucketed key", () => {
    expect(splitGroupKey("onboarded_at@month")).toEqual({ field: "onboarded_at", grain: "month" });
    expect(splitGroupKey("city")).toEqual({ field: "city", grain: null });
  });

  it("buckets a date field in India time, FY quarters starting in April", () => {
    const g = groupField("investor", "onboarded_at@quarter");
    expect(g.sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(g.sql).toContain("interval '3 months'");
    expect(g.label).toMatch(/by quarter/);
  });

  it("refuses a grain on a field that is not a date, and an unknown grain", () => {
    expect(() => groupField("investor", "city@month")).toThrow(/not a date/);
    expect(() => groupField("investor", "onboarded_at@decade")).toThrow(/unknown date grouping/);
  });

  it("labels bucket keys for people", () => {
    expect(groupKeyLabel("month", "2026-04")).toBe("Apr 2026");
    expect(groupKeyLabel("day", "2026-11-09")).toBe("9 Nov 2026");
    expect(groupKeyLabel("week", "2026-11-09")).toBe("Week of 9 Nov 2026");
    expect(groupKeyLabel("fy", "FY 2026-27")).toBe("FY 2026-27");
    expect(groupKeyLabel(null, "Mumbai")).toBe("Mumbai");
  });
});

describe("category columns", () => {
  const aumBands: CategoryColumn = {
    id: "c1",
    label: "AUM band",
    source: "aum",
    kind: "number",
    bands: [
      { label: "Up to 10 L", min: null, max: 1000000 },
      { label: "10 L – 1 Cr", min: 1000000, max: 10000000 },
      { label: "Above 1 Cr", min: 10000000, max: null },
    ],
  };

  it("bands a number into ordered codes and reads them as labels", () => {
    const { sql, labelOf } = categorySql("investor", aumBands);
    expect(sql).toContain("< 1000000 THEN '01'");
    expect(sql).toContain(">= 10000000 THEN '03'");
    expect(labelOf("02")).toBe("10 L – 1 Cr");
    expect(labelOf("98")).toBe("Other");
    expect(labelOf("99")).toBe("Not set");
  });

  it("never lets a label reach SQL, and doubles quotes in grouped values", () => {
    const regions: CategoryColumn = {
      id: "c2",
      label: "Region'); DROP TABLE investors;--",
      source: "city",
      kind: "values",
      groups: [{ label: "West'", values: ["Mumbai", "D'Souza Nagar"] }],
    };
    const { sql } = categorySql("investor", regions);
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("West'");
    expect(sql).toContain("'D''Souza Nagar'");
  });

  it("is usable as a group key", () => {
    const g = groupField("investor", "cat:c1", [aumBands]);
    expect(g.label).toBe("AUM band");
    expect(g.labelOf("01")).toBe("Up to 10 L");
    expect(() => groupField("investor", "cat:c9", [aumBands])).toThrow(/not defined/);
  });

  it("rejects bands on a text field and an empty category", () => {
    expect(() => assertValidCategories("investor", [{ ...aumBands, source: "city" }])).toThrow(/not a number/);
    expect(() => assertValidCategories("investor", [{ ...aumBands, bands: [] }])).toThrow(/at least one band/);
  });
});

describe("date_period filter", () => {
  it("compiles to India-midnight bounds with bound parameters", () => {
    const c = compileToSql(and(p("onboarded_at", "date_period", "fy")), "investor");
    expect(c.sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(c.params.some((v) => typeof v === "string" && /^\d{4}-04-01$/.test(v))).toBe(true);
  });

  it("matches in memory on the India date", () => {
    const match = compileToPredicate(and(p("onboarded_at", "date_period", "today")), "investor");
    expect(match({ onboarded_at: new Date() })).toBe(true);
    expect(match({ onboarded_at: new Date(Date.now() - 400 * 864e5) })).toBe(false);
    expect(match({ onboarded_at: null })).toBe(false);
  });
});

describe("report scheduler clock", () => {
  it("reads the hour, weekday and date in India, not the server zone", () => {
    // 20:00 UTC on Thu 19 Nov = 01:30 IST on Fri 20 Nov.
    expect(indiaClock(new Date("2026-11-19T20:00:00Z"))).toEqual({ hour: 1, dow: 5, dom: 20, month: 11 });
  });
});

describe("custom report visibility", () => {
  const me = { userId: "u1", roles: ["rm"] };
  it("hides someone else's private report, except from the owner", () => {
    expect(canSeeSavedReport(me, { createdById: "u2", sharedScope: "private" })).toBe(false);
    expect(canSeeSavedReport(me, { createdById: "u2", sharedScope: "tenant" })).toBe(true);
    expect(canSeeSavedReport(me, { createdById: "u1", sharedScope: "private" })).toBe(true);
    expect(canSeeSavedReport({ userId: "o", roles: ["owner"] }, { createdById: "u2", sharedScope: "private" })).toBe(true);
  });
});
