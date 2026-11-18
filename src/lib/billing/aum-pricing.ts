/**
 * AUM-based pricing — the ONE place the price of an Aina subscription is
 * decided (the owner's pricing decision of 2026-11-18). Pure: no DB, no I/O.
 *
 *   Monthly maintenance, by the firm's AUM (₹ crore):
 *     AUM ≤ 500 Cr          → ₹20,000 / month   (includes firms under 100 Cr)
 *     500 < AUM ≤ 1,000 Cr  → ₹35,000 / month
 *     AUM > 1,000 Cr        → ₹40,000 / month
 *   CRM users: ₹15,000 per user per YEAR (= ₹1,250 per user per month), min 1.
 *   Monthly base = maintenance + users × ₹1,250.
 *   Cycles: monthly (no discount) · half-yearly (6 months, 8% off the whole bill)
 *           · yearly (12 months, 15% off the whole bill).
 *   GST 18% on the discounted amount. Prices exclude GST.
 *
 * Every figure is in PAISE (integers). Rounding, in order:
 *   1. users' monthly charge = users × yearly-rate ÷ 12, rounded half-up to the paisa;
 *   2. discount = subtotal × discount%, rounded half-up to the paisa;
 *   3. GST = taxable × GST%, rounded half-up to the RUPEE;
 *   4. total = taxable + GST, rounded half-up to the RUPEE (any difference is
 *      reported as `roundOffPaise`; with the default numbers it is always 0);
 *   5. effective per month = total ÷ months, rounded half-up to the rupee
 *      (display only — the charge is the total).
 *
 * The numbers are DEFAULTS. A platform admin can override them
 * (platform_settings 'aum_pricing', Aina Admin → Pricing & billing); the server
 * reads the override with `resolvePricingSettings` and ALWAYS recomputes a
 * price from the inputs — a price sent by a browser is never trusted.
 */

import { z } from "zod";

export type CycleKey = "monthly" | "half_yearly" | "yearly";
export const CYCLE_KEYS: readonly CycleKey[] = ["monthly", "half_yearly", "yearly"] as const;

export const CYCLE_LABEL: Record<CycleKey, string> = {
  monthly: "Monthly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
};

export type AumTier = {
  /** Stable key: "upto_500", "upto_1000", "above_1000" for the defaults. */
  key: string;
  label: string;
  /** Inclusive upper bound in ₹ crore; null = no upper bound (the last tier). */
  upToCrore: number | null;
  monthlyPaise: number;
};

export type PricingSettings = {
  tiers: AumTier[];
  perUserYearlyPaise: number;
  minUsers: number;
  maxUsers: number;
  cycles: Record<CycleKey, { months: number; discountBp: number }>;
  /** GST in basis points (1800 = 18%). */
  gstBp: number;
  /** Days of full access after a missed renewal (the owner's rule: 7). */
  graceDays: number;
  /** A late payment adds grace days pro-rata: monthly base ÷ this × graceDays. */
  proRataDayBasis: number;
  /** Days before a renewal the tier is re-decided from the CRM's AUM. */
  renewalReviewDays: number;
  /** SAC printed on invoices — confirm with the CA. */
  sacCode: string;
  /** Package (packages.key) an AUM-priced firm is put on; null = "starter" / first active. */
  packageKey: string | null;
  /** Firms may create their account from /pricing. */
  onlineSignup: boolean;
};

export const DEFAULT_PRICING: PricingSettings = {
  tiers: [
    { key: "upto_500", label: "Up to ₹500 Cr", upToCrore: 500, monthlyPaise: 20_000_00 },
    { key: "upto_1000", label: "₹500 – 1,000 Cr", upToCrore: 1000, monthlyPaise: 35_000_00 },
    { key: "above_1000", label: "Above ₹1,000 Cr", upToCrore: null, monthlyPaise: 40_000_00 },
  ],
  perUserYearlyPaise: 15_000_00,
  minUsers: 1,
  maxUsers: 500,
  cycles: {
    monthly: { months: 1, discountBp: 0 },
    half_yearly: { months: 6, discountBp: 800 },
    yearly: { months: 12, discountBp: 1500 },
  },
  gstBp: 1800,
  graceDays: 7,
  proRataDayBasis: 30,
  renewalReviewDays: 7,
  sacCode: "998314",
  packageKey: null,
  onlineSignup: true,
};

const paise = z.number().int().min(0).max(1_000_000_000_00);
const Override = z
  .object({
    tiers: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(60),
          upToCrore: z.number().positive().max(1_000_000).nullable(),
          monthlyPaise: paise,
        })
      )
      .min(1)
      .max(10),
    perUserYearlyPaise: paise,
    minUsers: z.number().int().min(1).max(1000),
    maxUsers: z.number().int().min(1).max(10000),
    cycles: z.object({
      monthly: z.object({ months: z.literal(1), discountBp: z.number().int().min(0).max(5000) }),
      half_yearly: z.object({ months: z.literal(6), discountBp: z.number().int().min(0).max(5000) }),
      yearly: z.object({ months: z.literal(12), discountBp: z.number().int().min(0).max(5000) }),
    }),
    gstBp: z.number().int().min(0).max(5000),
    graceDays: z.number().int().min(0).max(60),
    proRataDayBasis: z.number().int().min(1).max(31),
    renewalReviewDays: z.number().int().min(1).max(60),
    sacCode: z.string().trim().regex(/^\d{4,8}$/),
    packageKey: z.string().trim().min(1).max(60).nullable(),
    onlineSignup: z.boolean(),
  })
  .partial();

export type PricingOverride = z.infer<typeof Override>;

/** Tiers must ascend and end with the open-ended tier. */
export function tiersValid(tiers: AumTier[]): boolean {
  if (!tiers.length) return false;
  for (let i = 0; i < tiers.length; i++) {
    const last = i === tiers.length - 1;
    const t = tiers[i];
    if (last ? t.upToCrore !== null : t.upToCrore === null) return false;
    if (i > 0 && t.upToCrore !== null && (tiers[i - 1].upToCrore as number) >= t.upToCrore) return false;
  }
  return new Set(tiers.map((t) => t.key)).size === tiers.length;
}

/**
 * Defaults with a platform-admin override merged on top. An override that does
 * not validate (or whose tiers are malformed) is ignored as a whole — never
 * half-applied — so a bad save can never produce a ₹0 price.
 */
export function resolvePricingSettings(override: unknown): PricingSettings {
  const parsed = Override.safeParse(override ?? {});
  if (!parsed.success) return DEFAULT_PRICING;
  const merged: PricingSettings = {
    ...DEFAULT_PRICING,
    ...parsed.data,
    cycles: { ...DEFAULT_PRICING.cycles, ...(parsed.data.cycles ?? {}) },
  } as PricingSettings;
  if (!tiersValid(merged.tiers) || merged.minUsers > merged.maxUsers) return DEFAULT_PRICING;
  return merged;
}

/** Validate an admin's save — returns the error to show, or null. */
export function validatePricingOverride(input: unknown): { ok: true; value: PricingOverride } | { ok: false; error: string } {
  const parsed = Override.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid pricing settings" };
  if (parsed.data.tiers && !tiersValid(parsed.data.tiers as AumTier[])) {
    return { ok: false, error: "AUM tiers must ascend, have unique keys, and end with an open-ended tier." };
  }
  const minU = parsed.data.minUsers ?? DEFAULT_PRICING.minUsers;
  const maxU = parsed.data.maxUsers ?? DEFAULT_PRICING.maxUsers;
  if (minU > maxU) return { ok: false, error: "Minimum users cannot be more than maximum users." };
  return { ok: true, value: parsed.data };
}

// ---------------------------------------------------------------------------

const halfUp = (n: number) => Math.floor(n + 0.5);
/** Round paise half-up to a whole rupee (in paise). */
export const roundToRupee = (p: number) => halfUp(p / 100) * 100;

export function tierFor(aumCrore: number, s: PricingSettings = DEFAULT_PRICING): AumTier {
  if (!Number.isFinite(aumCrore) || aumCrore < 0) throw new Error("AUM must be zero or more (₹ crore).");
  for (const t of s.tiers) {
    if (t.upToCrore === null || aumCrore <= t.upToCrore) return t;
  }
  return s.tiers[s.tiers.length - 1];
}

export function usersMonthlyPaise(users: number, s: PricingSettings = DEFAULT_PRICING): number {
  return halfUp((users * s.perUserYearlyPaise) / 12);
}

/** maintenance + users × per-user monthly, before any discount. */
export function monthlyBasePaise(aumCrore: number, users: number, s: PricingSettings = DEFAULT_PRICING): number {
  return tierFor(aumCrore, s).monthlyPaise + usersMonthlyPaise(users, s);
}

export type CycleQuote = {
  cycle: CycleKey;
  months: number;
  aumCrore: number;
  tierKey: string;
  tierLabel: string;
  users: number;
  maintenanceMonthlyPaise: number;
  perUserMonthlyPaise: number;
  usersMonthlyPaise: number;
  monthlyBasePaise: number;
  /** months × monthly base, before discount. */
  subtotalPaise: number;
  discountBp: number;
  discountPaise: number;
  taxablePaise: number;
  gstBp: number;
  gstPaise: number;
  roundOffPaise: number;
  /** What is charged for the cycle (incl. GST). */
  totalPaise: number;
  effectiveMonthlyPaise: number;
  /** vs paying monthly for the same months (incl. GST); 0 for monthly. */
  savingVsMonthlyPaise: number;
};

export function assertUsers(users: number, s: PricingSettings = DEFAULT_PRICING): number {
  if (!Number.isInteger(users) || users < s.minUsers || users > s.maxUsers) {
    throw new Error(`Users must be a whole number from ${s.minUsers} to ${s.maxUsers}.`);
  }
  return users;
}

function priceMonths(months: number, discountBp: number, base: number, gstBp: number) {
  const subtotal = base * months;
  const discount = halfUp((subtotal * discountBp) / 10000);
  const taxable = subtotal - discount;
  const gst = roundToRupee((taxable * gstBp) / 10000);
  const total = roundToRupee(taxable + gst);
  return { subtotal, discount, taxable, gst, total, roundOff: total - (taxable + gst) };
}

export function quoteCycle(
  input: { aumCrore: number; users: number; cycle: CycleKey },
  s: PricingSettings = DEFAULT_PRICING
): CycleQuote {
  const users = assertUsers(input.users, s);
  const tier = tierFor(input.aumCrore, s);
  const c = s.cycles[input.cycle];
  if (!c) throw new Error("Unknown billing cycle.");
  const perUserMonthly = halfUp(s.perUserYearlyPaise / 12);
  const usersMonthly = usersMonthlyPaise(users, s);
  const base = tier.monthlyPaise + usersMonthly;
  const p = priceMonths(c.months, c.discountBp, base, s.gstBp);
  const monthlyEquivalent = priceMonths(1, s.cycles.monthly.discountBp, base, s.gstBp).total * c.months;
  return {
    cycle: input.cycle,
    months: c.months,
    aumCrore: input.aumCrore,
    tierKey: tier.key,
    tierLabel: tier.label,
    users,
    maintenanceMonthlyPaise: tier.monthlyPaise,
    perUserMonthlyPaise: perUserMonthly,
    usersMonthlyPaise: usersMonthly,
    monthlyBasePaise: base,
    subtotalPaise: p.subtotal,
    discountBp: c.discountBp,
    discountPaise: p.discount,
    taxablePaise: p.taxable,
    gstBp: s.gstBp,
    gstPaise: p.gst,
    roundOffPaise: p.roundOff,
    totalPaise: p.total,
    effectiveMonthlyPaise: roundToRupee(p.total / c.months),
    savingVsMonthlyPaise: Math.max(0, monthlyEquivalent - p.total),
  };
}

/** The three packages side by side, monthly → half-yearly → yearly. */
export function quoteAll(input: { aumCrore: number; users: number }, s: PricingSettings = DEFAULT_PRICING): CycleQuote[] {
  return CYCLE_KEYS.map((cycle) => quoteCycle({ ...input, cycle }, s));
}

export type LateCharge = {
  graceDays: number;
  dayBasis: number;
  monthlyBasePaise: number;
  /** monthly base ÷ day basis × grace days, half-up to the paisa. */
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
};

/**
 * The late pro-rata charge for a renewal paid AFTER the grace period: the grace
 * days at the monthly base (before any discount) of the tier in force for the
 * cycle being paid, plus GST. 300 Cr + 5 users → 26,250 ÷ 30 × 7 = 6,125 +
 * 1,103 GST = ₹7,228.
 */
export function lateProRataCharge(monthlyBase: number, s: PricingSettings = DEFAULT_PRICING): LateCharge {
  const taxable = halfUp((monthlyBase * s.graceDays) / s.proRataDayBasis);
  const gst = roundToRupee((taxable * s.gstBp) / 10000);
  return {
    graceDays: s.graceDays,
    dayBasis: s.proRataDayBasis,
    monthlyBasePaise: monthlyBase,
    taxablePaise: taxable,
    gstPaise: gst,
    totalPaise: roundToRupee(taxable + gst),
  };
}

/** Razorpay plan period for a cycle — monthly ×1, monthly ×6, yearly ×1. */
export function razorpayPeriod(cycle: CycleKey): { period: "monthly" | "yearly"; interval: number } {
  if (cycle === "yearly") return { period: "yearly", interval: 1 };
  if (cycle === "half_yearly") return { period: "monthly", interval: 6 };
  return { period: "monthly", interval: 1 };
}

/** Cycles to authorise the mandate for (Razorpay's total_count): ~10 years. */
export function razorpayTotalCount(cycle: CycleKey): number {
  return cycle === "yearly" ? 10 : cycle === "half_yearly" ? 20 : 120;
}

/** Calendar months later, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

export function parseCycle(v: unknown): CycleKey | null {
  return typeof v === "string" && (CYCLE_KEYS as readonly string[]).includes(v) ? (v as CycleKey) : null;
}

/** "₹26,250" — whole-rupee display for paise. */
export function inr(p: number): string {
  const rupees = p / 100;
  return "₹" + rupees.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 });
}
