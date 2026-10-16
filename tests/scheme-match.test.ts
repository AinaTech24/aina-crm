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
import { buildNavIndex, indexName, lookupNav, normSchemeName, type NavIndex, type NavSourceRow } from "@/lib/finance/scheme-match";
import { schemeNameKey } from "@/lib/finance/scheme-name-key";
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

// ── Holdings the NAV master could not price (Oct 2026 audit: ~1,000 legs, Rs 26.8 Cr) ──

const row = (
  code: string,
  name: string,
  nav: number,
  extra: Partial<NavSourceRow> = {},
): NavSourceRow => ({ scheme_code: code, scheme_name: name, nav, nav_date: "2026-10-15", ...extra });

describe("schemeNameKey — registrar spellings", () => {
  const cp = (...n: number[]) => String.fromCharCode(...n);
  const plain = schemeNameKey("Axis Children's Fund - Regular Plan - Growth");

  it("reads the mojibake'd apostrophe (UTF-8 read as cp1252) as the apostrophe it was", () => {
    // Three states a registrar file arrives in: C1 bytes kept, euro-sign form, curly quote.
    for (const bad of [
      "Axis Children" + cp(0xe2, 0x80, 0x99) + "s Fund - Regular Plan - Growth",
      "Axis Children" + cp(0xe2, 0x20ac, 0x2122) + "s Fund - Regular Plan - Growth",
      "Axis Children" + cp(0x2019) + "s Fund - Regular Plan - Growth",
    ]) {
      expect(schemeNameKey(bad)).toEqual(plain);
    }
    expect(plain?.tokens).toContain("childrens");
  });

  it("leaves 'Dividend Yield' funds as Growth funds, not IDCW ones", () => {
    const k = schemeNameKey("ICICI Prudential Dividend Yield Fund - Growth");
    expect(k?.tokens).toContain("growth");
    expect(k?.tokens).not.toContain("idcw");
    // ...while a real dividend OPTION still reads as IDCW.
    expect(schemeNameKey("ICICI Prudential Dividend Yield Fund - Dividend")?.tokens).toContain("idcw");
  });
});

describe("indexName — borrow mfapi's full name only for a blank AMFI row", () => {
  it("fills a row whose Plan/Option columns were empty", () => {
    expect(indexName("Motilal Oswal Large Cap Fund", "Motilal Oswal Large Cap Fund - Direct Plan - Growth Option")).toBe(
      "Motilal Oswal Large Cap Fund - Direct Plan - Growth Option",
    );
  });
  it("keeps AMFI's own name when it already states plan or option", () => {
    expect(indexName("X Fund - Regular Plan - Growth", "X Fund - Direct Plan - IDCW")).toBe("X Fund - Regular Plan - Growth");
  });
  it("refuses a different scheme under the same code", () => {
    expect(indexName("Motilal Oswal Large Cap Fund", "Motilal Oswal Midcap Fund - Direct Plan - Growth")).toBe(
      "Motilal Oswal Large Cap Fund",
    );
  });
});

describe("Motilal Oswal — AMFI rows with empty Plan/Option", () => {
  const BLANK = "Motilal Oswal Large Cap Fund";
  const motilal = [
    row("152001", BLANK, 20.0, { isin: "INF247L01AA1", alt_name: "Motilal Oswal Large Cap Fund - Regular Plan - Growth Option" }),
    row("152002", BLANK, 20.2, { isin: "INF247L01AB9", alt_name: "Motilal Oswal Large Cap Fund - Direct Plan - Growth Option" }),
    row("152003", BLANK, 15.0, { isin: "INF247L01AC7", alt_name: "Motilal Oswal Large Cap Fund - Regular Plan - IDCW Option" }),
    row("152004", BLANK, 15.3, { isin: "INF247L01AD5", alt_name: "Motilal Oswal Large Cap Fund - Direct Plan - IDCW Option" }),
  ];

  it("tells regular from direct and growth from IDCW once mfapi's name is borrowed", () => {
    const idx = buildNavIndex(motilal);
    // 127LCGP is the registrar's code; a statement NAV a few weeks old is not enough
    // to separate regular (20.0) from direct (20.2) on its own — the name must.
    expect(lookupNav(idx, "127LCGP", "Motilal Oswal Large Cap Fund - Regular Plan - Growth", 19.4)).toMatchObject({ code: "152001" });
    expect(lookupNav(idx, "127LCDP", "Motilal Oswal Large Cap Fund - Direct Plan - Growth", 19.6)).toMatchObject({ code: "152002" });
    expect(lookupNav(idx, "127LCRI", "Motilal Oswal Large Cap Fund - Regular Plan - IDCW", 14.6)).toMatchObject({ code: "152003" });
  });

  it("prices straight from the leg's ISIN, whatever the name says", () => {
    const idx = buildNavIndex(motilal);
    expect(lookupNav(idx, "127LCGP", "MO Large Cap", null, "inf247l01ab9")).toMatchObject({ code: "152002", via: "isin" });
  });

  it("with no mfapi name and no ISIN, REFUSES rather than guess regular vs direct", () => {
    const idx = buildNavIndex(motilal.map((r) => ({ ...r, alt_name: null, isin: null })));
    // Regular 20.0 and direct 20.2 are 1% apart; a statement's NAV cannot choose.
    expect(lookupNav(idx, "127LCGP", "Motilal Oswal Large Cap Fund - Regular Plan - Growth", 20.1)).toBeNull();
    expect(lookupNav(idx, "127LCGP", "Motilal Oswal Large Cap Fund - Regular Plan - Growth", 19.0)).toBeNull();
  });
});

describe("renamed funds — the registrar still prints the old name", () => {
  const idx = buildNavIndex([
    row("120001", "ICICI Prudential Dividend Yield Fund - Growth", 40.0),
    row("120002", "ICICI Prudential Dividend Yield Fund - Direct Plan - Growth", 43.0),
    row("120003", "ICICI Prudential Dividend Yield Fund - IDCW", 22.0),
    row("120004", "ICICI Prudential Equity & Debt Fund - Growth", 41.0),
    row("120005", "ICICI Prudential Value Fund - Growth", 39.0),
    row("130001", "Kotak Global Emerging Market Overseas Equity Active FOF - Growth", 35.5),
    row("130002", "Kotak Global Emerging Market Fund - Growth", 36.0),
    row("130003", "Kotak Global Innovation Fund of Fund - Growth", 35.0),
    row("140001", "Old Bridge Focused Fund - Regular Plan - Growth", 14.0),
    row("140002", "Old Bridge Focused Fund - Direct Plan - Growth", 14.6),
    row("140003", "Old Bridge Hybrid Fund - Regular Plan - Growth", 14.1),
    // A big house: enough schemes that "icici prudential" is recognised as the house's name.
    ...Array.from({ length: 14 }, (_, i) => row(String(150000 + i), `ICICI Prudential Filler${i} Fund - Growth`, 100 + i)),
  ]);

  it("ICICI Prudential Dividend Yield Equity Fund -> Dividend Yield Fund", () => {
    expect(lookupNav(idx, "P2373", "ICICI Prudential Dividend Yield Equity Fund - Growth", 39.5)).toMatchObject({ code: "120001" });
  });
  it("Kotak ... Omni FOF -> ... Active FOF, not the lookalike funds beside it", () => {
    expect(
      lookupNav(idx, "K143", "Kotak Global Emerging Market Overseas Equity Omni FOF - Regular Plan - Growth", 35.2),
    ).toMatchObject({ code: "130001" });
  });
  it("Old Bridge Focused Equity Fund -> Focused Fund, regular plan only", () => {
    expect(lookupNav(idx, "139FEGP", "Old Bridge Focused Equity Fund - Regular Plan - Growth", 13.8)).toMatchObject({ code: "140001" });
  });

  it("refuses a genuine tie between two lookalike schemes", () => {
    const tie = buildNavIndex([
      row("1", "Old Bridge Focused Fund - Regular Plan - Growth", 14.0),
      row("2", "Old Bridge Equity Fund - Regular Plan - Growth", 14.1),
    ]);
    expect(lookupNav(tie, "139FEGP", "Old Bridge Focused Equity Fund - Regular Plan - Growth", 13.8)).toBeNull();
  });
  it("still prices the rename when the house's other funds dominate the index", () => {
    expect(lookupNav(idx, "P2373", "ICICI Prudential Dividend Yield Equity Fund - Growth", 39.5)).toMatchObject({ code: "120001" });
  });
  it("reads a Reliance-era registrar name as Nippon India", () => {
    const n = buildNavIndex([
      row("10", "Nippon India Large Cap Fund - Growth", 80),
      row("11", "Nippon India Small Cap Fund - Growth", 160),
    ]);
    expect(lookupNav(n, "RLCGP", "Reliance Large Cap Equity Fund - Growth", 78)).toMatchObject({ code: "10" });
  });
  it("will not take a same-house fund that merely has a similar NAV", () => {
    // 41.0 and 39.0 are ICICI funds near this NAV, but they are other funds.
    expect(lookupNav(idx, "P9999", "ICICI Prudential Quant Fund - Growth", 40.0)).toBeNull();
  });
  it("needs the statement's NAV to attempt a rename match at all", () => {
    expect(lookupNav(idx, "P2373", "ICICI Prudential Dividend Yield Equity Fund - Growth", null)).toBeNull();
  });
  it("refuses when the statement NAV is nowhere near the renamed scheme", () => {
    expect(lookupNav(idx, "P2373", "ICICI Prudential Dividend Yield Equity Fund - Growth", 90)).toBeNull();
  });
});

describe("ISIN", () => {
  it("matches either ISIN column of a scheme", () => {
    const idx = buildNavIndex([row("111", "Some Fund - Growth", 10, { isin: "INF000A01011", isin_reinvest: "INF000A01029" })]);
    expect(lookupNav(idx, "ZZ1", "anything", null, "INF000A01029")).toMatchObject({ code: "111", via: "isin" });
    expect(lookupNav(idx, "ZZ1", "anything", null, " inf000a01011 ")).toMatchObject({ code: "111", via: "isin" });
  });
  it("falls through to the name when the ISIN is unknown", () => {
    const idx = buildNavIndex([row("111", "Some Fund - Growth", 10, { isin: "INF000A01011" })]);
    expect(lookupNav(idx, "ZZ1", "Some Fund - Growth", null, "INF999Z99999")).toMatchObject({ code: "111", via: "name" });
  });
  it("ignores junk that is not an ISIN", () => {
    const idx = buildNavIndex([row("111", "Some Fund - Growth", 10, { isin: "-", isin_reinvest: "N.A." })]);
    expect(idx.byIsin?.size).toBe(0);
  });
  it("refuses an ISIN two live codes claim with different NAVs", () => {
    const idx = buildNavIndex([
      row("111", "Fund A - Growth", 10, { isin: "INF000A01011" }),
      row("222", "Fund B - Growth", 55, { isin: "INF000A01011" }),
    ]);
    expect(lookupNav(idx, "ZZ1", "no such fund", null, "INF000A01011")).toBeNull();
  });
  it("takes the newer-dated code when a re-coded scheme shares its ISIN", () => {
    const idx = buildNavIndex([
      row("111", "Fund A - Growth", 10, { isin: "INF000A01011", nav_date: "2025-01-01" }),
      row("222", "Fund A - Growth ", 12, { isin: "INF000A01011", nav_date: "2026-10-15" }),
    ]);
    expect(lookupNav(idx, "ZZ1", "x", null, "INF000A01011")).toMatchObject({ code: "222" });
  });
});

describe("mfapi.in as a second source", () => {
  const idx = buildNavIndex(
    [row("100", "Union Large Cap Fund - Growth", 50)],
    [
      row("900", "Union Low Duration Fund - Regular Plan - Growth Option", 2450),
      row("901", "Kotak Low Duration Fund - Regular Plan - Growth", 3300, { isin: "INF174K01AA3" }),
      row("100", "Union Large Cap Fund - Growth", 49, { nav_date: "2026-10-01" }),
    ],
  );

  it("prices a scheme AMFI does not list, and says so", () => {
    expect(lookupNav(idx, "UKLORG", "Union Low Duration Fund - Regular Plan - Growth Option", 2430)).toMatchObject({
      code: "900",
      nav: 2450,
      via: "mfapi",
    });
    expect(lookupNav(idx, "K205G", "anything", null, "INF174K01AA3")).toMatchObject({ code: "901", via: "mfapi" });
  });
  it("never overrides a price AMFI can give", () => {
    expect(lookupNav(idx, "ZZ", "Union Large Cap Fund - Growth", 50)).toMatchObject({ code: "100", nav: 50, via: "name" });
  });
  it("still applies the statement-NAV plausibility check", () => {
    // A fund whose mfapi NAV is 2450 cannot be a holding the statement carries at 300.
    expect(lookupNav(idx, "UKLORG", "Union Low Duration Fund - Regular Plan - Growth Option", 300)).toBeNull();
  });
  it("leaves a scheme neither source knows unpriced", () => {
    expect(lookupNav(idx, "RMFSTGP", "Nippon India Short Duration Fund - Growth", 50)).toBeNull();
  });
  it("is absent when there is nothing extra", () => {
    expect(buildNavIndex([row("1", "A - Growth", 1)]).fallback).toBeUndefined();
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
