/**
 * AUM-based pricing (lib/billing/aum-pricing.ts) — the owner's pricing decision
 * of 2026-11-18. Every figure is in paise; GST and totals round to the rupee.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICING,
  addMonths,
  cycleLabel,
  cyclesOffered,
  isFirstPurchase,
  lateProRataCharge,
  monthlyBasePaise,
  parseCycle,
  quoteAll,
  quoteOffered,
  renewalCycleOf,
  quoteCycle,
  razorpayPeriod,
  resolvePricingSettings,
  tierFor,
  validatePricingOverride,
} from "@/lib/billing/aum-pricing";

const R = (rupees: number) => Math.round(rupees * 100);

describe("AUM tiers", () => {
  it.each([
    [0, "upto_500", 20_000],
    [99, "upto_500", 20_000],
    [100, "upto_500", 20_000],
    [500, "upto_500", 20_000],
    [500.01, "upto_1000", 35_000],
    [1000, "upto_1000", 35_000],
    [1000.01, "above_1000", 40_000],
    [5000, "above_1000", 40_000],
  ])("%s Cr → %s (₹%s / month)", (aum, key, rupees) => {
    const t = tierFor(aum);
    expect(t.key).toBe(key);
    expect(t.monthlyPaise).toBe(R(rupees));
  });

  it("refuses a negative or non-numeric AUM", () => {
    expect(() => tierFor(-1)).toThrow();
    expect(() => tierFor(Number.NaN)).toThrow();
  });
});

describe("users", () => {
  it("₹15,000 per user per year is ₹1,250 per user per month", () => {
    expect(monthlyBasePaise(300, 1)).toBe(R(20_000 + 1_250));
    expect(monthlyBasePaise(300, 5)).toBe(R(26_250));
    expect(monthlyBasePaise(2000, 40)).toBe(R(40_000 + 50_000));
  });

  it("needs at least one user, whole numbers only", () => {
    expect(() => quoteCycle({ aumCrore: 300, users: 0, cycle: "monthly" })).toThrow();
    expect(() => quoteCycle({ aumCrore: 300, users: 2.5, cycle: "monthly" })).toThrow();
    expect(() => quoteCycle({ aumCrore: 300, users: 1, cycle: "monthly" })).not.toThrow();
  });
});

describe("300 Cr + 5 users — the owner's worked example", () => {
  const [m, h, y] = quoteAll({ aumCrore: 300, users: 5 });

  it("monthly: 26,250 + 18% GST", () => {
    expect(m.cycle).toBe("monthly");
    expect(m.subtotalPaise).toBe(R(26_250));
    expect(m.discountPaise).toBe(0);
    expect(m.taxablePaise).toBe(R(26_250));
    expect(m.gstPaise).toBe(R(4_725));
    expect(m.totalPaise).toBe(R(30_975));
    expect(m.effectiveMonthlyPaise).toBe(R(30_975));
    expect(m.savingVsMonthlyPaise).toBe(0);
  });

  it("half-yearly: 6 × 26,250 × 0.92 + GST", () => {
    expect(h.months).toBe(6);
    expect(h.subtotalPaise).toBe(R(157_500));
    expect(h.discountPaise).toBe(R(12_600));
    expect(h.taxablePaise).toBe(R(144_900));
    expect(h.gstPaise).toBe(R(26_082));
    expect(h.totalPaise).toBe(R(170_982));
    expect(h.effectiveMonthlyPaise).toBe(R(28_497));
    expect(h.savingVsMonthlyPaise).toBe(R(30_975 * 6 - 170_982));
  });

  it("yearly: 12 × 26,250 × 0.85 + GST", () => {
    expect(y.months).toBe(12);
    expect(y.subtotalPaise).toBe(R(315_000));
    expect(y.discountPaise).toBe(R(47_250));
    expect(y.taxablePaise).toBe(R(267_750));
    expect(y.gstPaise).toBe(R(48_195));
    expect(y.totalPaise).toBe(R(315_945));
    expect(y.savingVsMonthlyPaise).toBe(R(30_975 * 12 - 315_945));
  });

  it("the three cards come back monthly → half-yearly → yearly", () => {
    expect([m.cycle, h.cycle, y.cycle]).toEqual(["monthly", "half_yearly", "yearly"]);
  });
});

describe("GST and rounding", () => {
  it("rounds GST half-up to the rupee and the total is taxable + GST", () => {
    // 1 user, 600 Cr: base 36,250; half-yearly 217,500 × 0.92 = 200,100; GST 36,018
    const q = quoteCycle({ aumCrore: 600, users: 1, cycle: "half_yearly" });
    expect(q.taxablePaise).toBe(R(200_100));
    expect(q.gstPaise).toBe(R(36_018));
    expect(q.totalPaise).toBe(q.taxablePaise + q.gstPaise);
    expect(q.roundOffPaise).toBe(0);
    for (const users of [1, 2, 3, 7, 11, 13, 29, 101]) {
      for (const aum of [50, 700, 1500]) {
        for (const c of quoteAll({ aumCrore: aum, users })) {
          expect(c.gstPaise % 100).toBe(0);
          expect(c.totalPaise % 100).toBe(0);
          expect(Number.isInteger(c.discountPaise)).toBe(true);
        }
      }
    }
  });

  it("a 0.5-rupee GST rounds up", () => {
    // Late charge for 300 Cr + 5: GST on 6,125 is 1,102.50 → 1,103.
    const late = lateProRataCharge(monthlyBasePaise(300, 5));
    expect(late.gstPaise).toBe(R(1_103));
  });
});

describe("late pro-rata charge", () => {
  it("300 Cr + 5 users: 26,250 ÷ 30 × 7 = 6,125 + 1,103 GST = 7,228", () => {
    const late = lateProRataCharge(monthlyBasePaise(300, 5));
    expect(late.taxablePaise).toBe(R(6_125));
    expect(late.totalPaise).toBe(R(7_228));
    expect(late.graceDays).toBe(7);
    expect(late.dayBasis).toBe(30);
  });

  it("follows the admin's grace days and day basis", () => {
    const s = resolvePricingSettings({ graceDays: 10, proRataDayBasis: 31 });
    const late = lateProRataCharge(monthlyBasePaise(300, 5, s), s);
    expect(late.taxablePaise).toBe(Math.floor((R(26_250) * 10) / 31 + 0.5));
  });
});

describe("admin override", () => {
  it("changes tiers, per-user price, discounts and GST", () => {
    const s = resolvePricingSettings({
      tiers: [
        { key: "small", label: "Small", upToCrore: 200, monthlyPaise: R(10_000) },
        { key: "big", label: "Big", upToCrore: null, monthlyPaise: R(50_000) },
      ],
      perUserYearlyPaise: R(12_000),
      cycles: {
        monthly: { months: 1, discountBp: 0 },
        half_yearly: { months: 6, discountBp: 1000 },
        yearly: { months: 12, discountBp: 2000 },
      },
      gstBp: 1200,
    });
    expect(tierFor(150, s).key).toBe("small");
    expect(tierFor(201, s).key).toBe("big");
    const y = quoteCycle({ aumCrore: 150, users: 2, cycle: "yearly" }, s);
    // (10,000 + 2 × 1,000) × 12 × 0.8 = 115,200; GST 12% = 13,824
    expect(y.taxablePaise).toBe(R(115_200));
    expect(y.gstPaise).toBe(R(13_824));
  });

  it("ignores a malformed override as a whole — never a ₹0 price", () => {
    expect(resolvePricingSettings({ tiers: [] })).toEqual(DEFAULT_PRICING);
    expect(resolvePricingSettings({ gstBp: -5 })).toEqual(DEFAULT_PRICING);
    expect(resolvePricingSettings({ tiers: [{ key: "a", label: "A", upToCrore: 100, monthlyPaise: 1 }] })).toEqual(DEFAULT_PRICING);
    expect(resolvePricingSettings(null)).toEqual(DEFAULT_PRICING);
    expect(resolvePricingSettings("nonsense")).toEqual(DEFAULT_PRICING);
  });

  it("validates an admin's save", () => {
    expect(validatePricingOverride({ graceDays: 7 }).ok).toBe(true);
    const bad = validatePricingOverride({
      tiers: [
        { key: "a", label: "A", upToCrore: 500, monthlyPaise: 1 },
        { key: "b", label: "B", upToCrore: 400, monthlyPaise: 1 },
        { key: "c", label: "C", upToCrore: null, monthlyPaise: 1 },
      ],
    });
    expect(bad.ok).toBe(false);
  });
});

describe("helpers", () => {
  it("maps cycles to Razorpay plan periods", () => {
    expect(razorpayPeriod("monthly")).toEqual({ period: "monthly", interval: 1 });
    expect(razorpayPeriod("half_yearly")).toEqual({ period: "monthly", interval: 6 });
    expect(razorpayPeriod("yearly")).toEqual({ period: "yearly", interval: 1 });
  });

  it("adds calendar months, clamped to the month's end", () => {
    expect(addMonths(new Date("2026-01-31T05:00:00Z"), 1).toISOString()).toBe("2026-02-28T05:00:00.000Z");
    expect(addMonths(new Date("2026-08-31T05:00:00Z"), 6).toISOString()).toBe("2027-02-28T05:00:00.000Z");
    expect(addMonths(new Date("2026-11-18T05:00:00Z"), 12).toISOString()).toBe("2027-11-18T05:00:00.000Z");
  });

  it("parses the stored cycles, the commitment included", () => {
    expect(parseCycle("half_yearly")).toBe("half_yearly");
    expect(parseCycle("commitment")).toBe("commitment");
    expect(parseCycle("weekly")).toBeNull();
    expect(parseCycle(undefined)).toBeNull();
  });
});

describe("first purchase: the 6-month commitment (owner's rule of 2026-11-18)", () => {
  it("300 Cr + 5 users: 6 × 26,250 = 1,57,500, no discount, + 28,350 GST = 1,85,850", () => {
    const c = quoteCycle({ aumCrore: 300, users: 5, cycle: "commitment" });
    expect(c.months).toBe(6);
    expect(c.monthlyBasePaise).toBe(R(26_250));
    expect(c.subtotalPaise).toBe(R(157_500));
    expect(c.discountBp).toBe(0);
    expect(c.discountPaise).toBe(0);
    expect(c.taxablePaise).toBe(R(157_500));
    expect(c.gstPaise).toBe(R(28_350));
    expect(c.totalPaise).toBe(R(185_850));
    expect(c.savingVsMonthlyPaise).toBe(0);
    // Yearly is unchanged.
    expect(quoteCycle({ aumCrore: 300, users: 5, cycle: "yearly" }).totalPaise).toBe(R(315_945));
  });

  it("a first purchase is offered the commitment and yearly only; everyone else the three", () => {
    expect(cyclesOffered(true)).toEqual(["commitment", "yearly"]);
    expect(cyclesOffered(false)).toEqual(["monthly", "half_yearly", "yearly"]);
    expect(quoteOffered({ aumCrore: 300, users: 5 }, true).map((q) => q.totalPaise)).toEqual([R(185_850), R(315_945)]);
    expect(quoteOffered({ aumCrore: 300, users: 5 }, false).map((q) => q.cycle)).toEqual(["monthly", "half_yearly", "yearly"]);
    // The standard three never include the commitment.
    expect(quoteAll({ aumCrore: 300, users: 5 }).map((q) => q.cycle)).not.toContain("commitment");
  });

  it("an existing firm — active, in grace, or with any payment on record — is never a first purchase", () => {
    expect(isFirstPurchase({ status: "pending", lastPaymentAt: null, paidInvoices: 0 })).toBe(true);
    expect(isFirstPurchase({ status: "trial", lastPaymentAt: null, paidInvoices: 0 })).toBe(true);
    expect(isFirstPurchase({ status: "active", lastPaymentAt: null, paidInvoices: 0 })).toBe(false);
    expect(isFirstPurchase({ status: "past_due", lastPaymentAt: null, paidInvoices: 0 })).toBe(false);
    expect(isFirstPurchase({ status: "expired", lastPaymentAt: "2026-01-01", paidInvoices: 0 })).toBe(false);
    expect(isFirstPurchase({ status: "pending", lastPaymentAt: null, paidInvoices: 1 })).toBe(false);
  });

  it("after the commitment the firm renews on a standard cycle — monthly by default", () => {
    expect(renewalCycleOf("commitment")).toBe("monthly");
    expect(renewalCycleOf(null)).toBe("monthly");
    expect(renewalCycleOf("yearly")).toBe("yearly");
    expect(razorpayPeriod("commitment")).toEqual({ period: "monthly", interval: 1 });
  });

  it("the admin sets the commitment's months and discount, and can switch the rule off", () => {
    const s = resolvePricingSettings({ cycles: { ...DEFAULT_PRICING.cycles, commitment: { months: 3, discountBp: 500 } } });
    const c = quoteCycle({ aumCrore: 300, users: 5, cycle: "commitment" }, s);
    expect(c.months).toBe(3);
    expect(c.discountPaise).toBe(R(3_937.5));
    expect(cycleLabel("commitment", c.months)).toBe("3-month commitment");
    expect(cyclesOffered(true, resolvePricingSettings({ firstPurchaseCommitment: false }))).toEqual(["monthly", "half_yearly", "yearly"]);
    expect(validatePricingOverride({ cycles: { ...DEFAULT_PRICING.cycles, commitment: { months: 0, discountBp: 0 } } }).ok).toBe(false);
  });

  it("an override saved before the commitment existed still applies, with the default commitment", () => {
    const old = {
      cycles: { monthly: { months: 1, discountBp: 0 }, half_yearly: { months: 6, discountBp: 1000 }, yearly: { months: 12, discountBp: 2000 } },
    };
    expect(validatePricingOverride(old).ok).toBe(true);
    const s = resolvePricingSettings(old);
    expect(s.cycles.half_yearly.discountBp).toBe(1000);
    expect(s.cycles.commitment).toEqual({ months: 6, discountBp: 0 });
    expect(s.firstPurchaseCommitment).toBe(true);
  });
});
