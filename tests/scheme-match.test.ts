/**
 * Guards the fix for a stale-book bug that hid for months.
 *
 * `scheme_nav` is keyed by AMFI's numeric code; the holdings importer stores the
 * REGISTRAR's product code. A code-only lookup therefore missed 17,637 of
 * 19,867 stored legs on VSN Financial Services (Rs 544.98 Cr of a Rs 627.42 Cr
 * book), which sat at their last imported price while the firm's headline AUM
 * drifted by a few lakh a day and every dashboard looked healthy.
 */

import { describe, expect, it } from "vitest";
import { lookupNav, normSchemeName, type NavIndex } from "@/lib/finance/scheme-match";
import { describeRun } from "../src/workers/scheduler-state";

const entry = (code: string, nav: number) => ({ code, nav, navDate: "2026-09-29" });

/** Two AMFI codes share "Ambiguous Twin Fund - Growth", so that name is refused. */
const index: NavIndex = {
  byCode: new Map([
    ["150347", entry("150347", 20)],
    ["118989", entry("118989", 50)],
  ]),
  byName: new Map<string, ReturnType<typeof entry> | null>([
    ["whiteoak capital flexi cap fund regular plan growth", entry("150347", 20)],
    ["franklin india opportunities fund growth", entry("118989", 50)],
    ["ambiguous twin fund growth", null],
  ]),
  size: 2,
};

describe("normSchemeName", () => {
  it("collapses punctuation and case so registrar spelling still matches AMFI's", () => {
    expect(normSchemeName("WhiteOak Capital - Flexi Cap Fund - Regular Plan Growth")).toBe(
      "whiteoak capital flexi cap fund regular plan growth"
    );
    expect(normSchemeName("NIPPON  INDIA   GROWTH/MID-CAP")).toBe("nippon india growth mid cap");
    expect(normSchemeName(null)).toBe("");
  });

  it("KEEPS plan and option words", () => {
    // Pricing a Regular plan at the Direct plan's NAV is a silent wrong number,
    // which is worse than leaving the holding unpriced.
    expect(normSchemeName("Axis Bluechip Fund - Direct Plan - Growth")).not.toBe(
      normSchemeName("Axis Bluechip Fund - Regular Plan - Growth")
    );
    expect(normSchemeName("SBI Focused Fund - Growth")).not.toBe(normSchemeName("SBI Focused Fund - IDCW"));
  });
});

describe("lookupNav", () => {
  it("prefers the AMFI code when the leg already carries one", () => {
    const hit = lookupNav(index, "150347", "anything at all");
    expect(hit).toMatchObject({ code: "150347", nav: 20, via: "code" });
  });

  it("falls back to the scheme name for a registrar code — the actual bug", () => {
    // Y1035 is WhiteOak's registrar code; it is not in the NAV master at all.
    const hit = lookupNav(index, "Y1035", "WhiteOak Capital - Flexi Cap Fund - Regular Plan Growth");
    expect(hit).toMatchObject({ code: "150347", nav: 20, via: "name" });
  });

  it("refuses a name shared by two AMFI codes rather than guessing", () => {
    expect(lookupNav(index, "TWIN1", "Ambiguous Twin Fund - Growth")).toBeNull();
  });

  it("returns null for a scheme it has never heard of", () => {
    expect(lookupNav(index, "ZZZZZZ", "Some Fund That Does Not Exist - Growth")).toBeNull();
  });

  it("does not blow up on a leg with neither code nor name", () => {
    expect(lookupNav(index, null, null)).toBeNull();
    expect(lookupNav(index, "", "")).toBeNull();
  });
});

describe("describeRun — a job that finished is not a job that worked", () => {
  it("records a swallowed per-tenant failure as partial, not ok", () => {
    // The daily ops scan catches a tenant's error and carries on. It returned
    // failedTenants all along; the scheduler recorded "ok" regardless, which is
    // how one firm's AUM sat twelve days stale without a single alert.
    const r = describeRun({ failedTenants: ["tenant-a", "tenant-b"] }, "scheduled");
    expect(r.status).toBe("partial");
    expect(r.detail).toContain("2 tenant(s) FAILED");
    expect(r.detail).toContain("tenant-a");
  });

  it("keeps unpriced holdings at ok but says how many and how much", () => {
    // Some schemes genuinely cannot be priced; raising this to partial nightly
    // would train people to ignore the field.
    const r = describeRun(
      { failedTenants: [], totals: { legsUnpriced: 12, legsUnpricedValue: 5400000, aumSkippedUnpriced: 3 } },
      "scheduled"
    );
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("12 holding(s) unpriced");
    expect(r.detail).toContain("54 lakh");
    expect(r.detail).toContain("3 client(s) AUM not refreshed");
  });

  it("is quiet on a clean run, and survives a job that returns nothing", () => {
    expect(describeRun({ failedTenants: [], totals: { legsUnpriced: 0 } }, "scheduled")).toEqual({
      status: "ok",
      detail: "scheduled",
    });
    expect(describeRun(undefined, "boot").status).toBe("ok");
    expect(describeRun(null, "catchup").detail).toBe("catchup");
  });
});
