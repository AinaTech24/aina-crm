import { describe, expect, it } from "vitest";
import { sipNextDue, type SipDueInput } from "@/lib/sips/next-due";

const TODAY = "2026-09-28";
const sip = (over: Partial<SipDueInput>): SipDueInput => ({
  status: "active",
  frequency: "monthly",
  sipDate: null,
  startDate: null,
  endDate: null,
  nextInstallmentAt: null,
  ...over,
});

describe("sipNextDue — an active SIP is never due in the past", () => {
  it("rolls a stale stored date to the next occurrence of its day", () => {
    // The two dates from the SIP Book report: 4 Jul and 27 Jun 2026.
    expect(sipNextDue(sip({ nextInstallmentAt: "2026-07-04" }), TODAY).date).toBe("2026-10-04");
    expect(sipNextDue(sip({ nextInstallmentAt: "2026-06-27" }), TODAY).date).toBe("2026-10-27");
  });

  it("uses the SIP day when one is recorded", () => {
    expect(sipNextDue(sip({ sipDate: "5", nextInstallmentAt: "2026-06-05" }), TODAY).date).toBe("2026-10-05");
    expect(sipNextDue(sip({ sipDate: "28" }), TODAY).date).toBe("2026-09-28"); // today counts
  });

  it("puts a 31st on the last day of a shorter month", () => {
    expect(sipNextDue(sip({ sipDate: "31", startDate: "2026-01-31" }), TODAY).date).toBe("2026-09-30");
  });

  it("keeps a stored date that is still ahead (the RTA knows about skips)", () => {
    expect(sipNextDue(sip({ sipDate: "5", nextInstallmentAt: "2026-11-05" }), TODAY).date).toBe("2026-11-05");
  });

  it("keeps the quarterly and yearly cycle", () => {
    expect(sipNextDue(sip({ frequency: "quarterly", nextInstallmentAt: "2026-03-10" }), TODAY).date).toBe("2026-12-10");
    expect(sipNextDue(sip({ frequency: "yearly", startDate: "2025-11-15" }), TODAY).date).toBe("2026-11-15");
  });

  it("steps weekly and fortnightly SIPs from their last known date", () => {
    expect(sipNextDue(sip({ frequency: "weekly", nextInstallmentAt: "2026-09-01" }), TODAY).date).toBe("2026-09-29");
    expect(sipNextDue(sip({ frequency: "fortnightly", nextInstallmentAt: "2026-09-01" }), TODAY).date).toBe("2026-09-29");
  });

  it("is never before the start date", () => {
    expect(sipNextDue(sip({ sipDate: "7", startDate: "2026-11-01" }), TODAY).date).toBe("2026-11-07");
  });

  it("has no next debit once past the end date", () => {
    expect(sipNextDue(sip({ sipDate: "5", endDate: "2026-09-10" }), TODAY)).toEqual({ date: null, ended: true });
  });

  it("returns unknown, not a guess, with nothing to go on", () => {
    expect(sipNextDue(sip({}), TODAY)).toEqual({ date: null, ended: false });
  });

  it("leaves a stopped SIP's date as recorded", () => {
    expect(sipNextDue(sip({ status: "stopped", nextInstallmentAt: "2026-07-04" }), TODAY).date).toBe("2026-07-04");
  });
});
