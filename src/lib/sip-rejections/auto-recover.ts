/**
 * Auto-Recover on a rejected SIP — what the button does, in one place.
 *
 *   1. raises the `transaction.failed.sip_rejection` event the "SIP rejection
 *      follow-up" automation listens for (its WhatsApp / email steps send only if
 *      that automation is switched on for the firm);
 *   2. gives the RM ONE high-priority task to get the SIP back (a second click
 *      does not add a second while the first is open);
 *   3. moves the rejection to "client contacted", with a follow-up date and a
 *      remark.
 *
 * It was written with column names that do not exist (eventKind, taskType,
 * investorId, status "todo") behind `as any`, so the database rejected every
 * click and the screen said "internal". The inserts here use the real columns
 * and are exercised against the database in tests/sip-auto-recover.test.ts.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { eventsOutbox, sipRejections, tasks } from "@/db/schema";

export type AutoRecoverInput = {
  tenantId: string;
  userId: string;
  rejection: {
    id: string;
    investorId: string;
    assignedRmId: string | null;
    reasonCategory: string | null;
    rejectionReason: string | null;
    rejectionAmount: string | number;
    rejectionDate: string;
    schemeName: string | null;
    remarks: string | null;
  };
  investor: { name: string | null; rmId: string | null } | null;
};

export async function autoRecoverRejection(
  tx: Tx,
  { tenantId, userId, rejection: rej, investor: inv }: AutoRecoverInput
): Promise<{ taskCreated: boolean; eventRaised: boolean }> {
  const rmId = rej.assignedRmId || inv?.rmId || userId;
  const reasonCategory = rej.reasonCategory || "insufficient_balance";
  const today = new Date().toISOString().slice(0, 10);

  // 1. The event. One per rejection per day: a double click raises it once.
  const raised = await tx
    .insert(eventsOutbox)
    .values({
      tenantId,
      kind: "transaction.failed.sip_rejection",
      entityType: "investor",
      entityId: rej.investorId,
      // The same fields the RTA rejection import puts on this event, so the
      // automation reads them the same way.
      after: {
        rejection_id: rej.id,
        reason_code: reasonCategory,
        reason: rej.rejectionReason ?? "",
        scheme_name: rej.schemeName || "Mutual Fund Scheme",
        amount: String(rej.rejectionAmount),
        order_date: rej.rejectionDate,
        investor_name: inv?.name ?? "Investor",
      },
      meta: { source: "auto-recover", userId, rejectionId: rej.id },
      dedupKey: `sip-auto-recover:${tenantId}:${rej.id}:${today}`,
    })
    .onConflictDoNothing({ target: eventsOutbox.dedupKey, where: sql`dedup_key IS NOT NULL` })
    .returning({ id: eventsOutbox.id });

  // 2. One open task per rejection.
  const open = await tx.execute(sql`
    SELECT 1 FROM tasks
     WHERE tenant_id = ${tenantId}::uuid
       AND meta ->> 'sipRejectionId' = ${rej.id}
       AND status NOT IN ('completed', 'cancelled')
     LIMIT 1
  `);
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 2); // 48h
  let taskCreated = false;
  if (!(open.rows?.length ?? 0)) {
    await tx.insert(tasks).values({
      tenantId,
      assigneeId: rmId,
      createdById: userId,
      subjectType: "investor",
      subjectId: rej.investorId,
      relatedInvestorId: rej.investorId,
      type: "sip_rejection_followup",
      title: `Recover rejected SIP: ${inv?.name || "Client"} (${rej.schemeName || "Scheme"})`,
      description:
        `SIP of ₹${rej.rejectionAmount} failed on ${rej.rejectionDate}. Reason: ${rej.rejectionReason || reasonCategory}. ` +
        "Contact the client to check the balance or update the mandate.",
      priority: "high",
      status: "open",
      dueAt,
      slaDueAt: dueAt,
      meta: { sipRejectionId: rej.id, autoRecover: true },
    });
    taskCreated = true;
  }

  // 3. The rejection itself.
  const stamp = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const remark =
    `⚡ [Auto-Recover ${stamp}]: recovery automation triggered` +
    (taskCreated ? " and a high-priority RM task created." : "; an RM task is already open.");
  await tx
    .update(sipRejections)
    .set({
      recoveryStatus: "client_contacted",
      statusChangedAt: new Date(),
      remarks: rej.remarks ? `${remark}\n${rej.remarks}` : remark,
      followUpDate: dueAt.toISOString().slice(0, 10),
      assignedRmId: rmId,
      updatedAt: new Date(),
    })
    .where(and(eq(sipRejections.id, rej.id), eq(sipRejections.tenantId, tenantId)));

  return { taskCreated, eventRaised: raised.length > 0 };
}
