/**
 * Booked business vs the RTA (lib/business/rta-match-core.ts): which RTA
 * record settles a booked line, and what the line's outcome is.
 */

import { describe, expect, it } from "vitest";
import {
  amountAgrees, settleLines, type MatchBounce, type MatchLine, type MatchSettings, type MatchTxn,
} from "@/lib/business/rta-match-core";

const CLIENT = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const line = (over: Partial<MatchLine> = {}): MatchLine => ({
  id: "line-1",
  investorId: CLIENT,
  productType: "mutual_fund",
  businessDate: "2026-09-01",
  txnType: "lumpsum",
  schemeName: "Nippon India Small Cap Fund - Growth",
  fromSchemeName: null,
  folioNo: null,
  amount: 100_000,
  ...over,
});

const txn = (over: Partial<MatchTxn> = {}): MatchTxn => ({
  id: "txn-1",
  investorId: CLIENT,
  type: "purchase",
  status: "processed",
  orderDate: "2026-09-02",
  // ₹1,00,000 less 0.005% stamp duty, as the registrar reports it.
  amount: 99_995,
  schemeName: "NIPPON INDIA SMALL CAP FUND-GROWTH PLAN",
  folioNumber: "4012345678",
  reason: null,
  ...over,
});

const settings = (over: Partial<MatchSettings> = {}): MatchSettings => ({
  today: "2026-09-05",
  ledgerLast: "2026-09-04",
  notFoundDays: 7,
  sipNotFoundDays: 45,
  ...over,
});

const one = (l: MatchLine, txns: MatchTxn[], s = settings(), bounces: MatchBounce[] = []) => settleLines([l], txns, bounces, s)[0];

describe("settling a booked line against the RTA", () => {
  it("confirms a purchase the RTA processed, net of stamp duty, on the RTA's trade date", () => {
    const o = one(line(), [txn()]);
    expect(o).toMatchObject({ status: "confirmed", statusAt: "2026-09-02", rtaAmount: 99_995, txnIds: ["txn-1"] });
  });

  it("flags a processed record with a different amount as a mismatch", () => {
    const o = one(line(), [txn({ amount: 95_000 })]);
    expect(o.status).toBe("mismatch");
    expect(o.note).toContain("95,000");
    expect(o.txnIds).toEqual(["txn-1"]);
  });

  it("prefers a successful retry over the failed first attempt", () => {
    const o = one(line(), [
      txn({ id: "failed", status: "rejected", orderDate: "2026-09-01", reason: "Payment failed" }),
      txn({ id: "retry", orderDate: "2026-09-03" }),
    ]);
    expect(o).toMatchObject({ status: "confirmed", txnIds: ["retry"] });
  });

  it("marks a line rejected, with the reason and the rejection date, when that is all the RTA has", () => {
    const o = one(line(), [txn({ status: "rejected", orderDate: "2026-09-03", reason: "Insufficient funds" })]);
    expect(o).toMatchObject({ status: "rejected", statusAt: "2026-09-03" });
    expect(o.note).toContain("Insufficient funds");
  });

  it("keeps a line pending while the RTA still has it in flight", () => {
    const o = one(line(), [txn({ status: "pending" })]);
    expect(o).toMatchObject({ status: "pending", statusAt: null, txnIds: ["txn-1"] });
  });

  it("calls a line not found only once the wait is over AND the ledger reaches past it", () => {
    // Wait over, ledger reaches 2026-09-09 → not found, dated the day the wait ran out.
    expect(one(line(), [], settings({ today: "2026-09-15", ledgerLast: "2026-09-12" })))
      .toMatchObject({ status: "not_found", statusAt: "2026-09-08" });
    // Wait over but the ledger stops short → no data, so still pending.
    expect(one(line(), [], settings({ today: "2026-09-15", ledgerLast: "2026-09-05" })).status).toBe("pending");
    // No ledger at all → pending.
    expect(one(line(), [], settings({ today: "2026-09-15", ledgerLast: null })).status).toBe("pending");
  });

  it("gives a SIP the longer wait", () => {
    const sip = line({ txnType: "sip", amount: 5_000 });
    expect(one(sip, [], settings({ today: "2026-09-20", ledgerLast: "2026-09-19" })).status).toBe("pending");
    expect(one(sip, [], settings({ today: "2026-10-20", ledgerLast: "2026-10-19" })))
      .toMatchObject({ status: "not_found", statusAt: "2026-10-16" });
  });

  it("does not check products or lines the RTA never reports", () => {
    expect(one(line({ productType: "pms" }), [txn()]).status).toBe("not_applicable");
    expect(one(line({ txnType: "sip_topup" }), [txn({ type: "sip" })]).status).toBe("not_applicable");
  });

  it("cannot match a line with no client, and says why", () => {
    const o = one(line({ investorId: null }), [txn()]);
    expect(o.status).toBe("pending");
    expect(o.note).toContain("No client");
  });

  it("ignores another client, another scheme, another folio, the wrong type and records out of the window", () => {
    expect(one(line(), [txn({ investorId: OTHER })]).status).toBe("pending");
    expect(one(line(), [txn({ schemeName: "HDFC Flexi Cap Fund - Growth" })]).status).toBe("pending");
    expect(one(line({ folioNo: "4099999999" }), [txn()]).status).toBe("pending");
    expect(one(line(), [txn({ type: "redemption" })]).status).toBe("pending");
    expect(one(line(), [txn({ orderDate: "2026-08-20" })]).status).toBe("pending");
  });

  it("lets one RTA record settle only one booking — the older one", () => {
    const out = settleLines(
      [line({ id: "later", businessDate: "2026-09-02" }), line({ id: "earlier", businessDate: "2026-09-01" })],
      [txn({ orderDate: "2026-09-02" })],
      [],
      settings(),
    );
    const by = Object.fromEntries(out.map((o) => [o.lineId, o.status]));
    expect(by).toEqual({ earlier: "confirmed", later: "pending" });
  });

  it("never reuses a record already settling another line", () => {
    expect(one(line(), [txn()], settings({ taken: ["txn-1"] })).status).toBe("pending");
  });

  it("confirms a SIP by its first instalment", () => {
    const o = one(line({ txnType: "sip", amount: 5_000 }), [txn({ type: "sip", amount: 5_000, orderDate: "2026-09-10" })]);
    expect(o).toMatchObject({ status: "confirmed", statusAt: "2026-09-10" });
  });

  it("rejects a SIP whose first debit bounced for the same amount, and only then", () => {
    const sip = line({ txnType: "sip", amount: 5_000 });
    const bounce: MatchBounce = {
      investorId: CLIENT, schemeName: "NIPPON INDIA SMALL CAP FUND", folioNumber: null,
      rejectionDate: "2026-09-10", amount: 5_000, reason: "Insufficient balance",
    };
    expect(one(sip, [], settings(), [bounce])).toMatchObject({ status: "rejected", statusAt: "2026-09-10" });
    // A bounce of an older, bigger SIP in the same scheme is not this one.
    expect(one(sip, [], settings(), [{ ...bounce, amount: 20_000 }]).status).toBe("pending");
  });

  it("matches a switch by its source scheme as well as its target", () => {
    const sw = line({ txnType: "switch", schemeName: "HDFC Liquid Fund", fromSchemeName: "Nippon India Small Cap Fund" });
    expect(one(sw, [txn({ type: "switch" })]).status).toBe("confirmed");
  });
});

describe("amountAgrees", () => {
  it("allows stamp duty and rounding on a purchase, and exit load on a redemption", () => {
    expect(amountAgrees(100_000, 99_995, "lumpsum")).toBe(true);
    expect(amountAgrees(100_000, 98_500, "lumpsum")).toBe(false);
    expect(amountAgrees(100_000, 98_500, "redemption")).toBe(true);
    expect(amountAgrees(500, 495, "lumpsum")).toBe(true); // the ₹10 floor
  });

  it("agrees when there is nothing to compare", () => {
    expect(amountAgrees(0, 12_345, "redemption")).toBe(true); // keyed in units
    expect(amountAgrees(10_000, null, "lumpsum")).toBe(true); // feed row without an amount
  });
});
