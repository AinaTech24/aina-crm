/**
 * The request shapes for a custom report's definition — one copy for create
 * (POST /api/reports/saved) and update (PATCH /api/reports/saved/[id]); they
 * had drifted into two. Zod strips unknown keys, so an option missing here is
 * silently dropped on save: add new options HERE.
 */

import { z } from "zod";
import { REPORT_AGGREGATES } from "@/db/schema";
import { categoryColumnsSchema } from "./categories";

/** A group-by / pivot key: a catalog field, or "<date field>@<grain>", or "cat:<category id>". */
const groupKey = z.string().min(1).max(80);

export const SummarySchema = z.object({
  groupBy: z.array(groupKey).min(1).max(3),
  columns: z.array(z.string().max(80)).max(40).optional(),
  aggregates: z
    .array(z.object({ field: z.string().max(60).optional().default(""), fn: z.enum(REPORT_AGGREGATES), label: z.string().max(60).optional() }))
    .max(8)
    .optional(),
  showDetailRows: z.boolean().optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
  groupSort: z.enum(["key", "count", "value"]).optional(),
  growth: z.boolean().optional(),
});

export const MatrixSchema = z.object({
  groupBy: groupKey,
  pivot: groupKey.optional(),
  aggregate: z.enum(REPORT_AGGREGATES),
  measure: z.string().optional(),
  rowSort: z.enum(["key", "total"]).optional(),
});

export const ChartOptionsSchema = z.object({
  target: z.number().finite().nullable().optional(),
  limit: z.number().int().min(1).max(100).nullable().optional(),
});

export const ScheduleSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  hour: z.number().int().min(0).max(23),
  /** weekly: 0–6 (Sun–Sat); monthly: 1–28; yearly: day of the month (1–28). */
  day: z.number().int().min(0).max(31).optional(),
  /** yearly: the month, 1–12. */
  month: z.number().int().min(1).max(12).optional(),
  /** Team members — each gets it at their own email; checked against the firm's users. */
  userIds: z.array(z.string().uuid()).max(50).optional(),
  /** Anyone else, typed (Zoho's "additional recipients"). */
  emails: z.array(z.string().email()).max(50),
  /** Attach the report as an Excel file (the email body always shows the first rows). */
  attach: z.boolean().optional(),
  enabled: z.boolean(),
});

export const ChartTypeSchema = z.enum(["none", "bar", "pie", "line", "area", "donut"]);

export { categoryColumnsSchema };
