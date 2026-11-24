/**
 * A client with one holding whose purchases the RTA history never sent: the book-wide XIRR is unknown, but the
 * client page's XIRR card shows one over the holdings whose history IS complete (xirrPartial), marked "≈".
 */
import { describe, expect, it } from "vitest";
import { computeInvestorValuation, type ValuationSnapshot, type ValuationTransaction } from "@/lib/finance/valuation";

const NOW = new Date("2026-11-24T00:00:00Z");
const folio = { investor_id: "i1", folio_id: "f1", folio_number: "1001/01", amc_code: "X", amc_name: "X Mutual Fund" };
const buy = (code: string, name: string, units: number, amount: number, date: string, nav: number): ValuationTransaction => ({
  ...folio, scheme_code: code, scheme_name: name, direction: "inflow", type: "purchase", amount, units, order_date: date,
  latest_nav: nav, latest_nav_date: "2026-11-23",
});
const leg = (code: string, name: string, units: number, nav: number): ValuationSnapshot => ({
  ...folio, scheme: { schemeCode: code, schemeName: name, units, nav }, latest_nav: nav, latest_nav_date: "2026-11-23",
});

describe("xirrPartial", () => {
  it("is set when one holding has an unknown cost, and is the XIRR of the others", () => {
    const v = computeInvestorValuation(
      [
        buy("A1", "Alpha Flexi Cap Fund - Regular Plan - Growth", 100, 10000, "2022-01-01", 150),
        // 100 units bought, 500 held: the other 400 were bought before the history starts.
        buy("B1", "Beta Multi Cap Fund - Regular Plan - Growth", 100, 5000, "2024-01-24", 50),
      ],
      [leg("A1", "Alpha Flexi Cap Fund - Regular Plan - Growth", 100, 150), leg("B1", "Beta Multi Cap Fund - Regular Plan - Growth", 500, 50)],
      NOW,
    );
    expect(v.investedNet).toBeNull();
    expect(v.xirr).toBeNull();
    expect(v.xirrPartial).not.toBeNull();
    // 10,000 -> 15,000 over ~4.9 years is about 8.6% a year — Beta's 25,000 is not in it.
    expect(v.xirrPartial!).toBeGreaterThan(0.07);
    expect(v.xirrPartial!).toBeLessThan(0.1);
  });

  it("is null when the whole book's XIRR is known", () => {
    const v = computeInvestorValuation(
      [buy("A1", "Alpha Flexi Cap Fund - Regular Plan - Growth", 100, 10000, "2022-01-01", 150)],
      [leg("A1", "Alpha Flexi Cap Fund - Regular Plan - Growth", 100, 150)],
      NOW,
    );
    expect(v.xirr).not.toBeNull();
    expect(v.xirrPartial).toBeNull();
  });

  it("is null when no holding has a complete history", () => {
    const v = computeInvestorValuation([], [leg("B1", "Beta Multi Cap Fund - Regular Plan - Growth", 500, 50)], NOW);
    expect(v.xirr).toBeNull();
    expect(v.xirrPartial).toBeNull();
  });
});
