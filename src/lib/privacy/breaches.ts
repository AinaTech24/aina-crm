/**
 * The personal-data breach register (data_breaches, migration 0257); rules
 * and the two notice texts are in breaches-core.ts. Callers are in withTenant.
 *
 * Logging a breach gives the person who logged it an urgent task due at the
 * 72-hour mark — the Board's detailed report — which is completed when the
 * report is marked sent.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { dataBreaches, tasks } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { breachReference, reportDueFor } from "./breaches-core";

type Actor = { tenantId: string; userId: string };

export const BREACH_TEXT_FIELDS = [
  "title", "description", "dataAffected", "cause", "consequences", "mitigation", "personSteps",
] as const;
export type BreachTextField = (typeof BREACH_TEXT_FIELDS)[number];

export async function createBreach(
  tx: Tx,
  actor: Actor,
  input: { title: string; detectedAt: Date; occurredAt: Date | null; description?: string | null; affectedCount?: number | null }
): Promise<{ id: string; reference: string }> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`data_breaches:${actor.tenantId}`}))`);
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(input.detectedAt));
  const n = await tx.execute(sql`
    SELECT count(*)::int AS n FROM data_breaches WHERE tenant_id = ${actor.tenantId}::uuid AND reference LIKE ${`BR-${year}-%`}`);
  const reference = breachReference(year, Number((n.rows[0] as { n: number }).n) + 1);
  const reportDueAt = reportDueFor(input.detectedAt);

  const [row] = await tx
    .insert(dataBreaches)
    .values({
      tenantId: actor.tenantId,
      reference,
      title: input.title,
      detectedAt: input.detectedAt,
      occurredAt: input.occurredAt,
      description: input.description || null,
      affectedCount: input.affectedCount ?? null,
      reportDueAt,
      createdBy: actor.userId,
    })
    .returning({ id: dataBreaches.id });

  await tx.insert(tasks).values({
    tenantId: actor.tenantId,
    subjectType: "compliance",
    subjectId: row.id,
    department: "compliance",
    type: "data_breach",
    title: `Breach ${reference}: send the Data Protection Board its report`,
    description: "DPDP Rules 2025, Rule 7: tell the Board and every affected person without delay, and send the Board a detailed report within 72 hours. Open it in Compliance → Data breaches.",
    priority: "urgent",
    status: "open",
    assigneeId: actor.userId,
    dueAt: reportDueAt,
    meta: { dataBreachId: row.id },
  } as typeof tasks.$inferInsert);

  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: "privacy.breach_logged",
    entityType: "data_breach", entityId: row.id, after: { reference, title: input.title },
  });
  return { id: row.id, reference };
}

export async function updateBreachDetails(
  tx: Tx,
  actor: Actor,
  id: string,
  patch: Partial<Record<Exclude<BreachTextField, "title">, string | null>> & { title?: string; affectedCount?: number | null; occurredAt?: Date | null }
): Promise<void> {
  await tx
    .update(dataBreaches)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(dataBreaches.tenantId, actor.tenantId), eq(dataBreaches.id, id)));
  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: "privacy.breach_updated",
    entityType: "data_breach", entityId: id, after: { fields: Object.keys(patch) },
  });
}

export type BreachStep = "board_intimated" | "board_report" | "people_notified" | "close";

export async function markBreachStep(tx: Tx, actor: Actor, id: string, step: BreachStep, count?: number | null): Promise<void> {
  const now = new Date();
  const set =
    step === "board_intimated" ? { boardIntimatedAt: now }
    : step === "board_report" ? { boardReportAt: now }
    : step === "people_notified" ? { peopleNotifiedAt: now, peopleNotifiedCount: count ?? null }
    : { status: "closed", closedAt: now };
  await tx
    .update(dataBreaches)
    .set({ ...set, updatedAt: now })
    .where(and(eq(dataBreaches.tenantId, actor.tenantId), eq(dataBreaches.id, id)));
  if (step === "board_report" || step === "close") {
    await tx
      .update(tasks)
      .set({ status: "completed", updatedAt: now } as Partial<typeof tasks.$inferInsert>)
      .where(
        and(
          eq(tasks.tenantId, actor.tenantId),
          eq(tasks.subjectType, "compliance"),
          eq(tasks.subjectId, id),
          eq(tasks.type, "data_breach"),
          inArray(tasks.status, ["open", "in_progress", "blocked"])
        )
      );
  }
  await recordAudit(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, action: `privacy.breach_${step}`,
    entityType: "data_breach", entityId: id, after: count != null ? { count } : undefined,
  });
}
