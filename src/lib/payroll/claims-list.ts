/**
 * Loading claims for the screens: one's own, the team's to decide (reporting
 * manager), or everyone's (payroll). Callers are inside withTenant.
 */

import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { ClaimRow } from "@/components/payroll/ClaimsTable";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function loadClaims(
  tx: Tx,
  tenantId: string,
  where: SQL,
  decider?: { userId: string; payrollManager: boolean }
): Promise<ClaimRow[]> {
  const rows = (await tx.execute(sql`
    SELECT c.id::text AS id, c.user_id::text AS uid, u.name, u.reporting_manager_id::text AS manager, c.category, c.claim_date::text AS d,
           c.amount::float AS amount, c.bill_number, c.description, c.status, c.decision_note, r.period::text AS run_period, r.status AS run_status
      FROM reimbursement_claims c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN pay_runs r ON r.id = c.pay_run_id
     WHERE c.tenant_id = ${tenantId}::uuid AND ${where}
     ORDER BY (c.status = 'submitted') DESC, c.claim_date DESC, c.created_at DESC
     LIMIT 300`)).rows as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const p = r.run_period ? String(r.run_period) : null;
    return {
      id: String(r.id),
      name: String(r.name ?? ""),
      category: String(r.category),
      claimDate: String(r.d),
      amount: Number(r.amount),
      billNumber: (r.bill_number as string) ?? null,
      description: (r.description as string) ?? null,
      status: String(r.status),
      decisionNote: (r.decision_note as string) ?? null,
      // An approved claim on an approved run is final; on a draft it can still be rejected.
      inRun: p && r.run_status !== "draft" ? `${MON[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : null,
      canDecide: decider ? String(r.uid) !== decider.userId && (decider.payrollManager || r.manager === decider.userId) : false,
    };
  });
}
