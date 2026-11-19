/**
 * The firm's payroll settings (tenants.payroll_settings, migration 0261),
 * Payroll → Settings. Defaults answer the design's open questions in the
 * common way; every one is the firm's to change.
 */

import { z } from "zod";

export const PayrollSettingsSchema = z.object({
  /** Days a month's salary is divided by: the month's calendar days, or a fixed 30 / 26. */
  payableDaysMethod: z.enum(["calendar", "fixed30", "fixed26"]).default("calendar"),
  /** Basic as a share of monthly gross (Code on Wages: wages ≥ 50% of pay). */
  basicPct: z.number().min(0.3).max(1).default(0.5),
  /** HRA as a share of Basic (50% in metro cities, 40% elsewhere for the exemption). */
  hraPctOfBasic: z.number().min(0).max(0.5).default(0.4),
  /** PF on wages up to the ₹15,000 ceiling, or on full Basic. */
  pfWageMode: z.enum(["capped", "full"]).default("capped"),
  /** Work state when an employee's profile has none. */
  defaultState: z.string().max(3).default("GJ"),
  /** Day of the month salaries are paid. */
  payDay: z.number().int().min(1).max(31).default(1),
  /** Last month for tax proofs (1 = January): later runs count only verified proofs (lib/payroll/tax.ts). */
  proofDeadlineMonth: z.number().int().min(1).max(3).default(1),
});
export type PayrollSettings = z.infer<typeof PayrollSettingsSchema>;

export function readPayrollSettings(raw: unknown): PayrollSettings {
  const parsed = PayrollSettingsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return parsed.success ? parsed.data : PayrollSettingsSchema.parse({});
}
