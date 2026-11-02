/**
 * The DPDP rights-request register (privacy_requests, migration 0256). The
 * rules — deadline, retention, what erasing a lead blanks — are in
 * requests-core.ts; this file reads and writes. Callers are inside withTenant.
 *
 * - A request is a TASK for whoever handles it (subject "compliance", meta
 *   `privacyRequestId`), due 15 days before the 90-day deadline, so the
 *   escalation ladder reaches the manager in time. Closing the request
 *   completes the task.
 * - Erasing a LEAD blanks every personal field and removes what was said and
 *   sent to them; the row stays so the pipeline's counts do not change.
 * - Erasing a CLIENT goes through `retentionVerdict`: someone who still holds
 *   money, or is still a client, cannot be erased; a former client is kept for
 *   five years after the relationship ended (marketing stops at once); after
 *   that — or a client with no financial records at all — is erased for good
 *   with the same purge as the Trash (lib/investors/purge.ts).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { activities, communications, consents, financialDiscoveries, leads, privacyRequests, shareTokens, tasks } from "@/db/schema";
import { holdsMoneySql } from "@/lib/investors/holds-money";
import { purgeInvestorsChunk } from "@/lib/investors/purge";
import { recordAudit } from "@/lib/audit";
import {
  LEAD_ERASE_PATCH,
  REQUEST_TYPES,
  dueAtFor,
  requestReference,
  retentionVerdict,
  taskDueFor,
  type ClientFacts,
  type RequestChannel,
  type RequestType,
  type RetentionVerdict,
} from "./requests-core";

export type Subject = { type: "lead" | "investor"; id: string };
type Actor = { tenantId: string; userId: string };

export async function createPrivacyRequest(
  tx: Tx,
  actor: Actor,
  input: {
    subject: Subject | null;
    requesterName: string;
    requesterEmail?: string | null;
    requesterPhone?: string | null;
    type: RequestType;
    channel: RequestChannel;
    details?: string | null;
    receivedAt: Date;
    assigneeId?: string | null;
  }
): Promise<{ id: string; reference: string }> {
  // One number per firm per year, without two requests taking the same one.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`privacy_requests:${actor.tenantId}`}))`);
  const year = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(input.receivedAt)
  );
  const seqRow = await tx.execute(sql`
    SELECT count(*)::int AS n FROM privacy_requests
     WHERE tenant_id = ${actor.tenantId}::uuid AND reference LIKE ${`PR-${year}-%`}`);
  const reference = requestReference(year, Number((seqRow.rows[0] as { n: number }).n) + 1);
  const dueAt = dueAtFor(input.receivedAt);
  const assigneeId = input.assigneeId || actor.userId;

  const [row] = await tx
    .insert(privacyRequests)
    .values({
      tenantId: actor.tenantId,
      reference,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail || null,
      requesterPhone: input.requesterPhone || null,
      type: input.type,
      channel: input.channel,
      details: input.details || null,
      receivedAt: input.receivedAt,
      dueAt,
      assigneeId,
      createdBy: actor.userId,
    })
    .returning({ id: privacyRequests.id });

  const [task] = await tx
    .insert(tasks)
    .values({
      tenantId: actor.tenantId,
      subjectType: "compliance",
      subjectId: row.id,
      relatedInvestorId: input.subject?.type === "investor" ? input.subject.id : null,
      relatedLeadId: input.subject?.type === "lead" ? input.subject.id : null,
      department: "compliance",
      type: "privacy_request",
      title: `Privacy request ${reference}: ${REQUEST_TYPES[input.type].split(" —")[0]} — ${input.requesterName}`,
      description: `Answer by ${dueAt.toISOString().slice(0, 10)} (90 days from receipt, DPDP Rules 2025). Open the request in Compliance → Privacy requests.`,
      priority: "high",
      status: "open",
      assigneeId,
      dueAt: taskDueFor(dueAt),
      meta: { privacyRequestId: row.id },
    } as typeof tasks.$inferInsert)
    .returning({ id: tasks.id });

  await tx.update(privacyRequests).set({ taskId: task.id }).where(eq(privacyRequests.id, row.id));
  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: "privacy.request_created",
    entityType: "privacy_request", entityId: row.id, after: { reference, type: input.type, channel: input.channel },
  });
  return { id: row.id, reference };
}

export async function markIdentityVerified(tx: Tx, actor: Actor, id: string): Promise<void> {
  await tx
    .update(privacyRequests)
    .set({ identityVerifiedAt: new Date(), identityVerifiedBy: actor.userId, updatedAt: new Date() })
    .where(and(eq(privacyRequests.tenantId, actor.tenantId), eq(privacyRequests.id, id)));
  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: "privacy.identity_verified",
    entityType: "privacy_request", entityId: id,
  });
}

export async function closePrivacyRequest(
  tx: Tx,
  actor: Actor,
  id: string,
  status: "completed" | "rejected",
  outcome: string
): Promise<void> {
  const [r] = await tx
    .update(privacyRequests)
    .set({ status, outcome, closedAt: new Date(), closedBy: actor.userId, updatedAt: new Date() })
    .where(and(eq(privacyRequests.tenantId, actor.tenantId), eq(privacyRequests.id, id)))
    .returning({ taskId: privacyRequests.taskId });
  if (r?.taskId) {
    await tx
      .update(tasks)
      .set({ status: status === "completed" ? "completed" : "cancelled", updatedAt: new Date() } as Partial<typeof tasks.$inferInsert>)
      .where(and(eq(tasks.tenantId, actor.tenantId), eq(tasks.id, r.taskId), inArray(tasks.status, ["open", "in_progress", "blocked"])));
  }
  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: `privacy.request_${status}`,
    entityType: "privacy_request", entityId: id, after: { outcome },
  });
}

/** The facts `retentionVerdict` needs about one client. */
export async function clientFacts(tx: Tx, tenantId: string, investorId: string): Promise<ClientFacts | null> {
  const r = await tx.execute(sql`
    SELECT i.status, i.exited_at,
           ${holdsMoneySql("i")} AS holds_money,
           (EXISTS (SELECT 1 FROM folios f WHERE f.tenant_id = i.tenant_id AND f.investor_id = i.id)
            OR EXISTS (SELECT 1 FROM transactions t WHERE t.tenant_id = i.tenant_id AND t.investor_id = i.id)) AS has_records
      FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid AND i.id = ${investorId}::uuid`);
  const row = r.rows[0] as { status: string | null; exited_at: string | Date | null; holds_money: boolean; has_records: boolean } | undefined;
  if (!row) return null;
  return {
    holdsMoney: !!row.holds_money,
    hasFinancialRecords: !!row.has_records,
    status: row.status,
    exitedAt: row.exited_at ? new Date(row.exited_at) : null,
  };
}

export async function erasureVerdict(tx: Tx, tenantId: string, subject: Subject): Promise<RetentionVerdict | null> {
  if (subject.type === "lead") {
    const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, subject.id)));
    return l ? { kind: "erase" } : null;
  }
  const facts = await clientFacts(tx, tenantId, subject.id);
  return facts ? retentionVerdict(facts) : null;
}

/** Blank a lead and remove what was sent and noted about them. */
async function eraseLeads(tx: Tx, tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx.update(leads).set({ ...LEAD_ERASE_PATCH, updatedAt: new Date() } as unknown as Partial<typeof leads.$inferInsert>)
    .where(and(eq(leads.tenantId, tenantId), inArray(leads.id, ids)));
  await tx.delete(communications).where(and(eq(communications.tenantId, tenantId), inArray(communications.leadId, ids)));
  await tx.delete(activities).where(and(eq(activities.tenantId, tenantId), eq(activities.subjectType, "lead"), inArray(activities.subjectId, ids)));
  await tx.delete(shareTokens).where(and(eq(shareTokens.tenantId, tenantId), eq(shareTokens.subjectType, "lead"), inArray(shareTokens.subjectId, ids)));
  await tx.delete(financialDiscoveries).where(
    and(eq(financialDiscoveries.tenantId, tenantId), eq(financialDiscoveries.subjectType, "lead"), inArray(financialDiscoveries.subjectId, ids))
  );
  await tx.delete(tasks).where(and(eq(tasks.tenantId, tenantId), inArray(tasks.relatedLeadId, ids), sql`${tasks.type} <> 'privacy_request'`));
}

export type ErasureResult = { result: "erased" } | { result: "retained"; until: string };

/**
 * Carry out an erasure request. Refuses (throws 409) when the verdict is
 * "blocked" — the caller shows the reason before offering the button.
 */
export async function eraseSubject(tx: Tx, actor: Actor, requestId: string, subject: Subject): Promise<ErasureResult> {
  const verdict = await erasureVerdict(tx, actor.tenantId, subject);
  if (!verdict) throw Object.assign(new Error("That record no longer exists."), { status: 404 });
  if (verdict.kind === "blocked") throw Object.assign(new Error(verdict.reason), { status: 409 });

  let out: ErasureResult;
  if (verdict.kind === "retain") {
    // Kept by law; what can stop now is marketing.
    await tx
      .update(consents)
      .set({ status: "revoked", updatedAt: new Date() } as Partial<typeof consents.$inferInsert>)
      .where(and(eq(consents.tenantId, actor.tenantId), eq(consents.investorId, subject.id), inArray(consents.scope, ["marketing", "all"])));
    out = { result: "retained", until: verdict.until.toISOString().slice(0, 10) };
  } else if (subject.type === "lead") {
    await eraseLeads(tx, actor.tenantId, [subject.id]);
    out = { result: "erased" };
  } else {
    // The lead they came from carries the same personal data.
    const src = await tx.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.tenantId, actor.tenantId), eq(leads.convertedInvestorId, subject.id)));
    await eraseLeads(tx, actor.tenantId, src.map((l) => l.id));
    const removed = await purgeInvestorsChunk(tx, actor.tenantId, [subject.id]);
    if (removed !== 1) throw Object.assign(new Error("The client could not be erased — they may hold money with the registrar."), { status: 409 });
    out = { result: "erased" };
  }

  await tx
    .update(privacyRequests)
    .set({ erasureResult: out.result === "erased" ? "erased" : `retained_until:${out.until}`, updatedAt: new Date() })
    .where(and(eq(privacyRequests.tenantId, actor.tenantId), eq(privacyRequests.id, requestId)));
  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: "privacy.erasure",
    entityType: "privacy_request", entityId: requestId, after: { subjectType: subject.type, ...out },
  });
  return out;
}
