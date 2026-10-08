/**
 * Phase 3I — the pure rules: AMFI NAVAll read strictly (both published
 * layouts, header and column validation, both ISIN columns, explicit plan /
 * option, NAV and date, duplicates), and the registrar-code decision (ISIN,
 * ambiguity, AMC identity, plan / option contradictions, inactive schemes,
 * platform mappings, confirmations). Synthetic rows in AMFI's published shape.
 */
import { describe, expect, it } from "vitest";
import { analyseNavAll } from "@/lib/finance/nav-feed";
import { amcKey, amfiMarkers, decideScheme, markerContradiction, markersOf, nameRank, type AmfiMatch } from "@/lib/rta/scheme-evidence";

const H8 = "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date";
const H6 = "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date";
const feed8 = (rows: string[]) => [H8, "", "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)", "", "Iota Mutual Fund", "", ...rows].join("\r\n");

describe("AMFI NAVAll — strict reading", () => {
  it("the current eight-column layout: both ISIN columns, explicit plan / option, NAV and date as printed, AMC and category from the section lines", () => {
    const a = analyseNavAll(feed8([
      "990001;INF9I0A01AA1;;Iota Flexi Cap Fund;Direct Plan;Growth;123.4567;07-Oct-2026",
      "990002;INF9I0A01CC3;INF9I0A01DD4;Iota Flexi Cap Fund;Regular Plan;IDCW;20.1;06-Oct-2026",
    ]));
    expect(a.errors).toEqual([]);
    expect(a.layout).toBe("current8");
    expect(a.feedDate).toBe("2026-10-07"); // the newest date printed — never "today"
    expect(a.rows[0]).toMatchObject({ schemeCode: "990001", isinPayoutGrowth: "INF9I0A01AA1", isinReinvest: null, plan: "Direct Plan", option: "Growth", nav: 123.4567, navDate: "2026-10-07", amcName: "Iota Mutual Fund", schemeCategory: "Equity Scheme - Flexi Cap Fund" });
    expect(a.rows[1]).toMatchObject({ isinPayoutGrowth: "INF9I0A01CC3", isinReinvest: "INF9I0A01DD4", option: "IDCW", navDate: "2026-10-06" });
  });

  it("the legacy six-column layout is still read; plan and option are unknown there, not guessed", () => {
    const a = analyseNavAll([H6, "Iota Mutual Fund", "990001;INF9I0A01AA1;;Iota Flexi Cap Fund - Direct Plan - Growth;123.4;07-Oct-2026"].join("\n"));
    expect(a.layout).toBe("legacy6");
    expect(a.rows[0]).toMatchObject({ plan: null, option: null, nav: 123.4 });
  });

  it("an unrecognised or reordered header accepts NOTHING", () => {
    expect(analyseNavAll("Scheme Code;Scheme Name;ISIN;NAV;Date\n990001;X;INF9I0A01AA1;1;07-Oct-2026").errors[0]).toMatch(/unrecognised header/);
    const swapped = H8.replace("Plan;Option", "Option;Plan");
    const a = analyseNavAll([swapped, "990001;INF9I0A01AA1;;X;Growth;Direct Plan;1;07-Oct-2026"].join("\n"));
    expect(a.layout).toBeNull();
    expect(a.rows).toEqual([]);
  });

  it("a row with the wrong column count is malformed, a bad ISIN is dropped and counted, N.A. is no NAV (identity only)", () => {
    const a = analyseNavAll(feed8([
      "990001;INF9I0A01AA1;;Short row;1;07-Oct-2026",
      "990002;NOT-AN-ISIN;;Iota Bad Isin Fund;Regular Plan;Growth;10;07-Oct-2026",
      "990003;INF9I0A01EE5;;Iota Unpriced Fund;Regular Plan;Growth;N.A.;07-Oct-2026",
    ]));
    expect(a.malformed).toBe(1);
    expect(a.invalidIsins).toBe(1);
    expect(a.rows.find((r) => r.schemeCode === "990002")).toMatchObject({ isinPayoutGrowth: null });
    expect(a.rows.find((r) => r.schemeCode === "990003")).toMatchObject({ nav: null, isinPayoutGrowth: "INF9I0A01EE5" });
  });

  it("a code printed twice identically is read once; printed twice differently it is reported; an ISIN on two codes is reported", () => {
    const same = "990001;INF9I0A01AA1;;Iota Flexi Cap Fund;Direct Plan;Growth;123.4;07-Oct-2026";
    const a = analyseNavAll(feed8([same, same, "990002;INF9I0A01AA1;;Iota Other Fund;Direct Plan;Growth;10;07-Oct-2026",
      "990003;INF9I0A01FF6;;Iota X;Regular Plan;Growth;10;07-Oct-2026", "990003;INF9I0A01FF6;;Iota X;Regular Plan;Growth;11;07-Oct-2026"]));
    expect(a.rows.filter((r) => r.schemeCode === "990001")).toHaveLength(1);
    expect(a.duplicateCodes.sort()).toEqual(["990001", "990003"]);
    expect(a.conflictingDuplicates).toEqual(["990003"]);
    expect(a.isinOnManyCodes).toEqual(["INF9I0A01AA1"]);
  });

  it("the real file's shapes: '-' and 'Redeemed' are no ISIN (not invalid); the feed date is the date most schemes carry; closed schemes keep old NAV dates without rejecting the file", () => {
    const a = analyseNavAll(feed8([
      "990001;INF9I0A01AA1;-;Iota Flexi Cap Fund;Direct Plan;Growth Option;29.2304;07-Oct-2026",
      "990002;INF9I0A01BB2;-;Iota Flexi Cap Fund;Regular Plan;Growth Option;25.4417;07-Oct-2026",
      "990003;INF9I0A01CC3;Redeemed;Iota Infrastructure Debt Fund Series 1A;;;1680494.0463;31-Dec-2018",
      "990004;INF9I0A01EE5;-;Iota Gold Exchange Traded Fund;;;131.8318;08-Oct-2026",
      "990005;INF9I0A01FF6;HDFCNIVODG;Iota Index Fund;Direct Plan;Growth Option;9.7078;07-Oct-2026",
      "990006;INF9I0A01GG7;-;Iota Matured FMP;;;0.0000;02-Jul-2018",
    ]));
    expect(a.errors).toEqual([]);
    expect(a.isinPlaceholders).toBe(5);
    expect(a.invalidIsins).toBe(1); // a code-like value in the reinvestment column is dropped and counted
    expect(a.feedDate).toBe("2026-10-07"); // not the single ETF row a day ahead
    expect(a.latestNavDate).toBe("2026-10-08");
    expect(a.historicalNav).toBe(2);
    expect(a.rows.find((r) => r.schemeCode === "990006")).toMatchObject({ nav: null }); // a zero NAV is no NAV
  });

  it("a byte-order mark and blank lines do not change the reading", () => {
    const a = analyseNavAll("﻿" + feed8(["990001;INF9I0A01AA1;;Iota Flexi Cap Fund;Direct Plan;Growth;1;07-Oct-2026"]) + "\r\n\r\n");
    expect(a.layout).toBe("current8");
    expect(a.rows).toHaveLength(1);
  });
});

const m = (code: string, v: Partial<AmfiMatch> = {}): AmfiMatch => ({ code, column: "payout_growth", amc: "Iota Mutual Fund", name: "Iota Flexi Cap Fund - Regular Plan - Growth", plan: "Regular Plan", option: "Growth", currentNav: true, ...v });

describe("explicit plan / option words", () => {
  it("reads Direct / Regular, Growth / IDCW and payout / reinvestment; words in the scheme's own name say nothing", () => {
    expect(markersOf("Iota Flexi Cap Fund - Direct Growth")).toEqual({ plan: "direct", option: "growth", idcw: null });
    expect(markersOf("Iota Flexi Cap Fund Regular IDCW Payout")).toEqual({ plan: "regular", option: "idcw", idcw: "payout" });
    expect(markersOf("Iota Flexi Cap Fund - Reinvestment of Income Distribution cum Capital Withdrawal")).toMatchObject({ option: "idcw", idcw: "reinvest" });
    // "Regular Savings", "Growth Opportunities", "Dividend Yield" are names, not plans or options.
    expect(markersOf("Iota Regular Savings Fund - Direct Growth", "Iota Regular Savings Fund")).toEqual({ plan: "direct", option: "growth", idcw: null });
    expect(markersOf("Iota Growth Opportunities Fund - IDCW", "Iota Growth Opportunities Fund")).toMatchObject({ option: "idcw" });
    expect(markersOf("Iota Dividend Yield Fund - Growth", "Iota Dividend Yield Fund")).toMatchObject({ option: "growth" });
    // Two contradicting words state nothing.
    expect(markersOf("Iota Fund Growth IDCW")).toMatchObject({ option: null });
  });
  it("AMFI's explicit columns win over its name; the ISIN column decides payout vs reinvestment", () => {
    expect(amfiMarkers({ name: "Iota Flexi Cap Fund - Growth", plan: "Direct Plan", option: "Growth" })).toMatchObject({ plan: "direct", option: "growth" });
    expect(amfiMarkers({ name: "Iota Flexi Cap Fund - Regular Plan - IDCW", plan: null, option: null, column: "reinvest" })).toMatchObject({ option: "idcw", idcw: "reinvest" });
    expect(amfiMarkers({ name: "Iota Flexi Cap Fund", plan: "Regular Plan", option: "IDCW", column: "payout_growth" })).toMatchObject({ idcw: "payout" });
    expect(markerContradiction({ plan: "direct", option: null, idcw: null }, { plan: "regular", option: null, idcw: null })).toMatch(/direct, AMFI says regular/);
    expect(markerContradiction({ plan: null, option: null, idcw: null }, { plan: "regular", option: "growth", idcw: null })).toBeNull();
  });
  it("AMC names compare without the words AMFI adds or drops (a rename keeps the key only when the words do)", () => {
    expect(amcKey("Iota Mutual Fund")).toBe(amcKey("IOTA Asset Management Company Limited"));
    expect(amcKey("Iota Mutual Fund")).not.toBe(amcKey("Kappa Mutual Fund"));
  });
  it("name rank orders candidates only — the same core name at two AMCs ranks the same", () => {
    expect(nameRank("Iota Flexi Cap Fund - Regular Growth", "Iota Flexi Cap Fund - Regular Plan - Growth")).toBe(1);
    expect(nameRank("Kappa Flexi Cap Fund", "Iota Flexi Cap Fund")).toBeGreaterThan(0);
  });
});

describe("decideScheme — Phase 3I", () => {
  const base = { observedIsins: ["INF9I0A01BB2"], confirmed: null };
  it("one ISIN on one AMFI scheme, consistent with the registrar AMC and words: verified (inactive is labelled, still verified)", () => {
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002")] }, observedText: "Iota Flexi Cap Fund - Regular Growth", registrarAmc: ["Iota Mutual Fund"] }))
      .toMatchObject({ status: "resolved_isin", amfiSchemeCode: "9I0002", reasonCode: "isin_verified", evidenceIsin: "INF9I0A01BB2", isinColumn: "payout_growth" });
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002", { currentNav: false })] } })).toMatchObject({ status: "resolved_isin", reasonCode: "isin_verified_historical" });
  });
  it("an ISIN found in the reinvestment column is a reinvestment scheme", () => {
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0003", { column: "reinvest", option: "IDCW" })] }, observedText: "Iota Flexi Cap Fund - Regular IDCW Payout" }))
      .toMatchObject({ status: "conflict", reasonCode: "plan_option_mismatch", reason: expect.stringMatching(/payout.*reinvest/) });
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0003", { column: "reinvest", option: "IDCW" })] }, observedText: "Iota Flexi Cap Fund - Regular IDCW Reinvestment" }))
      .toMatchObject({ status: "resolved_isin", isinColumn: "reinvest" });
  });
  it("Direct vs Regular and Growth vs IDCW contradictions are quarantined", () => {
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002")] }, observedText: "Iota Flexi Cap Fund - Direct Growth" }).reasonCode).toBe("plan_option_mismatch");
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002")] }, observedText: "Iota Flexi Cap Fund - Regular IDCW" }).reasonCode).toBe("plan_option_mismatch");
  });
  it("an ISIN on two AMFI schemes, two ISINs on one code, an AMC the registrar's other codes contradict: never decided", () => {
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002"), m("9I0012")] } }).reasonCode).toBe("isin_ambiguous");
    expect(decideScheme({ observedIsins: ["INF9I0A01BB2", "INF9I0A01AA1"], amfiByIsin: {}, confirmed: null }).reasonCode).toBe("isins_differ");
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0011", { amc: "Kappa Mutual Fund" })] }, registrarAmc: ["Iota Mutual Fund"] }).reasonCode).toBe("amc_mismatch");
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002")] }, registrarAmc: ["Iota Mutual Fund", "Kappa Mutual Fund"] }).reasonCode).toBe("amc_mismatch");
    // A rename of the AMC's legal words is the same AMC.
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002")] }, registrarAmc: ["IOTA Asset Management Company Limited"] }).status).toBe("resolved_isin");
  });
  it("missing reference: no ISIN, an ISIN the feed does not carry, an ISIN AMFI lists without a NAV", () => {
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: null }).reasonCode).toBe("no_isin");
    expect(decideScheme({ ...base, amfiByIsin: {} }).reasonCode).toBe("isin_not_in_feed");
    expect(decideScheme({ ...base, amfiByIsin: {}, unpricedIsins: ["INF9I0A01BB2"] }).reasonCode).toBe("isin_unpriced");
  });
  it("platform mappings: verified by ISIN elsewhere resolves a code printed without one; an approval settles an AMC question; a contradiction is a conflict", () => {
    const g = { amfiSchemeCode: "9I0002", basis: "isin" as const, evidenceIsin: "INF9I0A01BB2", amc: "Iota Mutual Fund" };
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: null, global: g })).toMatchObject({ status: "resolved_isin", reasonCode: "global_isin" });
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: null, global: g, registrarAmc: ["Kappa Mutual Fund"] }).reasonCode).toBe("amc_mismatch");
    expect(decideScheme({ observedIsins: ["INF9I0A01ZZ9"], amfiByIsin: {}, confirmed: null, global: g }).reasonCode).toBe("isins_differ");
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002")] }, global: { ...g, amfiSchemeCode: "9I0001" } }).reasonCode).toBe("global_conflict");
    const approved = { amfiSchemeCode: "9I0002", basis: "platform_approval" as const, evidenceIsin: null };
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: null, global: approved })).toMatchObject({ status: "confirmed", reasonCode: "platform_approved" });
    expect(decideScheme({ ...base, amfiByIsin: { INF9I0A01BB2: [m("9I0002", { amc: "Kappa Mutual Fund" })] }, registrarAmc: ["Iota Mutual Fund"], global: approved }).status).toBe("resolved_isin");
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: { amfiSchemeCode: "9I0001", existsInFeed: true }, global: approved }).reasonCode).toBe("confirm_contradicts_global");
  });
  it("a firm confirmation is checked like the evidence: feed, AMC, plan / option", () => {
    const c = (v: object) => ({ amfiSchemeCode: "9I0002", existsInFeed: true, amc: "Iota Mutual Fund", name: "Iota Flexi Cap Fund - Regular Plan - Growth", plan: "Regular Plan", option: "Growth", ...v });
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: c({}), observedText: "Iota Flexi Cap Fund - Regular Growth", registrarAmc: ["Iota Mutual Fund"] })).toMatchObject({ status: "confirmed", reasonCode: "firm_confirmed" });
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: c({ existsInFeed: false }) }).reasonCode).toBe("confirm_not_in_feed");
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: c({ amc: "Kappa Mutual Fund" }), registrarAmc: ["Iota Mutual Fund"] }).reasonCode).toBe("amc_mismatch");
    expect(decideScheme({ observedIsins: [], amfiByIsin: {}, confirmed: c({}), observedText: "Iota Flexi Cap Fund - Direct Growth" }).reasonCode).toBe("plan_option_mismatch");
  });
});
