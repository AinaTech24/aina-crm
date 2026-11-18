/**
 * The pure rules behind AUM-priced billing: grace and late payment (rule A),
 * what a checkout buys, the tax invoice's arithmetic (rule E), GST identity
 * checks, and the "Get pricing" request.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING, monthlyBasePaise, quoteCycle } from "@/lib/billing/aum-pricing";
import { aumLicenseView, istDate, renewalPeriod, renewalState } from "@/lib/billing/renewal";
import { CheckoutError, planCheckout } from "@/lib/billing/checkout";
import { amountInWords, financialYear, indianWords, invoiceFigures, invoiceNumber, splitGst } from "@/lib/billing/invoice-core";
import { checkGstin, gstState, isValidPan } from "@/lib/legal/gst";
import { normaliseArn, normaliseMobile, parseQuoteRequest } from "@/lib/billing/quote-request";

const R = (rupees: number) => Math.round(rupees * 100);
// Due 10 Nov 2026, 10:00 IST.
const DUE = new Date("2026-11-10T04:30:00Z");
const day = (n: number, hourIst = 12) => new Date(Date.UTC(2026, 10, 10 + n, hourIst - 6, 30)); // hourIst:00 IST

describe("grace period (rule A)", () => {
  it("day 0 and day 7 are grace with full access; day 8 is lapsed", () => {
    expect(renewalState(DUE, day(0), 7)).toMatchObject({ phase: "grace", daysOverdue: 0, daysLeft: 7 });
    expect(renewalState(DUE, day(7, 23), 7)).toMatchObject({ phase: "grace", daysOverdue: 7, daysLeft: 0 });
    expect(renewalState(DUE, day(8, 0), 7)).toMatchObject({ phase: "lapsed", daysOverdue: 8 });
    expect(renewalState(DUE, new Date("2026-11-09T04:30:00Z"), 7).phase).toBe("current");
    expect(renewalState(DUE, day(0), 7).graceEndsOn).toBe("2026-11-17");
  });

  it("counts India calendar days (a due time late in the evening IST)", () => {
    const due = new Date("2026-11-10T17:00:00Z"); // 22:30 IST on the 10th
    expect(renewalState(due, new Date("2026-11-10T19:00:00Z"), 7).daysOverdue).toBe(1); // 00:30 IST on the 11th
    expect(istDate(new Date("2026-11-10T19:00:00Z"))).toBe("2026-11-11");
  });

  it("banner state and the gate: grace is open, lapsed is restricted", () => {
    const g = aumLicenseView({ status: "active", licenseEndAt: DUE }, day(3), 7);
    expect(g).toMatchObject({ status: "past_due", isRestricted: false });
    expect(g.renewal?.daysLeft).toBe(4);
    expect(aumLicenseView({ status: "active", licenseEndAt: DUE }, day(8), 7)).toMatchObject({ status: "expired", isRestricted: true });
    expect(aumLicenseView({ status: "active", licenseEndAt: DUE }, new Date("2026-11-01T00:00:00Z"), 7)).toMatchObject({ status: "active", isRestricted: false });
    expect(aumLicenseView({ status: "pending", licenseEndAt: null }, day(0), 7)).toMatchObject({ status: "pending", isRestricted: true });
    // An admin's suspension is not overridden by the dates.
    expect(aumLicenseView({ status: "suspended", licenseEndAt: new Date("2030-01-01") }, day(0), 7).isRestricted).toBe(true);
  });

  it("paid in grace: the new cycle runs from the ORIGINAL date; paid late: from the payment date", () => {
    const inGrace = renewalPeriod(DUE, day(5), 1, 7);
    expect(inGrace.late).toBe(false);
    expect(inGrace.start.toISOString()).toBe(DUE.toISOString());
    expect(inGrace.end.toISOString()).toBe("2026-12-10T04:30:00.000Z");
    const late = renewalPeriod(DUE, day(9), 6, 7);
    expect(late.late).toBe(true);
    expect(late.start.toISOString()).toBe(day(9).toISOString());
  });

  it("follows the admin's grace days", () => {
    expect(renewalState(DUE, day(9), 10).phase).toBe("grace");
  });
});

describe("what a checkout buys", () => {
  const base = { pricingModel: "aum", declaredAumCrore: 300, aumCroreInForce: 300, aumSource: "declared", aumAsOf: null, nextCycle: null };

  it("a new firm pays the cycle, priced on the server from the declared AUM", () => {
    const p = planCheckout({ ...base, status: "pending", licenseEndAt: null }, { cycle: "yearly", users: 5 }, day(0), DEFAULT_PRICING);
    expect(p.kind).toBe("first");
    expect(p.chargePaise).toBe(R(315_945));
    expect(p.late).toBeNull();
    expect(p.periodStart).toBe(day(0).toISOString());
  });

  it("a renewal within grace costs nothing extra and starts on the due date", () => {
    const p = planCheckout({ ...base, status: "active", licenseEndAt: DUE }, { cycle: "monthly", users: 5 }, day(7), DEFAULT_PRICING);
    expect(p.kind).toBe("renewal");
    expect(p.chargePaise).toBe(R(30_975));
    expect(p.periodStart).toBe(DUE.toISOString());
  });

  it("after the grace period the 7 days are charged pro-rata and the cycle starts today", () => {
    const p = planCheckout({ ...base, status: "active", licenseEndAt: DUE }, { cycle: "monthly", users: 5 }, day(8), DEFAULT_PRICING);
    expect(p.kind).toBe("late_renewal");
    expect(p.late?.taxablePaise).toBe(R(6_125));
    expect(p.late?.totalPaise).toBe(R(7_228));
    expect(p.chargePaise).toBe(R(30_975 + 7_228));
    expect(p.periodStart).toBe(day(8).toISOString());
  });

  it("a renewal uses the AUM the review took from the CRM, never a typed one", () => {
    const nc = { aumCrore: 750, aumSource: "crm_snapshot", aumAsOf: "2026-11-03" } as unknown as Parameters<typeof planCheckout>[0]["nextCycle"];
    const p = planCheckout({ ...base, status: "active", licenseEndAt: DUE, nextCycle: nc }, { cycle: "monthly", users: 5, aumCrore: 10 }, day(2), DEFAULT_PRICING);
    expect(p.tierKey).toBe("upto_1000");
    expect(p.aumSource).toBe("crm_snapshot");
  });

  it("a paid-up firm has nothing to pay now", () => {
    expect(() => planCheckout({ ...base, status: "active", licenseEndAt: new Date("2027-01-01") }, { cycle: "yearly", users: 5 }, day(0), DEFAULT_PRICING)).toThrow(CheckoutError);
  });
});

describe("tax invoice arithmetic (rule E)", () => {
  it("numbers per India financial year", () => {
    expect(financialYear(new Date("2026-03-31T18:00:00Z"))).toBe("2025-26"); // 23:30 IST 31 Mar
    expect(financialYear(new Date("2026-03-31T19:00:00Z"))).toBe("2026-27"); // 00:30 IST 1 Apr
    expect(invoiceNumber("AINA", "2026-27", 123)).toBe("AINA/2026-27/000123");
  });

  it("CGST + SGST inside Gujarat, IGST elsewhere; the halves sum to the GST", () => {
    expect(splitGst(R(4_725), "24", "24")).toEqual({ cgstPaise: 236_250, sgstPaise: 236_250, igstPaise: 0, intraState: true });
    expect(splitGst(R(1_103), "24", "24")).toMatchObject({ cgstPaise: 55_150, sgstPaise: 55_150 });
    const odd = splitGst(R(4_725) + 1, "24", "24");
    expect(odd.cgstPaise + odd.sgstPaise).toBe(R(4_725) + 1);
    expect(splitGst(R(4_725), "24", "27")).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: R(4_725), intraState: false });
  });

  it("words in the Indian system", () => {
    expect(indianWords(315945)).toBe("Three Lakh Fifteen Thousand Nine Hundred Forty-Five");
    expect(indianWords(12_34_56_789)).toBe("Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine");
    expect(amountInWords(R(7_228))).toBe("Indian Rupees Seven Thousand Two Hundred Twenty-Eight Only");
    expect(amountInWords(R(100.5))).toBe("Indian Rupees One Hundred and Fifty Paise Only");
  });

  it("lines sum to the taxable value; a late renewal adds its own line", () => {
    const q = quoteCycle({ aumCrore: 300, users: 5, cycle: "half_yearly" });
    const f = invoiceFigures({ quote: q, tierLabel: q.tierLabel, periodStart: DUE, periodEnd: new Date("2027-05-10T04:30:00Z") });
    expect(f.lines.map((l) => l.key)).toEqual(["maintenance", "users", "discount"]);
    expect(f.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(f.taxablePaise);
    expect(f.totalPaise).toBe(R(170_982));
    expect(f.taxablePaise + f.gstPaise + f.roundOffPaise).toBe(f.totalPaise);

    const m = quoteCycle({ aumCrore: 300, users: 5, cycle: "monthly" });
    const late = { graceDays: 7, dayBasis: 30, monthlyBasePaise: monthlyBasePaise(300, 5), taxablePaise: R(6_125), gstPaise: R(1_103), totalPaise: R(7_228) };
    const lf = invoiceFigures({ quote: m, tierLabel: m.tierLabel, periodStart: day(9), periodEnd: day(39), late, lateFrom: DUE });
    expect(lf.lines.at(-1)?.key).toBe("late_fee");
    expect(lf.taxablePaise).toBe(R(26_250 + 6_125));
    expect(lf.gstPaise).toBe(R(4_725 + 1_103));
    expect(lf.totalPaise).toBe(R(30_975 + 7_228));
  });
});

describe("GST identity", () => {
  it("validates PANs", () => {
    expect(isValidPan("ACKFA5449H")).toBe(true);
    expect(isValidPan("abcde1234f")).toBe(false); // 4th letter E is not a holder type
    expect(isValidPan("ABCPE1234F")).toBe(true);
    expect(isValidPan("ABCP1234F")).toBe(false);
  });

  it("validates GSTINs including the check character", () => {
    expect(checkGstin("24ACKFA5449H1ZB")).toMatchObject({ ok: true, stateCode: "24", pan: "ACKFA5449H" });
    expect(checkGstin("24ACKFA5449H1ZC").ok).toBe(false);
    expect(checkGstin("98ACKFA5449H1ZB").ok).toBe(false);
    expect(checkGstin("24ACKFA5449H1Z").ok).toBe(false);
  });

  it("knows the states by name, alias or code", () => {
    expect(gstState("gujarat")).toEqual({ code: "24", name: "Gujarat" });
    expect(gstState("Orissa")?.code).toBe("21");
    expect(gstState("27")?.name).toBe("Maharashtra");
    expect(gstState("Atlantis")).toBeNull();
  });
});

describe("Get pricing request", () => {
  const good = { contactName: "Ravi Shah", firmName: "Shah Wealth", email: "Ravi@Example.com", mobile: "+91 98765 43210", arn: "arn 12345", aumCrore: "300", users: 5 };
  it("cleans a good request", () => {
    const r = parseQuoteRequest(good, DEFAULT_PRICING);
    expect(r).toMatchObject({ kind: "ok", value: { email: "ravi@example.com", mobile: "+919876543210", arn: "ARN-12345", aumCrore: 300, users: 5 } });
  });
  it("names the field that is wrong", () => {
    expect(parseQuoteRequest({ ...good, users: 0 }, DEFAULT_PRICING)).toMatchObject({ kind: "invalid", field: "users" });
    expect(parseQuoteRequest({ ...good, aumCrore: "-3" }, DEFAULT_PRICING)).toMatchObject({ kind: "invalid", field: "aumCrore" });
    expect(parseQuoteRequest({ ...good, mobile: "12345" }, DEFAULT_PRICING)).toMatchObject({ kind: "invalid", field: "mobile" });
    expect(parseQuoteRequest({ ...good, arn: "X-1" }, DEFAULT_PRICING)).toMatchObject({ kind: "invalid", field: "arn" });
  });
  it("springs the honeypot", () => {
    expect(parseQuoteRequest({ ...good, website: "http://spam" }, DEFAULT_PRICING).kind).toBe("trap");
  });
  it("normalises mobiles and ARNs", () => {
    expect(normaliseMobile("09876543210")).toBe("+919876543210");
    expect(normaliseMobile("5876543210")).toBeNull();
    expect(normaliseArn("")).toBeNull();
    expect(normaliseArn("ARN-123456")).toBe("ARN-123456");
  });
});
