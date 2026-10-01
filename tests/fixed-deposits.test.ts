import { describe, expect, it } from "vitest";
import { computeMaturity, daysBetween, maturityDateFor, tenureBetween, tenureLabel } from "@/lib/fixed-deposits/terms";
import { maturityInflowAmount } from "@/lib/fixed-deposits/hooks";
import { FdBody } from "@/lib/fixed-deposits/schema";
import { skipReason, type Facts } from "@/lib/opportunities/journey";
import type { ClientOpportunity } from "@/db/schema";

describe("FD tenure and dates", () => {
  it("adds months, clamping to the month end", () => {
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
  });

  it("labels tenures plainly", () => {
    expect(tenureLabel(12, 0)).toBe("1 yr");
    expect(tenureLabel(15, 10)).toBe("1 yr 3 mo 10 days");
    expect(tenureLabel(0, 0)).toBe("—");
  });
});

describe("FD maturity maths", () => {
  it("compounds a cumulative bank FD quarterly", () => {
    // ₹1,00,000 at 7% for exactly one year, quarterly: 1e5 × 1.0175^4 = 107,185.90
    const f = computeMaturity({ principal: 100000, rate: 7, depositDate: "2026-04-01", maturityDate: "2027-04-01", payout: "cumulative", compounding: "quarterly" });
    expect(f?.maturityAmount).toBeCloseTo(107185.9, 1);
    expect(f?.periodicInterest).toBeNull();
  });

  it("compounds yearly when told to (corporate FDs)", () => {
    const f = computeMaturity({ principal: 100000, rate: 8, depositDate: "2026-04-01", maturityDate: "2028-03-31", payout: "cumulative", compounding: "yearly" });
    expect(f?.maturityAmount).toBeCloseTo(100000 * 1.08 ** 2, 0);
  });

  it("uses simple interest under 181 days", () => {
    const f = computeMaturity({ principal: 100000, rate: 6, depositDate: "2026-04-01", maturityDate: "2026-06-30", payout: "cumulative", compounding: "quarterly" });
    expect(f?.days).toBe(90);
    expect(f?.maturityAmount).toBeCloseTo(100000 * (1 + 0.06 * 90 / 365), 2);
  });

  it("pays out interest and returns the principal on a payout FD", () => {
    const f = computeMaturity({ principal: 500000, rate: 7.2, depositDate: "2026-04-01", maturityDate: "2029-04-01", payout: "quarterly", compounding: "quarterly" });
    expect(f?.maturityAmount).toBe(500000);
    expect(f?.periodicInterest).toBe(9000);
  });

  it("refuses nonsense input rather than printing a figure", () => {
    expect(computeMaturity({ principal: 0, rate: 7, depositDate: "2026-04-01", maturityDate: "2027-04-01", payout: "cumulative", compounding: "quarterly" })).toBeNull();
    expect(computeMaturity({ principal: 1000, rate: 7, depositDate: "2026-04-01", maturityDate: "2026-03-01", payout: "cumulative", compounding: "quarterly" })).toBeNull();
  });

  it("expects the maturity amount back from a cumulative FD and the principal from a payout one", () => {
    expect(maturityInflowAmount({ payout: "cumulative", maturityAmount: "107185.90", principal: "100000" })).toBe("107185.90");
    expect(maturityInflowAmount({ payout: "monthly", maturityAmount: "100000", principal: "100000" })).toBe("100000");
  });
});

describe("FD body", () => {
  const base = { investorId: "00000000-0000-4000-8000-000000000001", issuer: "HDFC Bank", depositDate: "2026-04-01", maturityDate: "2027-04-01", principal: 100000, interestRate: 7 };
  it("accepts a minimal receipt and defaults the rest", () => {
    const r = FdBody.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ payout: "cumulative", compounding: "quarterly", status: "active", holding: "single" });
  });
  it("rejects a maturity on or before the deposit date", () => {
    expect(FdBody.safeParse({ ...base, maturityDate: "2026-04-01" }).success).toBe(false);
  });
});

describe("FD opportunity journey", () => {
  const opp = { id: "o1", tenantId: "t", investorId: "i", product: "fd_bonds_ncd", pipeline: "general", status: "open", createdAt: new Date() } as ClientOpportunity;
  const facts = (fd: Facts["fixedDeposit"]): Facts => ({
    kycStatus: null, kycVerified: false, hasUcc: false, mandateStatus: null, mandateAmount: null, riskState: "not_profiled",
    riskSignedAt: null, proposal: null, policy: null, transaction: null, fixedDeposit: fd,
  });
  it("passes Executed once an FD is on record", () => {
    expect(skipReason("gen_executed", opp, facts(null))).toBeNull();
    expect(skipReason("gen_executed", opp, facts({ id: "f", status: "applied", issuer: "SBI" }))?.reason).toMatch(/SBI/);
  });
});
