/**
 * What recording or changing a fixed deposit sets in motion. Call
 * `syncFdAutomations` inside the same withTenant() tx as every FD write.
 *
 *   1. Maturity → an expected inflow (source fd_maturity) for the maturity
 *      amount on the maturity date. Its reminder task — the existing inflow
 *      machinery in lib/inflows/reminder.ts — reaches the deposit's RM
 *      FD_REMIND_DAYS before, so the conversation about where the money goes
 *      next happens before the bank auto-renews it. The deposit owns the
 *      inflow's amount and date; the RM records the outcome on the inflow.
 *      Renewed, closed early, cancelled or deleted → the inflow is
 *      cancelled (no money is coming) and its reminder with it.
 *   2. Active → the Cross-sell card's "FD / Bonds / NCD" becomes "Held with
 *      us", and the client's open opportunity for it is won.
 */

import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { expectedInflows, fixedDeposits, type FixedDeposit } from "@/db/schema";
import { sql } from "drizzle-orm";
import { syncInflowReminder } from "@/lib/inflows/reminder";
import { onProductBooked } from "@/lib/opportunities/journey";
import { formatMoney } from "@/lib/format";
import { indiaToday, isLive } from "./terms";

export const FD_REMIND_DAYS = 15;
export const FD_PRODUCT = "fd_bonds_ncd";

type Actor = { tenantId: string; userId: string };

/** The amount that comes back on the maturity date. */
export function maturityInflowAmount(fd: Pick<FixedDeposit, "maturityAmount" | "principal" | "payout">): string {
  if (fd.payout === "cumulative" && fd.maturityAmount != null) return String(fd.maturityAmount);
  return String(fd.principal);
}

export async function syncFdAutomations(tx: Tx, actor: Actor, fd: FixedDeposit, opts: { deleted?: boolean } = {}) {
  const wantsInflow = !opts.deleted && isLive(fd.status) && String(fd.maturityDate) >= indiaToday();
  const moneyNotComing = opts.deleted || ["renewed", "closed_early", "cancelled"].includes(fd.status);

  let inflow = fd.inflowId
    ? (await tx.select().from(expectedInflows)
        .where(and(eq(expectedInflows.id, fd.inflowId), eq(expectedInflows.tenantId, actor.tenantId))).limit(1))[0] ?? null
    : null;

  const note = `Fixed deposit — ${fd.issuer}${fd.fdNumber ? ` (${fd.fdNumber})` : ""}${fd.autoRenew ? ", set to auto-renew" : ""}.`;

  if (wantsInflow) {
    const amount = maturityInflowAmount(fd);
    if (!inflow) {
      [inflow] = await tx.insert(expectedInflows).values({
        tenantId: actor.tenantId,
        investorId: fd.investorId,
        ownerId: fd.rmId,
        sourceType: "fd_maturity",
        expectedAmount: amount,
        expectedOn: String(fd.maturityDate),
        confidence: "high",
        status: "expected",
        remindDaysBefore: FD_REMIND_DAYS,
        notes: note,
        createdBy: actor.userId,
      } as any).returning();
      await tx.update(fixedDeposits).set({ inflowId: inflow.id }).where(eq(fixedDeposits.id, fd.id));
    } else {
      // Revive an inflow cancelled by an earlier status (e.g. reopened from cancelled).
      const status = inflow.status === "cancelled" ? "expected" : inflow.status;
      await tx.update(expectedInflows).set({
        ownerId: fd.rmId, expectedAmount: amount, expectedOn: String(fd.maturityDate), status, notes: note, updatedAt: new Date(),
      } as any).where(eq(expectedInflows.id, inflow.id));
      inflow = { ...inflow, ownerId: fd.rmId, expectedAmount: amount, expectedOn: String(fd.maturityDate), status } as typeof inflow;
    }
  } else if (inflow && moneyNotComing && inflow.status !== "cancelled") {
    await tx.update(expectedInflows).set({ status: "cancelled", updatedAt: new Date() }).where(eq(expectedInflows.id, inflow.id));
    inflow = { ...inflow, status: "cancelled" };
  }

  if (inflow && (wantsInflow || moneyNotComing)) {
    const taskId = await syncInflowReminder(tx, actor.tenantId, actor.userId, {
      id: inflow.id,
      investorId: inflow.investorId,
      ownerId: inflow.ownerId,
      sourceType: "fd_maturity",
      expectedAmount: inflow.expectedAmount,
      expectedOn: String(inflow.expectedOn),
      remindDaysBefore: inflow.remindDaysBefore,
      reminderTaskId: inflow.reminderTaskId ?? null,
      status: inflow.status,
    });
    if (taskId && taskId !== inflow.reminderTaskId) {
      await tx.update(expectedInflows).set({ reminderTaskId: taskId }).where(eq(expectedInflows.id, inflow.id));
    }
  }

  if (!opts.deleted && fd.status === "active") {
    await tx.execute(sql`
      UPDATE investors
         SET cross_sell = COALESCE(cross_sell, '{}'::jsonb) || jsonb_build_object(${FD_PRODUCT}::text, 'held_with_us'),
             updated_at = now()
       WHERE id = ${fd.investorId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND COALESCE(cross_sell ->> ${FD_PRODUCT}, '') <> 'held_with_us'
    `);
    await onProductBooked(tx, actor, fd.investorId, FD_PRODUCT,
      `fixed deposit of ${formatMoney(Number(fd.principal))} with ${fd.issuer} recorded`);
  }
}
