/**
 * The pure halves of the proposal journey: what a line is worth, whether it
 * fits the client, whether the RTA feed shows it was invested, and the
 * conversion report built on those. Each one is a number an RM will check by
 * hand, so each is pinned here.
 */

import { describe, expect, it } from "vitest";
import { itemAmountText, itemKindLabel, proposalValue, recommendationType } from "@/lib/proposals/items";
import { matchLines, schemeMatches } from "@/lib/proposals/execution";
import { summariseConversion, type ConversionRow } from "@/lib/proposals/conversion";
import { equityAfter, lineFit } from "@/lib/proposals/fit";

const sip = (schemeName: string, monthlyAmount: number, extra: Record<string, any> = {}) => ({
  kind: "mf",
  recommendationType: "sip",
  schemeName,
  monthlyAmount,
  ...extra,
});
const lump = (schemeName: string, lumpsum: number, extra: Record<string, any> = {}) => ({
  kind: "mf",
  recommendationType: "lumpsum",
  schemeName,
  lumpsum,
  ...extra,
});

describe("line items", () => {
  it("values a proposal on the first-year basis: a year of SIPs plus one-time money", () => {
    expect(proposalValue([sip("A Flexi Cap", 10_000), lump("B Small Cap", 500_000)])).toBe(620_000);
  });

  it("leaves SWP and STP out of the value — they move money already invested", () => {
    const swp = { kind: "mf", recommendationType: "swp", schemeName: "C Hybrid", swpAmount: 15_000 };
    const stp = { kind: "mf", recommendationType: "stp", schemeName: "D Liquid", stpAmount: 50_000 };
    expect(proposalValue([swp, stp])).toBe(0);
  });

  it("reads an old line with no recommendation type from what it carries", () => {
    expect(recommendationType({ kind: "mf", monthlyAmount: 5000 })).toBe("sip");
    expect(recommendationType({ kind: "mf", lumpsum: 100000 })).toBe("lumpsum");
    expect(itemKindLabel({ kind: "mf", monthlyAmount: 5000 })).toBe("SIP");
  });

  it("describes a SIP with its step-up", () => {
    expect(itemAmountText(sip("A", 15_000, { stepUpPct: 10 }))).toContain("10% step-up");
  });
});

describe("scheme matching against the RTA feed", () => {
  it("tolerates the registrar's spelling", () => {
    expect(schemeMatches("Nippon India Small Cap Fund - Growth", "NIPPON INDIA SMALL CAP FUND-GROWTH PLAN")).toBe(true);
  });

  it("tolerates abbreviations", () => {
    expect(schemeMatches("ICICI Prudential Balanced Advantage Fund", "ICICI Pru Balanced Advantage Fund - Regular Growth")).toBe(true);
  });

  it("does not confuse two schemes of the same house", () => {
    expect(schemeMatches("Nippon India Small Cap Fund", "Nippon India Large Cap Fund")).toBe(false);
    expect(schemeMatches("SBI Equity Hybrid Fund", "SBI Equity Savings Fund")).toBe(false);
  });

  it("refuses a name too short to identify anything", () => {
    expect(schemeMatches("Growth", "Nippon India Small Cap Fund - Growth")).toBe(false);
    expect(schemeMatches(null, "Nippon India Small Cap Fund")).toBe(false);
  });
});

describe("matchLines", () => {
  const products = [
    sip("Parag Parikh Flexi Cap Fund", 15_000),
    lump("Nippon India Small Cap Fund", 500_000),
    { kind: "mf", recommendationType: "stp", schemeName: "HDFC Liquid Fund", stpAmount: 50_000 },
  ];
  const txns = [
    { id: "t1", scheme_name: "PARAG PARIKH FLEXI CAP FUND - REGULAR GROWTH", amount: 15_000, order_date: "2026-10-05" },
    { id: "t2", scheme_name: "PARAG PARIKH FLEXI CAP FUND - REGULAR GROWTH", amount: 15_000, order_date: "2026-11-05" },
    { id: "t3", scheme_name: "NIPPON INDIA SMALL CAP FUND-GROWTH PLAN", amount: 500_000, order_date: "2026-10-02" },
  ];

  it("counts only the lines the client accepted", () => {
    const lines = matchLines(products, [0], txns);
    expect(lines.map((l) => l.index)).toEqual([0]);
    expect(lines[0].invested).toBe(30_000);
    expect(lines[0].proposed).toBe(180_000);
  });

  it("treats a fully accepted proposal (no accepted_items) as every line, but never an STP", () => {
    const lines = matchLines(products, null, txns);
    expect(lines.map((l) => l.index)).toEqual([0, 1]);
    expect(lines[1].invested).toBe(500_000);
  });

  it("never counts one purchase toward two lines", () => {
    const dup = [lump("Nippon India Small Cap Fund", 250_000), lump("Nippon India Small Cap Fund", 250_000)];
    const lines = matchLines(dup, null, [txns[2]]);
    expect(lines[0].transactionIds).toEqual(["t3"]);
    expect(lines[1].transactionIds).toEqual([]);
  });
});

describe("fit", () => {
  it("checks the riskometer level against the profile, mapping the in-between levels down", () => {
    expect(lineFit(lump("X", 1, { riskRating: "very_high" }), "moderate").status).toBe("above");
    expect(lineFit(lump("X", 1, { riskRating: "low_to_moderate" }), "moderate").status).toBe("fits");
  });

  it("says what is missing instead of guessing", () => {
    expect(lineFit(lump("X", 1, { riskRating: "high" }), null).status).toBe("unknown");
    expect(lineFit(lump("X", 1), "moderate").status).toBe("unknown");
  });

  it("reports where the book stood BEFORE, so an already-over-band book is not blamed on the proposal", () => {
    const snap: any = {
      holdings: { aum: 1_000_000, sipBook: 0, equityPct: 70, equityValue: 700_000 },
      band: { floor: 20, ceiling: 60 },
    };
    const r = equityAfter([lump("HDFC Corporate Bond Fund", 1_000_000, { category: "Debt" })], snap);
    expect(r.before).toBe(70);
    expect(r.pct).toBeCloseTo(35, 5);
    expect(r.aboveBand).toBe(false);
  });

  it("is unknowable, not zero, when the book is not classified", () => {
    const snap: any = { holdings: { aum: 1_000_000, sipBook: 0, equityPct: null, equityValue: 0 }, band: { floor: 20, ceiling: 60 } };
    expect(equityAfter([lump("A Flexi Cap", 1)], snap).pct).toBeNull();
  });
});

describe("summariseConversion", () => {
  const row = (o: Partial<ConversionRow>): ConversionRow => ({
    id: Math.random().toString(36),
    status: "sent",
    prepared_by: "Priya",
    products: [sip("Parag Parikh Flexi Cap Fund", 10_000), lump("Nippon India Small Cap Fund", 100_000)],
    accepted_items: null,
    executed_amount: null,
    sent_at: "2026-09-01T00:00:00Z",
    accepted_at: null,
    executed_at: null,
    ...o,
  });

  it("ignores drafts and values partial acceptance by the lines taken", () => {
    const c = summariseConversion([
      row({ sent_at: null, status: "draft" }),
      row({ status: "partially_approved", accepted_items: [0], accepted_at: "2026-09-03T00:00:00Z" }),
      row({}),
    ]);
    expect(c.total.sent).toBe(2);
    expect(c.total.accepted).toBe(1);
    expect(c.total.proposedValue).toBe(2 * 220_000);
    expect(c.total.acceptedValue).toBe(120_000);
    expect(c.daysToAccept).toBe(2);
  });

  it("credits a scheme only where the client took that line", () => {
    const c = summariseConversion([row({ status: "partially_approved", accepted_items: [0], accepted_at: "2026-09-02T00:00:00Z" })]);
    const small = c.bySchemes.find((s) => s.scheme.startsWith("Nippon"))!;
    expect(small).toMatchObject({ proposed: 1, accepted: 0 });
  });

  it("counts invested money from the RTA match, not the status alone", () => {
    const c = summariseConversion([
      row({ status: "executed", accepted_at: "2026-09-02T00:00:00Z", executed_at: "2026-09-12T00:00:00Z", executed_amount: "90000" }),
    ]);
    expect(c.total.executed).toBe(1);
    expect(c.total.executedValue).toBe(90_000);
    expect(c.daysToExecute).toBe(10);
  });
});
