/**
 * Reimbursement claims (docs/PAYROLL_MODULE_DESIGN.md §3.8): the employee
 * claims an expense with its bill details → their reporting manager (or a
 * payroll manager) approves → the next pay run repays it, untaxed.
 *
 * - One bill is never paid twice: the claimant, category, bill date, amount
 *   and bill number make a key that is unique among live claims.
 * - Nobody approves their own claim. A reporting manager decides claims of
 *   the people who report to them; `payroll.manage` decides any. A manager
 *   sees claim amounts only — never salaries.
 * - An approved claim already on an approved or paid run cannot be undone.
 */

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export { CLAIM_CATEGORIES, CLAIM_STATUS, claimCategoryLabel } from "./labels";

export function claimDedupKey(userId: string, category: string, claimDate: string, amount: number, billNumber?: string | null): string {
  // "HP-7781", "hp 7781" and "HP/7781" are the same bill.
  const bill = (billNumber ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return createHash("sha256").update([userId, category, claimDate, Math.round(amount * 100), bill].join("|")).digest("hex");
}

/** May `deciderId` approve or reject a claim by `claimantId`? */
export async function canDecideClaim(tx: Tx, tenantId: string, deciderId: string, claimantId: string, isPayrollManager: boolean): Promise<boolean> {
  if (deciderId === claimantId) return false;
  if (isPayrollManager) return true;
  const r = (await tx.execute(sql`
    SELECT 1 FROM users WHERE tenant_id = ${tenantId}::uuid AND id = ${claimantId}::uuid AND reporting_manager_id = ${deciderId}::uuid`)).rows;
  return r.length > 0;
}
