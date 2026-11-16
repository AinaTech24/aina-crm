import { boolean, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Payroll, phase 1 (migration 0261; docs/PAYROLL_MODULE_DESIGN.md). The
 * employee is the CRM `users` row; payroll adds a profile beside it, a salary
 * history and monthly pay runs. The firm's settings live in
 * tenants.payroll_settings (lib/payroll/settings.ts).
 */

/** Statutory and bank details. PAN and bank account are encrypted (lib/crypto). */
export const payrollProfiles = pgTable(
  "payroll_profiles",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    panEnc: text("pan_enc"),
    panLast4: text("pan_last4"),
    uan: text("uan"),
    pfNumber: text("pf_number"),
    esiNumber: text("esi_number"),
    bankName: text("bank_name"),
    bankAccountEnc: text("bank_account_enc"),
    bankAccountLast4: text("bank_account_last4"),
    ifsc: text("ifsc"),
    paymentMode: text("payment_mode").notNull().default("bank"),
    /** Work state — decides Professional Tax (lib/payroll/statutory.ts). */
    workState: text("work_state"),
    gender: text("gender"),
    taxRegime: text("tax_regime").notNull().default("new"),
    pfEnabled: boolean("pf_enabled").notNull().default(true),
    /** "auto" = by the ESI wage ceiling; "off" = never. */
    esiMode: text("esi_mode").notNull().default("auto"),
    exitDate: date("exit_date"),
    /** Salary and TDS paid this financial year before payroll moved to the CRM — TDS needs the whole year. */
    openingFyStart: date("opening_fy_start"),
    openingTaxableGross: numeric("opening_taxable_gross", { precision: 12, scale: 2 }),
    openingTds: numeric("opening_tds", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ userUq: uniqueIndex("payroll_profiles_user_uq").on(t.tenantId, t.userId) })
);

/** Salary history: a new row per revision, never an edit. */
export const employeeSalaries = pgTable(
  "employee_salaries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    effectiveFrom: date("effective_from").notNull(),
    monthlyGross: numeric("monthly_gross", { precision: 12, scale: 2 }).notNull(),
    basicOverride: numeric("basic_override", { precision: 12, scale: 2 }),
    hraOverride: numeric("hra_override", { precision: 12, scale: 2 }),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("employee_salaries_user_idx").on(t.tenantId, t.userId, t.effectiveFrom) })
);

/** One pay run per month: draft → approved → paid (then locked). */
export const payRuns = pgTable(
  "pay_runs",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** First day of the month paid for. */
    period: date("period").notNull(),
    status: text("status").notNull().default("draft"),
    totals: jsonb("totals").$type<Record<string, number>>().notNull().default({}),
    preparedBy: uuid("prepared_by"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidBy: uuid("paid_by"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidOn: date("paid_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ periodUq: uniqueIndex("pay_runs_period_uq").on(t.tenantId, t.period) })
);

export type PayAdjustment = { label: string; amount: number; kind: "earning" | "deduction"; taxable: boolean };

/**
 * One employee in a pay run. `result` is the calculation frozen as JSON —
 * every line with its "why" — so an approved or paid run never changes.
 */
export const payRunItems = pgTable(
  "pay_run_items",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    payRunId: uuid("pay_run_id").notNull().references(() => payRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    lopDays: numeric("lop_days", { precision: 5, scale: 1 }).notNull().default("0"),
    /** The admin set the LOP by hand (with a reason); a recalculation keeps it. */
    lopOverride: boolean("lop_override").notNull().default(false),
    lopReason: text("lop_reason"),
    adjustments: jsonb("adjustments").$type<PayAdjustment[]>().notNull().default([]),
    onHold: boolean("on_hold").notNull().default(false),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    gross: numeric("gross", { precision: 12, scale: 2 }).notNull().default("0"),
    deductions: numeric("deductions", { precision: 12, scale: 2 }).notNull().default("0"),
    net: numeric("net", { precision: 12, scale: 2 }).notNull().default("0"),
    tds: numeric("tds", { precision: 12, scale: 2 }).notNull().default("0"),
    employerCost: numeric("employer_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runUserUq: uniqueIndex("pay_run_items_run_user_uq").on(t.payRunId, t.userId),
    userIdx: index("pay_run_items_user_idx").on(t.tenantId, t.userId),
  })
);

export type PayRun = typeof payRuns.$inferSelect;
export type PayRunItem = typeof payRunItems.$inferSelect;
