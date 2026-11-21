/**
 * The FD form's interest payout date (the CRM's FdForm, 2026-11-17): it
 * follows the deposit, maturity and payout choice until a date is picked by
 * hand, must fall between deposit and maturity, and travels in the body.
 */

import { fixedDepositForm as form } from "../../forms/fixed-deposits";

const start = (p: Record<string, string> = {}) =>
  (form.initial as (p: Record<string, string>) => Record<string, any>)({ depositDate: "2026-04-15", ...p });
const change = (v: Record<string, any>, k: string, val: any) => {
  const next = { ...v, [k]: val };
  return { ...next, ...(form.derive!(next) ?? {}) };
};

describe("FD form — interest payout date", () => {
  it("starts on the maturity date of a cumulative FD", () => {
    const v = start();
    expect(v.maturityDate).toBe("2027-04-15");
    expect(v.interestPayoutDate).toBe("2027-04-15");
  });

  it("follows a payout choice and a new deposit date until picked by hand", () => {
    let v = change(start(), "payout", "quarterly");
    expect(v.interestPayoutDate).toBe("2026-07-15");
    v = change(v, "depositDate", "2026-05-31");
    expect(v.maturityDate).toBe("2027-05-31");
    expect(v.interestPayoutDate).toBe("2026-08-31");
    v = change(v, "interestPayoutDate", "2026-09-01");
    v = change(v, "payout", "monthly");
    expect(v.interestPayoutDate).toBe("2026-09-01");
  });

  it("refuses a payout date outside the deposit's term", () => {
    const v = { ...start(), investorId: "x", issuer: "HDFC Bank", principal: "100000", interestRate: "7", interestPayoutDate: "2028-01-01" };
    expect(form.validate!(v)?.interestPayoutDate).toBeTruthy();
  });

  it("sends it, and no receipt amount for a payout FD", () => {
    let v: Record<string, any> = { ...start(), investorId: "x", issuer: "HDFC Bank", principal: "100000", interestRate: "7", maturityAmount: "120000" };
    v = change(v, "payout", "monthly");
    const body = form.buildBody(v, {});
    expect(body.interestPayoutDate).toBe("2026-05-15");
    expect(body.maturityAmount).toBeNull();
    expect(body.status).toBe("active");
  });

  it("keeps a saved payout date on edit", () => {
    const v = { ...start(), ...form.editInitial!({ investorId: "x", depositDate: "2026-04-15", maturityDate: "2027-04-15", payout: "quarterly", interestPayoutDate: "2026-08-01" }, {}) };
    const d = form.derive!(v);
    expect(d?.interestPayoutDate).toBeUndefined();
  });
});
