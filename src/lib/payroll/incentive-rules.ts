/**
 * Sales incentives — the pure rules (client-safe: the plan form previews them).
 * The database side is incentives.ts.
 *
 * Sales incentives (incentive_plans / incentive_statements, migration 0273;
 * docs/PAYROLL_MODULE_DESIGN.md §5). The measure always comes from the CRM,
 * never typed, on the dashboards' own definitions:
 *
 *   net_business       RTA-processed gross − redemption of the person's clients
 *   gross_business     RTA-processed gross investment of the person's clients
 *   net_sip            monthly amount of SIPs registered less stops reported
 *                      (lib/metrics/business.ts)
 *   insurance_premium  annual premium of policies booked in the period with the
 *                      person as the business owner (lib/insurance/book.ts)
 *   new_clients        client records onboarded in the period with the person
 *                      as RM (lib/metrics/new-clients.ts)
 *
 * Incentives count what the RTA processed (the firm's decision of
 * 2026-10-02) — business booked but not yet processed is not paid until it is.
 * No RTA data for the period is not ₹0 of business: the statement says so and
 * pays nothing until the files are imported and it is recalculated.
 *
 * Shape: slabs on achievement of target (%) or on the measure itself; the
 * highest slab reached pays — a % of the measure, a fixed sum, or a sum per
 * unit (new clients) — up to the plan's cap. Targets are the person's KRA
 * targets (Settings → Targets), the annual figure pro-rated to the period.
 *
 * Flow: calculated → approved (payroll.manage) → paid in the next pay run as
 * a taxable earning (lib/payroll/inputs.ts).
 */

import { z } from "zod";

export type IncentiveSlab = { from: number; rate: number };

export const MEASURES = {
  net_business: { label: "Net business (RTA-processed)", target: "mf_business", unit: "money" },
  gross_business: { label: "Gross investment (RTA-processed)", target: null, unit: "money" },
  net_sip: { label: "Net SIP added (monthly amount)", target: "net_sip", unit: "money" },
  insurance_premium: { label: "Insurance premium booked", target: "insurance_business", unit: "money" },
  new_clients: { label: "New clients onboarded", target: "new_clients", unit: "count" },
} as const;
export type MeasureKey = keyof typeof MEASURES;
export const MEASURE_KEYS = Object.keys(MEASURES) as MeasureKey[];

export type PlanShape = {
  measure: MeasureKey;
  slabOn: "achievement" | "value";
  payout: "percent" | "fixed" | "per_unit";
  slabs: IncentiveSlab[];
  cap: number | null;
};

export type IncentiveWorking = {
  amount: number;
  achievementPct: number | null;
  slab: IncentiveSlab | null;
  capped: boolean;
  summary: string;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const fmt = (unit: "money" | "count", n: number) => (unit === "money" ? inr(n) : `${Math.round(n)}`);

/** The incentive for one person. Pure — tested, and previewed in the plan form. */
export function workIncentive(plan: PlanShape, value: number | null, target: number | null): IncentiveWorking {
  const m = MEASURES[plan.measure];
  if (value == null) return { amount: 0, achievementPct: null, slab: null, capped: false, summary: "No RTA data for this period yet — import the registrar files and recalculate." };
  const achievementPct = target && target > 0 ? Math.round((value / target) * 10000) / 100 : null;
  const x = plan.slabOn === "achievement" ? achievementPct : value;
  const head = `${m.label} ${fmt(m.unit, value)}${target && target > 0 ? ` against a target of ${fmt(m.unit, target)} (${achievementPct}%)` : ""}`;
  if (x == null) return { amount: 0, achievementPct, slab: null, capped: false, summary: `${head}. No target is set for this person, so a plan paid on achievement pays nothing — set the target in Settings → Targets.` };
  const slab = [...plan.slabs].sort((a, b) => a.from - b.from).filter((s) => x >= s.from).pop() ?? null;
  if (!slab || slab.rate <= 0 || value <= 0) {
    return { amount: 0, achievementPct, slab, capped: false, summary: `${head}. Below the first slab — no incentive this period.` };
  }
  let amount = plan.payout === "percent" ? (value * slab.rate) / 100 : plan.payout === "per_unit" ? value * slab.rate : slab.rate;
  amount = Math.round(amount);
  let capped = false;
  if (plan.cap != null && amount > plan.cap) {
    amount = Math.round(plan.cap);
    capped = true;
  }
  const on = plan.slabOn === "achievement" ? `${slab.from}% of target` : fmt(m.unit, slab.from);
  const pays = plan.payout === "percent" ? `${slab.rate}% of ${fmt(m.unit, value)}` : plan.payout === "per_unit" ? `${inr(slab.rate)} × ${Math.round(value)}` : `a fixed ${inr(slab.rate)}`;
  return { amount, achievementPct, slab, capped, summary: `${head}. Slab from ${on} pays ${pays} = ${inr(amount)}${capped ? ` (capped at ${inr(plan.cap!)})` : ""}.` };
}

/** First and last day of the plan period that `month` (yyyy-mm) falls in. Quarters follow the financial year. */
export function planPeriod(kind: "month" | "quarter", month: string): { start: string; end: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = kind === "month" ? m : m - ((m - 1) % 3); // Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec
  const last = kind === "month" ? m : first + 2;
  const end = new Date(Date.UTC(y, last, 0)).toISOString().slice(0, 10);
  return { start: `${y}-${String(first).padStart(2, "0")}-01`, end };
}

/** The KRA fiscal-year key ('2026-27') for a date. */
export function fiscalYearOf(day: string): string {
  const y = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const PlanSchema = z.object({
  name: z.string().trim().min(3, "Name the plan").max(80),
  measure: z.enum(Object.keys(MEASURES) as [MeasureKey, ...MeasureKey[]]),
  periodKind: z.enum(["month", "quarter"]),
  slabOn: z.enum(["achievement", "value"]),
  payout: z.enum(["percent", "fixed", "per_unit"]),
  slabs: z.array(z.object({ from: z.number().min(0).max(1_000_000_000), rate: z.number().min(0).max(10_000_000) })).min(1, "Add at least one slab").max(10),
  cap: z.number().positive().max(100_000_000).nullable().optional(),
  roles: z.array(z.string().max(40)).max(20).default([]),
  userIds: z.array(z.string().uuid()).max(500).default([]),
  active: z.boolean().default(true),
}).superRefine((p, ctx) => {
  if (p.slabOn === "achievement" && !MEASURES[p.measure].target) ctx.addIssue({ code: "custom", path: ["slabOn"], message: `${MEASURES[p.measure].label} has no target — pay it on the value instead.` });
  if (p.payout === "percent" && MEASURES[p.measure].unit === "count") ctx.addIssue({ code: "custom", path: ["payout"], message: "A count of clients is paid per client or as a fixed sum, not a percentage." });
  if (p.payout === "per_unit" && MEASURES[p.measure].unit !== "count") ctx.addIssue({ code: "custom", path: ["payout"], message: "Per client applies only to new clients." });
  if (!p.roles.length && !p.userIds.length) ctx.addIssue({ code: "custom", path: ["roles"], message: "Choose who the plan is for." });
});
export type PlanInput = z.infer<typeof PlanSchema>;
