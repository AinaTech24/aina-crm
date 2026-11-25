/**
 * Settings → Targets & quota asks for the same seven numbers the dashboard's "My target tracker" shows (2026-11-24),
 * and stores them where the tracker reads them. These tests keep the two from drifting apart.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERSONAL_TARGET_KEYS, PERSONAL_TARGET_METRICS, cleanPersonalTargets, wholePhasedCount } from "@/lib/targets/personal-targets";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the seven fields are the tracker's seven cards", () => {
  it("each field's key is one the tracker reads for a person (PERSON_KEY in my/window.ts)", () => {
    const src = read("src/lib/dashboard/my/window.ts");
    const block = src.slice(src.indexOf("const PERSON_KEY"), src.indexOf("};", src.indexOf("const PERSON_KEY")));
    for (const k of PERSONAL_TARGET_KEYS) expect(block, `${k} is not in PERSON_KEY`).toContain(`"${k}"`);
  });

  it("each field is called what its card is called (loadTargetMeters in my/kpis.ts)", () => {
    const src = read("src/lib/dashboard/my/kpis.ts");
    for (const m of PERSONAL_TARGET_METRICS) expect(src, `${m.label} is not a tracker card`).toContain(`"${m.label}"`);
  });

  it("is exactly seven, with unique keys", () => {
    expect(PERSONAL_TARGET_METRICS).toHaveLength(7);
    expect(new Set(PERSONAL_TARGET_KEYS).size).toBe(7);
  });
});

describe("cleanPersonalTargets", () => {
  it("keeps good numbers, as typed or as text", () => {
    const r = cleanPersonalTargets({ sip_book: 500000, net_sip: "3,00,000", new_clients: "10", insurance_business: "₹ 250000.5" });
    expect(r.set).toEqual({ sip_book: 500000, net_sip: 300000, new_clients: 10, insurance_business: 250000.5 });
    expect(r.clear).toEqual([]);
    expect(r.errors).toEqual({});
  });

  it("a blank, null or zero clears the target — 'Not set', never a target of zero", () => {
    const r = cleanPersonalTargets({ sip_book: "", net_sip: null, mf_business: "  ", meetings: 0, reviews: "0" });
    expect(r.set).toEqual({});
    expect(r.clear.sort()).toEqual(["meetings", "mf_business", "net_sip", "reviews", "sip_book"]);
  });

  it("leaves alone a metric that was not sent", () => {
    const r = cleanPersonalTargets({ meetings: 40 });
    expect(r.set).toEqual({ meetings: 40 });
    expect(r.clear).toEqual([]);
  });

  it("refuses a bad number against its field, and writes nothing for it", () => {
    const r = cleanPersonalTargets({ sip_book: "abc", new_clients: 2.5, meetings: -3, net_sip: 1e15, reviews: 20 });
    expect(Object.keys(r.errors).sort()).toEqual(["meetings", "net_sip", "new_clients", "sip_book"]);
    expect(r.errors.new_clients).toContain("whole number");
    expect(r.set).toEqual({ reviews: 20 });
  });

  it("ignores keys that are not one of the seven, and a missing body", () => {
    expect(cleanPersonalTargets({ aum: 5, annual_target: 9 })).toEqual({ set: {}, clear: [], errors: {} });
    expect(cleanPersonalTargets(null)).toEqual({ set: {}, clear: [], errors: {} });
    expect(cleanPersonalTargets("x")).toEqual({ set: {}, clear: [], errors: {} });
  });

  it("rounds money to paise", () => {
    expect(cleanPersonalTargets({ sip_book: 100.123456 }).set.sip_book).toBe(100.12);
  });
});

describe("wholePhasedCount — a count target falls due in whole ones, rounded up", () => {
  it("rounds 6.548 clients up to 7 and 32.74 meetings up to 33", () => {
    expect(wholePhasedCount(10, 0.65479)).toBe(7);
    expect(wholePhasedCount(50, 0.65479)).toBe(33);
  });
  it("leaves an exact whole alone", () => {
    expect(wholePhasedCount(12, 0.5)).toBe(6);
    expect(wholePhasedCount(10, 1)).toBe(10);
    expect(wholePhasedCount(365, 1 / 365)).toBe(1);
  });
  it("is a whole day-one target of 1 for any small yearly target", () => {
    expect(wholePhasedCount(10, 0.0027)).toBe(1);
  });
});
