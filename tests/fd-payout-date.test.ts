/**
 * Fixed deposits — the interest payout date.
 */
import { describe, expect, it } from "vitest";
import { firstPayoutDate } from "@/lib/fixed-deposits/terms";
import { FdBody, FdPatchBody } from "@/lib/fixed-deposits/schema";

const base = {
  investorId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", issuer: "HDFC Bank", depositDate: "2026-11-17", maturityDate: "2027-11-17",
  principal: 500000, interestRate: 7.25,
};

describe("firstPayoutDate", () => {
  it("is one period after the deposit for a payout FD", () => {
    expect(firstPayoutDate("2026-11-17", "2027-11-17", "monthly")).toBe("2026-12-17");
    expect(firstPayoutDate("2026-11-17", "2027-11-17", "quarterly")).toBe("2027-02-17");
    expect(firstPayoutDate("2026-11-17", "2027-11-17", "half_yearly")).toBe("2027-05-17");
    expect(firstPayoutDate("2026-11-17", "2027-11-17", "yearly")).toBe("2027-11-17");
  });
  it("clamps to month end and never passes maturity", () => {
    expect(firstPayoutDate("2026-01-31", "2027-01-31", "monthly")).toBe("2026-02-28");
    expect(firstPayoutDate("2026-11-17", "2027-01-10", "quarterly")).toBe("2027-01-10");
  });
  it("is the maturity date for a cumulative FD", () => {
    expect(firstPayoutDate("2026-11-17", "2027-11-17", "cumulative")).toBe("2027-11-17");
  });
});

describe("the payout date in the API body", () => {
  it("is optional, and accepted between deposit and maturity", () => {
    expect(FdBody.safeParse(base).success).toBe(true);
    expect(FdBody.safeParse({ ...base, interestPayoutDate: "2027-02-17" }).success).toBe(true);
    expect(FdBody.safeParse({ ...base, interestPayoutDate: null }).success).toBe(true);
  });
  it("is refused outside the deposit's life", () => {
    expect(FdBody.safeParse({ ...base, interestPayoutDate: "2026-11-01" }).success).toBe(false);
    expect(FdBody.safeParse({ ...base, interestPayoutDate: "2028-01-01" }).success).toBe(false);
  });
  it("can be changed on an edit", () => {
    expect(FdPatchBody.safeParse({ interestPayoutDate: "2027-02-17" }).success).toBe(true);
    expect(FdPatchBody.safeParse({ interestPayoutDate: "17-02-2027" }).success).toBe(false);
  });
});
