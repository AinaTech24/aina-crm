/**
 * The rules the app copies from the CRM must give the CRM's answers. Expected
 * values are the web suite's (tests/fixed-deposits.test.ts) and its rules
 * (lib/leads/stages.ts LEAD_PIPELINE, lib/investors/client-types.ts).
 */

// The leads module's hooks reach the network client; these rules don't.
jest.mock("../../api/client", () => ({ api: {} }));
jest.mock("../offlineQueue", () => ({ queuedPost: jest.fn() }));

import { computeMaturity, maturityDateFor, tenureBetween, tenureLabel, daysBetween, firstPayoutDate } from "../../features/fixed-deposits/terms";
import { canonicalStage, groupByStage, stageDisplay, stageFilterValues, LEAD_STAGES } from "../../features/leads/api";
import { canNominate, singleHoldingOnly, majorityDate, ownPan, taxStatusOptions, defaultTaxStatus, clientTypeOptions } from "../../features/investors/client-types";

describe("FD terms (web tests/fixed-deposits.test.ts)", () => {
  it("adds a tenure to a date, clamping to the month end", () => {
    expect(maturityDateFor("2026-01-31", 1, 0)).toBe("2026-02-28");
    expect(maturityDateFor("2026-04-15", 12, 0)).toBe("2027-04-15");
    expect(maturityDateFor("2026-04-15", 0, 45)).toBe("2026-05-30");
    expect(maturityDateFor("2026-11-10", 15, 10)).toBe("2028-02-20");
  });
  it("reads a tenure back from two dates", () => {
    expect(tenureBetween("2026-04-15", "2027-04-15")).toEqual({ months: 12, days: 0 });
    expect(tenureBetween("2026-04-15", "2027-07-25")).toEqual({ months: 15, days: 10 });
    expect(tenureBetween("2026-04-15", "2026-04-15")).toEqual({ months: 0, days: 0 });
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(tenureLabel(15, 10)).toBe("1 yr 3 mo 10 days");
  });
  it("computes maturity the CRM's way", () => {
    expect(computeMaturity({ principal: 100000, rate: 7, depositDate: "2026-04-01", maturityDate: "2027-04-01", payout: "cumulative", compounding: "quarterly" })?.maturityAmount).toBeCloseTo(107185.9, 1);
    expect(computeMaturity({ principal: 100000, rate: 8, depositDate: "2026-04-01", maturityDate: "2028-03-31", payout: "cumulative", compounding: "yearly" })?.maturityAmount).toBeCloseTo(100000 * 1.08 ** 2, 0);
    const short = computeMaturity({ principal: 100000, rate: 6, depositDate: "2026-04-01", maturityDate: "2026-06-30", payout: "cumulative", compounding: "quarterly" });
    expect(short?.days).toBe(90);
    expect(short?.maturityAmount).toBeCloseTo(100000 * (1 + 0.06 * 90 / 365), 2);
    const payout = computeMaturity({ principal: 500000, rate: 7.2, depositDate: "2026-04-01", maturityDate: "2029-04-01", payout: "quarterly", compounding: "quarterly" });
    expect(payout?.maturityAmount).toBe(500000);
    expect(payout?.periodicInterest).toBe(9000);
    expect(computeMaturity({ principal: 0, rate: 7, depositDate: "2026-04-01", maturityDate: "2027-04-01", payout: "cumulative", compounding: "quarterly" })).toBeNull();
  });
  it("fills the interest payout date the CRM's way (terms.ts firstPayoutDate, 2026-11-17)", () => {
    // A payout FD: one period after the deposit, clamped to the month end.
    expect(firstPayoutDate("2026-04-15", "2029-04-15", "monthly")).toBe("2026-05-15");
    expect(firstPayoutDate("2026-04-15", "2029-04-15", "quarterly")).toBe("2026-07-15");
    expect(firstPayoutDate("2026-08-31", "2029-08-31", "half_yearly")).toBe("2027-02-28");
    expect(firstPayoutDate("2026-04-15", "2029-04-15", "yearly")).toBe("2027-04-15");
    // Never after maturity.
    expect(firstPayoutDate("2026-04-15", "2026-06-10", "quarterly")).toBe("2026-06-10");
    // A cumulative FD pays with the principal, on the maturity date.
    expect(firstPayoutDate("2026-04-15", "2027-04-15", "cumulative")).toBe("2027-04-15");
    expect(firstPayoutDate("", "2027-04-15", "monthly")).toBe("");
  });
});

describe("Lead pipeline (web LEAD_PIPELINE)", () => {
  it("has the CRM's seven columns, Proposal Sent included", () => {
    expect(LEAD_STAGES.map((s) => s.label)).toEqual(["New", "Contacted", "Meeting Scheduled", "Meeting Done", "Proposal Sent", "Won", "Lost"]);
  });
  it("files the call loops under Contacted and says which loop", () => {
    expect(canonicalStage("call_back_later")).toBe("call_done");
    expect(stageDisplay("call_not_connected")).toBe("Contacted · Call not connected");
    expect(groupByStage([{ id: "1", stage: "proposal_sent" } as any]).find((c) => c.key === "proposal_sent")?.leads).toHaveLength(1);
  });
  it("filters a column by every stage it holds", () => {
    expect(stageFilterValues(["call_done"])).toEqual(expect.arrayContaining(["call_done", "call_back_later", "contact_in_future"]));
  });
});

describe("Client types (web lib/investors/client-types)", () => {
  it("lets only individuals nominate and hold jointly", () => {
    for (const t of ["individual", "nri", "sole_proprietor", "other"]) expect(canNominate(t)).toBe(true);
    for (const t of ["minor", "huf", "company", "llp", "partnership", "trust", "aop_boi", "corporate"]) {
      expect(canNominate(t)).toBe(false);
      expect(singleHoldingOnly(t)).toBe(true);
    }
  });
  it("offers the legacy Corporate type only to a record that has it", () => {
    expect(clientTypeOptions().some((o) => o.value === "corporate")).toBe(false);
    expect(clientTypeOptions("corporate").some((o) => o.value === "corporate")).toBe(true);
  });
  it("knows a minor's 18th birthday, leap days included", () => {
    expect(majorityDate("2010-05-04")).toBe("2028-05-04");
    expect(majorityDate("2008-02-29")).toBe("2026-03-01");
    expect(majorityDate(null)).toBeNull();
  });
  it("never reads a registrar key as a PAN", () => {
    expect(ownPan("ABCDE1234F")).toBe("ABCDE1234F");
    expect(ownPan("MINOR:ABCDE1234F")).toBe("ABCDE1234F");
    expect(ownPan("MINOR:ABCDE1234F:RAHUL")).toBe("");
    expect(ownPan("NOPAN:XYZ")).toBe("");
  });
  it("defaults the tax status by type", () => {
    expect(defaultTaxStatus("huf")).toBe("HUF");
    expect(taxStatusOptions("minor")).toContain("On behalf of minor");
    expect(taxStatusOptions("other").length).toBeGreaterThan(10);
  });
});
