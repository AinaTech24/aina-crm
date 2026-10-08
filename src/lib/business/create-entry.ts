/**
 * Creating a Business entry — one implementation for the Business entries
 * form (POST /api/business-entries) and for a financial task that books
 * business (POST /api/tasks), so an entry looks the same whichever way it
 * arrived and Operations never keys the same transaction twice.
 *
 * Also: registering an entry's SIP lines in the SIP book, and keeping a
 * task-created entry's status in step with its task
 * (draft → confirmed when the task is completed, cancelled with the task).
 * SERVER-ONLY.
 */

import { v4 as uuid } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { businessEntries, businessEntryLines, eventsOutbox, sips } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { refreshActiveSipAmount } from "@/lib/metrics/sip";
import { computeTotals, normalizeLine, type EntryInputT } from "./entry-input";
import { syncJourneyWithEntry } from "./journey";

/** A business line's frequency as a SIP frequency. Every real SIP frequency
 *  maps to itself — half-yearly used to fall through to monthly, which counted
 *  a ₹60,000 half-yearly SIP as ₹60,000 a month in the SIP book. `one_time`
 *  is not a SIP frequency at all; it stays monthly as before. */
export function toSipFrequency(f: string | null | undefined): "monthly" | "quarterly" | "weekly" | "fortnightly" | "half_yearly" | "yearly" {
  return f === "quarterly" || f === "weekly" || f === "fortnightly" || f === "half_yearly" || f === "yearly" ? f : "monthly";
}

/** First debit date: the next occurrence of `sipDay` (1..28) on/after the SIP's
 *  start date. Returns the start date itself if no day was captured. */
export function nextInstallmentDate(startISO: string, sipDay: string | null | undefined): string {
  if (!sipDay) return startISO;
  const day = Math.min(28, Math.max(1, Number(sipDay)));
  const base = new Date(`${startISO}T00:00:00Z`);
  let d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day));
  if (d.getTime() < base.getTime()) d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, day));
  return d.toISOString().slice(0, 10);
}

type Ctx = { tenantId: string; userId: string; clientMeta?: Record<string, unknown> };

/**
 * Insert a Business entry (header + lines), emit business_entry.created and
 * audit it. `registerSips` adds every SIP line to the SIP book now — the form
 * does that on create; a task-created DRAFT waits until its task is completed.
 */
export async function insertBusinessEntry(
  tx: Tx,
  ctx: Ctx,
  b: EntryInputT,
  opts: { registerSips: boolean; source?: { taskId: string } },
): Promise<{ entryId: string; total: number }> {
  const lines = b.lines.map(normalizeLine);
  const totals = computeTotals(lines);
  const rmId = b.rmId ?? ctx.userId;
  const entryId = uuid();

  await tx.insert(businessEntries).values({
    id: entryId,
    tenantId: ctx.tenantId,
    investorId: b.investorId ?? null,
    clientName: b.clientName,
    productType: b.productType,
    platform: b.platform ?? null,
    businessDate: b.businessDate,
    status: b.status,
    rmId,
    amcName: b.amcName ?? null,
    folioNo: b.folioNo ?? null,
    totalAmount: String(totals.total),
    assetBreakup: totals.assetBreakup,
    liquidNet: String(totals.liquidNet),
    notes: b.notes ?? null,
    createdById: ctx.userId,
  } as any);

  await tx.insert(businessEntryLines).values(
    lines.map((l, i) => ({
      id: uuid(),
      tenantId: ctx.tenantId,
      entryId,
      schemeCode: l.schemeCode ?? null,
      schemeName: l.schemeName,
      amcName: l.amcName ?? null,
      assetCategory: l.assetCategory ?? null,
      assetClass: l.assetClass,
      txnType: l.txnType,
      amount: String(l.amount),
      units: l.units != null ? String(l.units) : null,
      frequency: l.frequency ?? null,
      sipDate: l.txnType === "sip" ? l.sipDate ?? null : null,
      fromSchemeCode: l.fromSchemeCode ?? null,
      fromSchemeName: l.fromSchemeName ?? null,
      fromAssetClass: l.fromAssetClass ?? null,
      folioNo: l.folioNo ?? null,
      notes: l.notes ?? null,
      sortOrder: i,
    })) as any,
  );

  if (opts.registerSips) await registerEntrySips(tx, ctx, entryId);
  // Booking business is the client's first order: move their journey.
  await syncJourneyWithEntry(tx, ctx.tenantId, { investorId: b.investorId, productType: b.productType, status: b.status });

  // business_entry.created lets workflow rules react (e.g. a transaction
  // confirmation to the client). The snapshot carries what their criteria and
  // template tokens read.
  await tx.insert(eventsOutbox).values({
    tenantId: ctx.tenantId,
    kind: "business_entry.created",
    entityType: "business_entry",
    entityId: entryId,
    after: {
      id: entryId,
      investor_id: b.investorId ?? null,
      client_name: b.clientName,
      product_type: b.productType,
      status: b.status,
      total_amount: String(totals.total),
      amc_name: b.amcName ?? null,
      platform: b.platform ?? null,
      rm_id: rmId,
      business_date: b.businessDate,
    } as any,
    meta: { userId: ctx.userId, ...(opts.source ? { taskId: opts.source.taskId } : {}) } as any,
  } as any);

  await recordAudit(tx, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    action: "business_entry.create",
    entityType: "business_entry",
    entityId: entryId,
    after: {
      clientName: b.clientName,
      productType: b.productType,
      total: totals.total,
      lines: lines.length,
      ...(opts.source ? { fromTaskId: opts.source.taskId } : {}),
    } as any,
    ...(ctx.clientMeta ?? {}),
  });

  return { entryId, total: totals.total };
}

/**
 * Put an entry's SIP lines in the SIP book, so they show in the SIP Tracker
 * and their instalment day drives the reminder workflows. Only for an entry
 * with a linked client. Call it ONCE per entry (on create, or when a
 * task-created draft is confirmed).
 */
export async function registerEntrySips(tx: Tx, ctx: Ctx, entryId: string): Promise<number> {
  const [entry] = await tx
    .select()
    .from(businessEntries)
    .where(and(eq(businessEntries.id, entryId), eq(businessEntries.tenantId, ctx.tenantId)))
    .limit(1);
  if (!entry?.investorId) return 0;
  // Once per entry: a task completed, reopened and completed again must not
  // put the same SIPs in the book twice. sip.created events carry the entry.
  const already = await tx.execute(sql`
    SELECT 1 FROM events_outbox
     WHERE tenant_id = ${ctx.tenantId}::uuid AND kind = 'sip.created' AND meta->>'entryId' = ${entryId}
     LIMIT 1`);
  if (already.rows.length) return 0;
  const lines = await tx
    .select()
    .from(businessEntryLines)
    .where(and(eq(businessEntryLines.entryId, entryId), eq(businessEntryLines.txnType, "sip" as any)));
  if (!lines.length) return 0;

  const rows = lines.map((l) => ({
    id: uuid(),
    tenantId: ctx.tenantId,
    investorId: entry.investorId!,
    schemeCode: l.schemeCode ?? null,
    schemeName: l.schemeName,
    amcName: l.amcName ?? null,
    folioNumber: l.folioNo ?? entry.folioNo ?? null,
    amount: String(l.amount),
    frequency: toSipFrequency(l.frequency),
    sipDate: l.sipDate ?? null,
    startDate: entry.businessDate,
    nextInstallmentAt: nextInstallmentDate(String(entry.businessDate), l.sipDate),
    status: "active" as const,
    rmId: entry.rmId ?? ctx.userId,
  }));
  await tx.insert(sips).values(rows as any);
  await refreshActiveSipAmount(tx, { tenantId: ctx.tenantId, investorIds: [entry.investorId] });
  await tx.insert(eventsOutbox).values(
    rows.map((r) => ({
      tenantId: ctx.tenantId,
      kind: "sip.created",
      entityType: "sip",
      entityId: r.id,
      after: r as any,
      meta: { source: "business_entry", entryId } as any,
    })) as any,
  );
  return rows.length;
}

/**
 * Keep a task-created Business entry in step with its task:
 *   completed → a draft entry becomes confirmed and its SIPs are registered;
 *   cancelled / moved to Trash → the entry is cancelled (out of every report);
 *   reopened / restored → an entry the task had cancelled goes back to draft.
 * An entry someone has emailed or edited past draft is left alone except for
 * a cancellation. No-op when the task booked no entry.
 */
export async function syncTaskBusinessEntry(
  tx: Tx,
  ctx: Ctx,
  task: { id: string; meta: unknown; status?: string | null },
  event: "completed" | "cancelled" | "reopened",
): Promise<void> {
  const meta = (task.meta && typeof task.meta === "object" ? task.meta : {}) as Record<string, unknown>;
  const entryId = typeof meta.businessEntryId === "string" ? meta.businessEntryId : null;
  if (!entryId) return;
  const [entry] = await tx
    .select({ id: businessEntries.id, status: businessEntries.status, investorId: businessEntries.investorId, productType: businessEntries.productType })
    .from(businessEntries)
    .where(and(eq(businessEntries.id, entryId), eq(businessEntries.tenantId, ctx.tenantId)))
    .limit(1);
  if (!entry) return;

  let next: "confirmed" | "cancelled" | "draft" | null = null;
  if (event === "completed" && entry.status === "draft") next = "confirmed";
  else if (event === "cancelled" && entry.status !== "cancelled") next = "cancelled";
  // Reopened / restored: back to draft — or straight to confirmed for a task
  // that is already completed (restored from Trash).
  else if (event === "reopened" && entry.status === "cancelled") next = task.status === "completed" ? "confirmed" : "draft";
  if (!next) return;

  await tx
    .update(businessEntries)
    .set({ status: next, updatedAt: sql`now()` } as any)
    .where(and(eq(businessEntries.id, entryId), eq(businessEntries.tenantId, ctx.tenantId)));
  // SIPs join the SIP book on the step to confirmed (once — registerEntrySips
  // skips an entry whose SIPs are already in the book).
  if (next === "confirmed") await registerEntrySips(tx, ctx, entryId);
  await syncJourneyWithEntry(tx, ctx.tenantId, { investorId: entry.investorId, productType: entry.productType, status: next });
  await recordAudit(tx, {
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    action: "business_entry.status_from_task",
    entityType: "business_entry",
    entityId: entryId,
    before: { status: entry.status } as any,
    after: { status: next, taskId: task.id, event } as any,
    ...(ctx.clientMeta ?? {}),
  });
}
