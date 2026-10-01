/** Zod bodies for the fixed-deposit API (a route.ts may export only HTTP verbs). */

import { z } from "zod";
import { FD_COMPOUNDING, FD_HOLDINGS, FD_ISSUER_TYPES, FD_PAYOUTS, FD_STATUSES, FD_TAX_FORMS } from "@/db/schema";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const text = (max: number) => z.string().trim().max(max).nullable().optional();

export const FdBody = z.object({
  investorId: z.string().uuid(),
  rmId: z.string().uuid().nullable().optional(),
  issuer: z.string().trim().min(1, "Enter the bank or company").max(200),
  issuerType: z.enum(FD_ISSUER_TYPES).default("bank"),
  schemeName: text(200),
  fdNumber: text(100),
  depositDate: day,
  maturityDate: day,
  tenureMonths: z.number().int().min(0).max(1200).nullable().optional(),
  tenureDays: z.number().int().min(0).max(36500).nullable().optional(),
  principal: z.number().positive("Enter the amount deposited").max(1e12),
  interestRate: z.number().min(0).max(30),
  payout: z.enum(FD_PAYOUTS).default("cumulative"),
  compounding: z.enum(FD_COMPOUNDING).default("quarterly"),
  /** From the receipt. Omit (or null) to have it computed. */
  maturityAmount: z.number().min(0).max(1e13).nullable().optional(),
  holding: z.enum(FD_HOLDINGS).default("single"),
  jointHolders: text(300),
  nomineeName: text(200),
  seniorCitizen: z.boolean().default(false),
  taxForm: z.enum(FD_TAX_FORMS).default("none"),
  autoRenew: z.boolean().default(false),
  status: z.enum(FD_STATUSES).default("active"),
  closedOn: day.nullable().optional(),
  renewedFromId: z.string().uuid().nullable().optional(),
  commissionRate: z.number().min(0).max(20).nullable().optional(),
  commissionAmount: z.number().min(0).max(1e12).nullable().optional(),
  remarks: text(4000),
}).refine((b) => b.maturityDate > b.depositDate, { message: "Maturity must be after the deposit date", path: ["maturityDate"] })
  .refine((b) => b.payout !== "cumulative" || b.maturityAmount == null || b.maturityAmount === 0 || b.maturityAmount >= b.principal,
    { message: "The maturity amount cannot be less than the amount deposited", path: ["maturityAmount"] });

export const FdPatchBody = z.object({
  rmId: z.string().uuid().nullable().optional(),
  issuer: z.string().trim().min(1).max(200).optional(),
  issuerType: z.enum(FD_ISSUER_TYPES).optional(),
  schemeName: text(200),
  fdNumber: text(100),
  depositDate: day.optional(),
  maturityDate: day.optional(),
  tenureMonths: z.number().int().min(0).max(1200).nullable().optional(),
  tenureDays: z.number().int().min(0).max(36500).nullable().optional(),
  principal: z.number().positive().max(1e12).optional(),
  interestRate: z.number().min(0).max(30).optional(),
  payout: z.enum(FD_PAYOUTS).optional(),
  compounding: z.enum(FD_COMPOUNDING).optional(),
  maturityAmount: z.number().min(0).max(1e13).nullable().optional(),
  holding: z.enum(FD_HOLDINGS).optional(),
  jointHolders: text(300),
  nomineeName: text(200),
  seniorCitizen: z.boolean().optional(),
  taxForm: z.enum(FD_TAX_FORMS).optional(),
  autoRenew: z.boolean().optional(),
  status: z.enum(FD_STATUSES).optional(),
  closedOn: day.nullable().optional(),
  commissionRate: z.number().min(0).max(20).nullable().optional(),
  commissionAmount: z.number().min(0).max(1e12).nullable().optional(),
  remarks: text(4000),
});

export type FdInput = z.infer<typeof FdBody>;
export type FdPatch = z.infer<typeof FdPatchBody>;
