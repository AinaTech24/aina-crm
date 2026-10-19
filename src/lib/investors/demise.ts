/**
 * A client's date of demise (migration 0241).
 *
 * Recording one is a decision about the whole relationship, so it is applied in
 * one place — the investor PATCH / POST call it in their own transaction:
 *
 *   - the client becomes Inactive (unless already Closed / Exited — those stay);
 *   - every SIP that is still Active, Paused or Pending is Stopped, with the
 *     date in its remarks, so the SIP book and the "Monthly SIP" cache stop
 *     counting money that will never be debited;
 *   - orders still waiting (Pending / Submitted) are Cancelled. Processed
 *     transactions are the registrar's history and are never deleted;
 *   - the client's own open tasks stay — someone has to run the claim.
 *
 * Clearing the date (it was a mistake) returns an Inactive client to Active.
 * SIPs stay stopped: restarting a debit is the registrar's call, not ours.
 * The RTA import does not turn a stopped SIP of a deceased client back on
 * (lib/rta/process.ts).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { refreshActiveSipAmount } from "@/lib/metrics/sip";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today in India as YYYY-MM-DD. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** null when the date is acceptable, else what is wrong with it. */
export function demiseDateError(day: string, dob?: string | null, today = indiaToday()): string | null {
  if (!ISO_DAY.test(day) || Number.isNaN(Date.parse(day))) return "Enter the date of demise as a valid date.";
  if (day > today) return "The date of demise cannot be in the future.";
  if (dob && ISO_DAY.test(dob.slice(0, 10)) && day < dob.slice(0, 10)) return "The date of demise cannot be before the date of birth.";
  return null;
}

export type DemiseEffects = { sipsStopped: number; ordersCancelled: number; statusChanged: boolean };

/**
 * Stop a client's activity in the CRM: their live SIPs become Stopped (the
 * reason goes into the remarks) and orders still waiting are Cancelled. Shared
 * by a recorded demise and by marking a client Inactive by hand.
 */
async function stopClientActivity(
  tx: Tx, args: { tenantId: string; investorId: string; reason: string },
): Promise<Pick<DemiseEffects, "sipsStopped" | "ordersCancelled">> {
  const { tenantId, investorId, reason } = args;
  const sips = await tx.execute(sql`
    UPDATE sips
       SET status = 'stopped', updated_at = now(),
           remarks = left(${reason}::text || COALESCE(' · ' || NULLIF(remarks, ''), ''), 500)
     WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid
       AND status IN ('active', 'paused', 'pending')
    RETURNING id
  `);
  const orders = await tx.execute(sql`
    UPDATE transactions SET status = 'cancelled', updated_at = now()
     WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid
       AND status IN ('pending', 'submitted')
    RETURNING id
  `);
  if (sips.rows.length) await refreshActiveSipAmount(tx, { investorIds: [investorId] });
  return { sipsStopped: sips.rows.length, ordersCancelled: orders.rows.length };
}

/** Apply a newly recorded date of demise. Call after the investor row is written. */
export async function applyDemise(
  tx: Tx, args: { tenantId: string; investorId: string; actorUserId: string | null; day: string },
): Promise<DemiseEffects> {
  const { tenantId, investorId, actorUserId, day } = args;
  const status = await tx.execute(sql`
    UPDATE investors SET status = 'inactive', updated_at = now()
     WHERE id = ${investorId}::uuid AND tenant_id = ${tenantId}::uuid
       AND status IN ('active', 'dormant', 'redemption_risk')
    RETURNING id
  `);
  const stopped = await stopClientActivity(tx, { tenantId, investorId, reason: `Stopped — client deceased on ${day}` });
  const effects = { ...stopped, statusChanged: status.rows.length > 0 };
  await recordAudit(tx, {
    tenantId, actorUserId, action: "investor.demise_recorded", entityType: "investor", entityId: investorId,
    after: { dateOfDemise: day, ...effects },
  });
  return effects;
}

/** A client was marked Inactive by hand: stop their SIPs and cancel pending orders. */
export async function applyInactive(
  tx: Tx, args: { tenantId: string; investorId: string; actorUserId: string | null },
): Promise<DemiseEffects> {
  const stopped = await stopClientActivity(tx, { ...args, reason: "Stopped — client marked inactive" });
  const effects = { ...stopped, statusChanged: true };
  await recordAudit(tx, {
    tenantId: args.tenantId, actorUserId: args.actorUserId, action: "investor.marked_inactive",
    entityType: "investor", entityId: args.investorId, after: effects,
  });
  return effects;
}

/** The date was cleared: an Inactive client is Active again. SIPs are left as they are. */
export async function clearDemise(
  tx: Tx, args: { tenantId: string; investorId: string; actorUserId: string | null },
): Promise<void> {
  await tx.execute(sql`
    UPDATE investors SET status = 'active', updated_at = now()
     WHERE id = ${args.investorId}::uuid AND tenant_id = ${args.tenantId}::uuid AND status = 'inactive' AND merged_into_id IS NULL
  `);
  await recordAudit(tx, {
    tenantId: args.tenantId, actorUserId: args.actorUserId, action: "investor.demise_cleared",
    entityType: "investor", entityId: args.investorId, after: { dateOfDemise: null },
  });
}
