/**
 * RTA staging — public entry points (Phase 3B, SHADOW only).
 *
 *   shadowImport()        create a batch for a file and run it to a final state
 *   runShadowForImport()  the worker hook: after the existing importer has
 *                         finished a file, stage the same file in shadow — when
 *                         RTA_PIPELINE_MODE=shadow, and never able to affect
 *                         the existing import's result
 *   loadBatchReport()     the reconciliation report of one batch
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { rtaStagingBatches, rtaStagingChecks, rtaStagingEconomicTxns } from "@/db/schema/rta_staging";
import { resolvePipelineMode } from "./config";
import { createShadowBatch, runShadowBatch, type CreateBatchInput, type RunOptions } from "./pipeline";

export { rtaPipelineMode, resolvePipelineMode } from "./config";
export { createShadowBatch, runShadowBatch } from "./pipeline";

export async function shadowImport(input: CreateBatchInput, opts: RunOptions = {}) {
  const batchId = await createShadowBatch(input);
  const r = await runShadowBatch(input.tenantId, batchId, input.buf, opts);
  return { batchId, ...r };
}

/**
 * Worker hook. Returns what it did; NEVER throws — a staging failure is
 * recorded on the batch (state failed, with the error) and logged without
 * row content, and the existing import is untouched either way.
 */
export async function runShadowForImport(args: { tenantId: string; importId: string | null; fileName: string; fileRef: string; buf: Uint8Array; createdBy?: string | null }): Promise<{ ran: boolean; batchId?: string; state?: string; error?: string; refused?: string }> {
  let decision;
  try { decision = await resolvePipelineMode(args.tenantId); } catch (e) { return { ran: false, error: e instanceof Error ? e.message : String(e) }; }
  if (decision.mode !== "shadow") return { ran: false, refused: decision.refused };
  try {
    const r = await shadowImport({ tenantId: args.tenantId, importId: args.importId, fileName: args.fileName, fileRef: args.fileRef, buf: args.buf, createdBy: args.createdBy ?? null });
    return { ran: true, batchId: r.batchId, state: r.state };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).replace(/[A-Z]{5}[0-9]{4}[A-Z]/g, "<pan>");
    console.warn(`[rta-staging] shadow run for import ${args.importId} did not finish: ${message}`);
    return { ran: true, error: message };
  }
}

export async function loadBatchReport(tenantId: string, batchId: string) {
  return withTenant(tenantId, async (tx) => {
    const [batch] = await tx.select({
      id: rtaStagingBatches.id, importId: rtaStagingBatches.importId, mode: rtaStagingBatches.mode, rta: rtaStagingBatches.rta,
      reportCode: rtaStagingBatches.reportCode, recordKind: rtaStagingBatches.recordKind, fileName: rtaStagingBatches.fileName,
      fileChecksum: rtaStagingBatches.fileChecksum, parserVersion: rtaStagingBatches.parserVersion, state: rtaStagingBatches.state,
      attempt: rtaStagingBatches.attempt, rowCount: rtaStagingBatches.rowCount, counts: rtaStagingBatches.counts,
      stageLog: rtaStagingBatches.stageLog, error: rtaStagingBatches.error, sameFileAsBatchId: rtaStagingBatches.sameFileAsBatchId,
      rerunOfBatchId: rtaStagingBatches.rerunOfBatchId, periodStart: rtaStagingBatches.periodStart, periodEnd: rtaStagingBatches.periodEnd,
      asOfDate: rtaStagingBatches.asOfDate, createdAt: rtaStagingBatches.createdAt, completedAt: rtaStagingBatches.completedAt,
    }).from(rtaStagingBatches).where(and(eq(rtaStagingBatches.tenantId, tenantId), eq(rtaStagingBatches.id, batchId)));
    if (!batch) return null;
    const checks = await tx.select({
      code: rtaStagingChecks.checkCode, scope: rtaStagingChecks.scope, scopeRef: rtaStagingChecks.scopeRef, status: rtaStagingChecks.status,
      expected: rtaStagingChecks.expected, actual: rtaStagingChecks.actual, tolerance: rtaStagingChecks.tolerance, detail: rtaStagingChecks.detail,
    }).from(rtaStagingChecks).where(and(eq(rtaStagingChecks.tenantId, tenantId), eq(rtaStagingChecks.batchId, batchId))).orderBy(asc(rtaStagingChecks.scope), asc(rtaStagingChecks.checkCode), asc(rtaStagingChecks.scopeRef));
    const exceptions = (await tx.execute(sql`
      SELECT exception_code AS code, state, count(*)::int AS rows FROM rta_staging_rows
       WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid AND exception_code IS NOT NULL
       GROUP BY 1, 2 ORDER BY 3 DESC
    `)).rows as Array<{ code: string; state: string; rows: number }>;
    const econ = await tx.select({
      status: rtaStagingEconomicTxns.status, rtaClass: rtaStagingEconomicTxns.rtaClass, proposedAction: rtaStagingEconomicTxns.proposedAction,
      n: sql<number>`count(*)::int`,
    }).from(rtaStagingEconomicTxns).where(and(eq(rtaStagingEconomicTxns.tenantId, tenantId), eq(rtaStagingEconomicTxns.batchId, batchId)))
      .groupBy(rtaStagingEconomicTxns.status, rtaStagingEconomicTxns.rtaClass, rtaStagingEconomicTxns.proposedAction);
    return { batch, checks, exceptions, economicTransactions: econ };
  });
}
