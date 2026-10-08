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
