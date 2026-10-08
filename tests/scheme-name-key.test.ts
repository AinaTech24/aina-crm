/**
 * A registrar's scheme name must find AMFI's scheme — or nothing. Every case
 * here is a real pair seen in production on 8 Oct 2026, when 1,638 registrar
 * product codes (Rs 3,439 Cr of purchases) priced nowhere.
 */
import { describe, expect, it } from "vitest";
import { schemeNameKey } from "@/lib/finance/scheme-name-key";
import { lookupNavByKey, type NavIndex } from "@/lib/finance/scheme-match";

const same = (a: string, b: string) => expect(schemeNameKey(a)).toEqual(schemeNameKey(b));
const differ = (a: string, b: string) => expect(schemeNameKey(a)).not.toEqual(schemeNameKey(b));

describe("schemeNameKey", () => {
  it("reads one scheme the way every registrar and AMFI write it", () => {
    same("HDFC Large & Mid Cap Fund - Regular Plan - Growth", "HDFC Large and Mid Cap Fund - Growth Option");
    same("Kotak Arbitrage Fund - Growth (Regular Plan)", "Kotak Arbitrage Fund - Regular Plan - Growth");
    same("Kotak Multi Cap Fund Regular Plan - Growth", "Kotak Multicap Fund-Regular Plan-Growth");
    same("UTI Flexi Cap Fund - Regular Plan", "UTI Flexi Cap Fund - Regular Plan - Growth Option");
    same("ICICI Prudential Nifty 50 Index Fund - Growth", "ICICI Prudential Nifty 50 Index Fund - Regular Plan - Cumulative");
    same("HDFC Childrens Fund - Regular Plan", "HDFC Children's Fund - Regular Plan - Growth Option");
    same(
      "ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Growth",
      "ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Regular Plan - Growth",
    );
    same(
      "Mirae Asset Ultra Short to Short Term Fund (formerly MiraeAsset Low Duration Fun - Regular Plan",
      "Mirae Asset Ultra Short to Short Term Fund - Regular Plan - Growth",
    );
    same("Tata Aggressive Hybrid Fund Regular Plan - IDCW Monthly", "Tata Aggressive Hybrid Fund - Regular Plan - Monthly Payout of IDCW Option");
    same("Reliance Liquid Fund - Growth Plan", "Nippon India Liquid Fund - Growth Plan - Growth Option");
  });

  it("keeps apart what is priced differently", () => {
    differ("HDFC Flexi Cap Fund - Regular Plan - Growth", "HDFC Flexi Cap Fund - Direct Plan - Growth");
    differ("HDFC Flexi Cap Fund - Growth", "HDFC Flexi Cap Fund - IDCW");
    differ("Axis Liquid Fund - Daily IDCW", "Axis Liquid Fund - Weekly IDCW");
    differ("SBI Large & Midcap Fund - Growth", "SBI Midcap Fund - Growth");
  });
});

describe("lookupNavByKey", () => {
  const index = (rows: Array<[string, string, number, string]>): NavIndex => {
    const byKey: NonNullable<NavIndex["byKey"]> = new Map();
    for (const [code, name, nav, navDate] of rows) {
      const k = schemeNameKey(name)!;
      const key = `${k.tokens}|${k.direct ? "d" : "r"}`;
      byKey.set(key, [...(byKey.get(key) ?? []), { code, nav, navDate, name }]);
    }
    return { byCode: new Map(), byName: new Map(), byKey, size: rows.length };
  };

  it("prices a registrar name AMFI writes differently", () => {
    const hit = lookupNavByKey(index([["100", "HDFC Large and Mid Cap Fund - Regular Plan - Growth", 321.5, "2026-10-07"]]), "HDFC Large & Mid Cap Fund - Regular Plan - Growth");
    expect(hit?.code).toBe("100");
  });

  it("prefers the scheme still being priced, then the one that names its plan", () => {
    const idx = index([
      ["1", "Edelweiss Money Market Fund", 20, "2019-01-01"],
      ["2", "Edelweiss Money Market Fund - Regular Plan - Growth", 30, "2026-10-07"],
      ["3", "Edelweiss Money Market Fund", 40, "2026-10-07"],
    ]);
    expect(lookupNavByKey(idx, "Edelweiss Money Market Fund - Regular Plan Growth")?.code).toBe("2");
  });

  it("refuses a tie it cannot settle, and accepts one where the NAV is the same", () => {
    const tie = index([
      ["a", "HSBC Multi Cap Fund - Regular Plan - Growth", 19.76, "2026-10-07"],
      ["b", "HSBC Multi Cap Fund - Regular Plan - Growth", 16.25, "2026-10-07"],
    ]);
    expect(lookupNavByKey(tie, "HSBC Multi Cap Fund - Regular Growth")).toBeNull();
    const payoutReinvest = index([
      ["p", "X Fund - Regular Plan - Monthly IDCW Payout", 11.2, "2026-10-07"],
      ["r", "X Fund - Regular Plan - Monthly IDCW Reinvestment", 11.2, "2026-10-07"],
    ]);
    expect(lookupNavByKey(payoutReinvest, "X Fund Regular Monthly IDCW")?.nav).toBe(11.2);
  });
});

describe("the statement's own NAV settles which scheme it is", () => {
  const build = (rows: Array<[string, string, number, string]>) => {
    const byKey: NonNullable<NavIndex["byKey"]> = new Map();
    const all: NonNullable<NavIndex["all"]> = [];
    for (const [code, name, nav, navDate] of rows) {
      const k = schemeNameKey(name)!;
      const key = `${k.tokens}|${k.direct ? "d" : "r"}`;
      byKey.set(key, [...(byKey.get(key) ?? []), { code, nav, navDate, name }]);
      all.push({ code, nav, navDate, name, words: new Set(k.tokens.split(" ")), direct: k.direct });
    }
    return { byCode: new Map(), byName: new Map(), byKey, all, size: rows.length } as NavIndex;
  };

  it("picks the same-named scheme whose NAV is nearest the statement's", async () => {
    const { lookupNav } = await import("@/lib/finance/scheme-match");
    const idx = build([
      ["151289", "HSBC Multi Cap Fund - Regular Plan - Growth", 19.8061, "2026-10-07"],
      ["151292", "HSBC Multi Cap Fund - Regular Plan - Growth", 16.2818, "2026-10-07"],
    ]);
    expect(lookupNav(idx, "OHMCRG", "HSBC Multi Cap Fund - Regular Growth", 19.7376)?.code).toBe("151289");
    expect(lookupNav(idx, "OHMCRG", "HSBC Multi Cap Fund - Regular Growth", null)).toBeNull();
  });

  it("finds a scheme whose name the registrar wrote differently, by house + words + NAV", async () => {
    const { lookupNav } = await import("@/lib/finance/scheme-match");
    const idx = build([
      ["100900", "HDFC Children's Fund - Regular Plan - Growth Option", 290.4, "2026-10-07"],
      ["100901", "HDFC Children's Fund - Direct Plan - Growth Option", 330.1, "2026-10-07"],
      ["119067", "HDFC Flexi Cap Fund - Regular Plan - Growth", 1900, "2026-10-07"],
    ]);
    expect(lookupNav(idx, "HCGIL", "HDFC Childrens Fund  (Lock-In) - Regular Plan'", 286.1)?.code).toBe("100900");
  });

  it("refuses a name match whose NAV is far from the statement's (another option or plan)", async () => {
    const { lookupNav } = await import("@/lib/finance/scheme-match");
    const idx = build([["200", "X Fund - Regular Plan - Growth", 48.05, "2026-10-07"]]);
    expect(lookupNav(idx, "XG", "X Fund - Regular Plan - Growth", 89.45)).toBeNull();
  });
});
