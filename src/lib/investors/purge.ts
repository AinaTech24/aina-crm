/**
 * Permanent erasure of clients, set-based.
 *
 * The single-client purge in `/api/investors/[id]?purge=1` runs ~15 statements
 * inside its own request and transaction. Emptying a Trash bin of 25,000 clients
 * that way is 25,000 HTTP round trips and ~375,000 statements, which is why
 * clearing even 500 took minutes.
 *
 * This does the SAME cleanup with `inArray`, so a batch of any size costs the
 * same ~15 statements. The table list is kept deliberately identical to the
 * single-client path — a client purged in bulk must not leave behind rows that a
 * client purged one at a time would not.
 *
 * Ordering matters: audit first (the row is about to vanish), then the non-FK
 * references, then detach the pointers on records that legitimately outlive the
 * client, then the clients themselves — the rest cascades (migration 0131).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { holdsMoneySql } from "@/lib/investors/holds-money";
import type { Tx } from "@/db/client";
import { minorOwnRiskColumns } from "@/lib/risk-profile/own-assessment";
import {
  activities,
  auditLog,
  complianceDocuments,
  families,
  financialDiscoveries,
  investors,
  leads,
  onboardingPipelines,
  reviewMeetings,
  riskProfileResponses,
  shareTokens,
  sipRejections,
  tasks,
} from "@/db/schema";

/**
 * Clients erased per transaction. Bounded so one statement never locks the
 * whole table for long on a burstable instance, and so a failure costs one
 * batch rather than the entire job.
 */
export const PURGE_TX_CHUNK = 500;

/** Clients erased per HTTP request, so a large Trash empties over several calls
 *  instead of one request that outlives the gateway timeout. */
export const PURGE_REQUEST_MAX = 5_000;

/**
 * Permanently erase `ids` (already tenant-checked by the caller's scope).
 * Returns how many client rows were actually removed.
 */
export async function purgeInvestorsChunk(tx: Tx, tenantId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;

  const T = tenantId;
  const scope = and(eq(investors.tenantId, T), inArray(investors.id, ids));

  // What is about to be destroyed, recorded while it still exists. A client
  // who still holds money with the registrar is never erased
  // (lib/investors/holds-money.ts) — it is restored instead.
  const doomed = await tx
    .select({ id: investors.id, name: investors.name, pan: investors.pan })
    .from(investors)
    .where(and(scope, sql`NOT ${holdsMoneySql("investors")}`));
  if (!doomed.length) return 0;

  const realIds = doomed.map((d) => d.id);

  await tx.insert(auditLog).values({
    tenantId: T,
    actorUserId: null,
    action: "investor.bulk_purge",
    entityType: "investor",
    entityId: T,
    before: {
      count: doomed.length,
      // Enough to identify what was erased without copying the whole book into
      // the audit row.
      clients: doomed.slice(0, 200).map((d) => ({ id: d.id, name: d.name, pan: d.pan })),
      truncated: doomed.length > 200,
    } as any,
  } as any);

  // Polymorphic / non-FK references — the cascade never reaches these.
  await tx
    .delete(complianceDocuments)
    .where(
      and(
        eq(complianceDocuments.tenantId, T),
        eq(complianceDocuments.relatedEntityType, "investor"),
        inArray(complianceDocuments.relatedEntityId, realIds)
      )
    );
  await tx.delete(tasks).where(and(eq(tasks.tenantId, T), inArray(tasks.relatedInvestorId, realIds)));
  await tx.delete(reviewMeetings).where(and(eq(reviewMeetings.tenantId, T), inArray(reviewMeetings.investorId, realIds)));
  await tx.delete(sipRejections).where(and(eq(sipRejections.tenantId, T), inArray(sipRejections.investorId, realIds)));
  await tx
    .delete(onboardingPipelines)
    .where(and(eq(onboardingPipelines.tenantId, T), inArray(onboardingPipelines.investorId, realIds)));
  await tx
    .delete(riskProfileResponses)
    .where(and(eq(riskProfileResponses.tenantId, T), inArray(riskProfileResponses.investorId, realIds)));
  await tx
    .delete(activities)
    .where(and(eq(activities.tenantId, T), eq(activities.subjectType, "investor"), inArray(activities.subjectId, realIds)));
  await tx
    .delete(shareTokens)
    .where(and(eq(shareTokens.tenantId, T), eq(shareTokens.subjectType, "investor"), inArray(shareTokens.subjectId, realIds)));
  await tx
    .delete(financialDiscoveries)
    .where(
      and(
        eq(financialDiscoveries.tenantId, T),
        eq(financialDiscoveries.subjectType, "investor"),
        inArray(financialDiscoveries.subjectId, realIds)
      )
    );

  // Records that outlive the client keep existing with the pointer detached.
  await tx
    .update(leads)
    .set({ convertedInvestorId: null } as any)
    .where(and(eq(leads.tenantId, T), inArray(leads.convertedInvestorId, realIds)));
  await tx
    .update(leads)
    .set({ referredByInvestorId: null } as any)
    .where(and(eq(leads.tenantId, T), inArray(leads.referredByInvestorId, realIds)));
  await tx
    .update(families)
    .set({ primaryInvestorId: null } as any)
    .where(and(eq(families.tenantId, T), inArray(families.primaryInvestorId, realIds)));
  // A minor whose guardian is being erased keeps their record, guardian cleared
  // — and the erased guardian's risk profile that migration 0234 copied onto
  // it goes too: the minor's own latest assessment, else none (G-1).
  const orphaned = await tx
    .update(investors)
    .set({ guardianInvestorId: null } as any)
    .where(and(eq(investors.tenantId, T), inArray(investors.guardianInvestorId, realIds)))
    .returning({ id: investors.id });
  for (const m of orphaned) {
    if (realIds.includes(m.id)) continue;
    const own = await minorOwnRiskColumns(tx, T, m.id);
    await tx.update(investors).set(own as any).where(and(eq(investors.tenantId, T), eq(investors.id, m.id)));
  }

  const removed = await tx
    .delete(investors)
    .where(and(eq(investors.tenantId, T), inArray(investors.id, realIds)))
    .returning({ id: investors.id });

  return removed.length;
}
