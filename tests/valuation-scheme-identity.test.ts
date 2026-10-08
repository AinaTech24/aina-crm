import { describe, expect, it } from "vitest";
import { codeLikeName, computeInvestorValuation, type ValuationSnapshot, type ValuationTransaction } from "@/lib/finance/valuation";

const NOW = new Date("2026-10-07T00:00:00Z");
const folio = { investor_id: "i1", folio_id: "f1", folio_number: "2396642/05", amc_code: "D", amc_name: "DSP Mutual Fund" };

const buy = (code: string, name: string, units: number, amount: number, date: string, nav: number | null = null): ValuationTransaction => ({
  ...folio, scheme_code: code, scheme_name: name, direction: "inflow", type: "sip", amount, units, order_date: date,
  latest_nav: nav, latest_nav_date: nav ? "2026-10-06" : null,
});
const leg = (code: string, name: string, units: number, nav: number, latest: number | null = null): ValuationSnapshot => ({
  ...folio, scheme: { schemeCode: code, schemeName: name, units, nav }, latest_nav: latest, latest_nav_date: latest ? "2026-10-06" : null,
});

describe("scheme names", () => {
  it("treats 2-letter feed codes and blanks as codes, not names", () => {
    expect(codeLikeName("EQ", "101EQGP")).toBe(true);
    expect(codeLikeName("", "D157")).toBe(true);
    expect(codeLikeName("DSP Small Cap Fund - Regular Plan - Growth", "D157")).toBe(false);
  });

  it("shows the holdings file's name over the feed's code", () => {
    const v = computeInvestorValuation(
      [buy("101EQGP", "EQ", 100, 10000, "2020-01-01")],
      [leg("101EQGP", "Canara Robeco Large and Mid Cap Fund-Regular Growth", 100, 242.67)],
      NOW,
    );
    expect(v.holdings).toHaveLength(1);
    expect(v.holdings[0].schemeName).toBe("Canara Robeco Large and Mid Cap Fund-Regular Growth");
  });

  it("prices a ledger the NAV master does not know from the statement's NAV", () => {
    const v = computeInvestorValuation(
      [buy("101EQGP", "EQ", 100, 10000, "2020-01-01")],
      [leg("101EQGP", "Canara Robeco Large and Mid Cap Fund-Regular Growth", 100, 242.67)],
      NOW,
    );
    expect(v.holdings[0].priced).toBe(true);
    expect(v.holdings[0].currentValue).toBeCloseTo(24267, 0);
    expect(v.unpricedSchemes).toBe(0);
  });
});

describe("one holding under two codes in one folio", () => {
  it("is one row, valued once", () => {
    const v = computeInvestorValuation(
      [buy("D157", "DSP Small Cap Fund - Regular Plan - Growth", 22659.789, 1_000_000, "2010-09-21")],
      [
        leg("D157", "", 22659.789, 224.899),
        leg("105989", "DSP Small Cap Fund - Regular Plan - Growth", 22659.789, 226.734, 226.734),
      ],
      NOW,
    );
    expect(v.holdings).toHaveLength(1);
    expect(v.holdings[0].schemeName).toBe("DSP Small Cap Fund - Regular Plan - Growth");
    // The NAV-master-priced statement wins; never the sum of both.
    expect(v.currentValue).toBeCloseTo(22659.789 * 226.734, 0);
  });

  it("still adds up ARN slices of the same code", () => {
    const v = computeInvestorValuation(
      [],
      [leg("105989", "DSP Small Cap Fund - Regular Plan - Growth", 100, 200, 200), leg("105989", "DSP Small Cap Fund - Regular Plan - Growth", 50, 200, 200)],
      NOW,
    );
    expect(v.holdings).toHaveLength(1);
    expect(v.currentValue).toBeCloseTo(30000, 0);
  });

  it("puts a folio-less opening balance into the folio that holds the scheme", () => {
    const recon: ValuationTransaction = {
      investor_id: "i1", folio_id: null, folio_number: null, amc_code: null, amc_name: null,
      scheme_code: "148786", scheme_name: "BANDHAN CRISIL IBX GILT JUNE 2027 INDEX FUND", direction: "inflow", type: "purchase",
      amount: 4_343_007, units: 315616.309, order_date: "2026-09-03", latest_nav: 13.7604, latest_nav_date: "2026-10-06",
    };
    const v = computeInvestorValuation(
      [recon],
      [leg("148786", "BANDHAN CRISIL IBX GILT JUNE 2027 INDEX FUND", 315616.309, 13.7604, 13.7604)],
      NOW,
    );
    expect(v.holdings).toHaveLength(1);
    expect(v.holdings[0].folioNumber).toBe("2396642/05");
    expect(v.currentValue).toBeCloseTo(315616.309 * 13.7604, 0);
  });

  it("matches a feed code and an AMFI code holding exactly the same units", () => {
    const v = computeInvestorValuation(
      [buy("189FXRG", "FX", 129523.293, 2_000_000, "2023-08-14")],
      [leg("151898", "Bajaj Finserv Flexi Cap Fund - Regular Plan - Growth", 129523.293, 15.104, 15.104)],
      NOW,
    );
    expect(v.holdings).toHaveLength(1);
    expect(v.holdings[0].schemeName).toBe("Bajaj Finserv Flexi Cap Fund - Regular Plan - Growth");
    expect(v.holdings[0].investedNet).toBeCloseTo(2_000_000, 0);
    expect(v.currentValue).toBeCloseTo(129523.293 * 15.104, 0);
  });

  it("keeps different schemes in one folio apart", () => {
    const v = computeInvestorValuation(
      [],
      [leg("D157", "DSP Small Cap Fund - Regular Plan - Growth", 100, 200), leg("D104", "DSP Mid Cap Fund - Regular Plan - Growth", 10, 100)],
      NOW,
    );
    expect(v.holdings).toHaveLength(2);
  });
});

describe("invested cost when the history is incomplete", () => {
  it("estimates the cost of units held when redemptions are missing", () => {
    // History: 200 units bought for 20,000 (avg 100). Statement: 150 held.
    const v = computeInvestorValuation(
      [buy("101EQGP", "EQ", 200, 20000, "2015-01-01")],
      [leg("101EQGP", "Canara Robeco Large and Mid Cap Fund-Regular Growth", 150, 242.67)],
      NOW,
    );
    const h = v.holdings[0];
    expect(h.investedNet).toBeNull();
    expect(h.investedEstimate).toBeCloseTo(15000, 0);
    expect(h.gain).toBeNull();
    expect(v.investedEstimate).toBeCloseTo(15000, 0);
  });

  it("never estimates when purchases are missing", () => {
    const v = computeInvestorValuation(
      [buy("127FMGP", "FM", 100, 10000, "2015-01-01")],
      [leg("127FMGP", "Motilal Oswal Midcap Fund-Regular Plan", 170, 99.47)],
      NOW,
    );
    expect(v.holdings[0].investedEstimate).toBeNull();
    expect(v.investedEstimate).toBeNull();
  });
});

describe("a statement that says 0 units", () => {
  it("closes a holding the history still shows open", () => {
    const v = computeInvestorValuation(
      [buy("G299", "Bandhan Balanced Advantage Fund-Regular Plan-Growth", 10000, 100000, "2014-10-10")],
      [leg("G299", "", 0, 24.767)],
      NOW,
    );
    expect(v.holdings[0].netUnits).toBe(0);
    expect(v.currentValue).toBe(0);
    expect(v.unpricedSchemes).toBe(0);
  });
});
