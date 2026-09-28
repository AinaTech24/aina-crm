/**
 * Build the frame a book's loaders run in. SERVER-ONLY.
 *
 * Shared by the personal cockpit and the branch command centre so the two
 * resolve "this period", "the previous corresponding period" and "the FY" the
 * same way — a branch figure and the sum of its RMs' figures can only agree if
 * both were measured over the same days.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { resolvePeriodRange, resolvePreviousRange, toLocalISODate, type Period } from "@/lib/dashboard/period";
import { fyElapsedFraction } from "@/lib/dashboard/target-progress";
import { currentFyLabel, fyStartYear } from "@/lib/finance/fiscal-year";
import type { BookScope, MyWindow } from "./window";

export function buildBookWindow(args: {
  scope: BookScope;
  staff: string[];
  possessive: string | null;
  period: Period;
  customStart?: string;
  customFrom?: string;
  customTo?: string;
  now?: Date;
}): { w: MyWindow; periodLabel: string; comparisonLabel: string } {
  const now = args.now ?? new Date();
  const opts = { customStart: args.customStart, from: args.customFrom, to: args.customTo };
  const range = resolvePeriodRange(args.period, now, opts);
  const prev = resolvePreviousRange(args.period, now, opts);
  const fiscalYear = currentFyLabel(now);
  const fyY = fyStartYear(fiscalYear);
  return {
    w: {
      scope: args.scope,
      staff: args.staff,
      possessive: args.possessive,
      // LOCAL dates from the Date objects — never `fromISO.slice(0, 10)`.
      // fromISO is a UTC timestamp, so local midnight on 1 September in India
      // slices to "2026-08-31": month-to-date quietly started a day early and
      // counted 31 August into September. The director cockpit builds its
      // window the same way (OwnerCockpit, toLocalISODate(cur.fromDate)).
      from: toLocalISODate(range.fromDate),
      to: toLocalISODate(range.toDate),
      prevFrom: toLocalISODate(prev.fromDate),
      prevTo: toLocalISODate(prev.toDate),
      fyStart: `${fyY}-04-01`,
      fiscalYear,
      fyPace: fyElapsedFraction(fyY, now),
      // Local, not toISOString(). A UTC slice turns local midnight on 1 April
      // into 31 March and silently shifts the whole financial year.
      today: toLocalISODate(now),
    },
    periodLabel: range.label,
    comparisonLabel: prev.label,
  };
}

/**
 * Everyone who works in the branch, for its STAFF facts (meetings held, tasks,
 * proposals written). Inactive and departed people are included on purpose: a
 * meeting held in April by someone who left in August still happened in this
 * branch, and dropping it would quietly rewrite the branch's history.
 */
export async function loadBranchStaff(tx: Tx, branchId: string): Promise<string[]> {
  const rows = (await tx.execute(sql`
    SELECT id FROM users WHERE branch_id = ${branchId}::uuid
  `)).rows as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}
