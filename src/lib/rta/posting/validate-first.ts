/**
 * The validate-first import (Phase 3F) — the ONE path every RTA file takes
 * when RTA_PIPELINE_MODE=validate_first, from upload and from mail alike
 * (both enqueue the same worker job, which calls this):
 *
 *   file → identify → decode → STAGE → strict field validation → investor /
 *   folio resolution → classification → duplicate & correction checks →
 *   financial reconciliation → commit eligibility → ATOMIC COMMIT → reporting
 *
 * Everything before "commit" is runShadowBatch (lib/rta/staging), which writes
 * only rta_staging_*. Nothing reaches a financial table until the batch has
 * reached a final validated state; then exactly one posting function runs for
 * the file's record kind, inside the posting gate, in one transaction:
 *   transaction  → postTransactionBatch   (transactions, sip_rejections)
 *   master/holding → postMasterBatch      (investors, folios, holdings legs, folio_holders)
 *   registration → rebuildSipBook         (rta_sip_registrations, sips)
 *
 * The legacy importers are not called. A retry of the same import resumes the
 * same batch (staging resumes from its last completed stage; posting replays
 * its recorded outcome), so a crash at any point neither duplicates nor loses
 * what was committed.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { rtaStagingBatches } from "@/db/schema";
import { createShadowBatch, runShadowBatch } from "../staging/pipeline";
import { postingGateEnv, PostingGateError, registrarOutOfScope, reportOutOfScope } from "./gate";
import { currentActivation, registrarCovered, reportCovered } from "./controls";
import { identifyLayout } from "../staging/layouts";
import { readLines } from "../staging/source";
import { postTransactionBatch, type PostResult } from "./post";
import { postMasterBatch, type MasterPostResult } from "./masters";
import { rebuildSipBook, type SipBookOutcome } from "./sip-book";
import { reprocessHeldTransactions, type ReprocessResult } from "./reprocess";

/**
 * Another worker holds the batch's staging lease — typically a worker that
 * died mid-stage. Not a validation failure: the job is retried once the lease
 * can have expired (the worker re-delays the queue job).
 */
export class RetryLaterError extends Error {
  constructor(message: string, public retryAt: Date) {
    super(message);
    this.name = "RetryLaterError";
  }
}

export type ValidateFirstResult = {
  batchId: string;
  stagingState: string;
  recordKind: string | null;
  posting: PostResult | MasterPostResult | SipBookOutcome | null;
  resumed: boolean;
  /** Held transactions on this file's folios, re-evaluated after it posted. */
  reevaluation?: ReprocessResult | null;
};

export async function validateFirstImport(args: {
  tenantId: string; importId: string | null; fileName: string; fileRef: string; buf: Uint8Array;
  createdBy?: string | null; partial?: "none" | "independent"; asOf?: string;
  /** TEST ONLY: passed to the transaction poster. */
  failAfterWrites?: number;
}): Promise<ValidateFirstResult> {
  const gate = postingGateEnv();
  if (!gate.allowed) throw new PostingGateError(gate.reasons);
  // The activation's registrar scope (0242), checked before anything is staged:
  // a CAMS file sent to a KFintech-only pilot firm is refused whole. The posting
  // gate checks the same scope again inside every posting transaction.
  // The report-type scope (0243) the same way: identified from the file's
  // CONTENT (its header layout), never from its name.
  const activation = await withTenant(args.tenantId, (tx) => currentActivation(tx, args.tenantId));
  if (activation?.registrars || activation?.reportCodes) {
    const layout = identifyLayout(readLines(args.buf, args.fileName))?.layout ?? null;
    if (!registrarCovered(activation, layout?.rta ?? null)) throw new PostingGateError([registrarOutOfScope(activation.registrars, layout?.rta ?? null)]);
    if (!reportCovered(activation, layout?.reportCode ?? null)) throw new PostingGateError([reportOutOfScope(activation.reportCodes, layout?.reportCode ?? null)]);
  }

  // Resume: the latest batch this import already created.
  let batchId: string | null = null;
  let resumed = false;
  if (args.importId) {
    const prior = await withTenant(args.tenantId, (tx) => tx.select({ id: rtaStagingBatches.id, state: rtaStagingBatches.state })
      .from(rtaStagingBatches)
      .where(and(eq(rtaStagingBatches.tenantId, args.tenantId), eq(rtaStagingBatches.importId, args.importId!), eq(rtaStagingBatches.mode, "validate_first")))
      .orderBy(desc(rtaStagingBatches.createdAt)).limit(1));
    if (prior[0] && prior[0].state !== "failed") { batchId = prior[0].id; resumed = true; }
  }
  if (!batchId) {
    batchId = await createShadowBatch({ tenantId: args.tenantId, importId: args.importId, fileName: args.fileName, fileRef: args.fileRef, buf: args.buf, createdBy: args.createdBy ?? null, mode: "validate_first" });
  }
  const staged = await runShadowBatch(args.tenantId, batchId, args.buf);
  if (staged.busy) {
    const lease = await withTenant(args.tenantId, (tx) => tx.select({ until: rtaStagingBatches.leaseUntil }).from(rtaStagingBatches)
      .where(and(eq(rtaStagingBatches.tenantId, args.tenantId), eq(rtaStagingBatches.id, batchId!))));
    const until = lease[0]?.until ?? new Date(Date.now() + 60_000);
    throw new RetryLaterError(`staging batch ${batchId} is held by another worker until ${until.toISOString()} — retrying after that`, new Date(until.getTime() + 5_000));
  }
  const kind = (await withTenant(args.tenantId, (tx) => tx.select({ k: rtaStagingBatches.recordKind }).from(rtaStagingBatches)
    .where(and(eq(rtaStagingBatches.tenantId, args.tenantId), eq(rtaStagingBatches.id, batchId!)))))[0]?.k ?? null;
  if (!["ready_to_commit", "exception"].includes(staged.state)) {
    return { batchId, stagingState: staged.state, recordKind: kind, posting: null, resumed };
  }
  let posting: ValidateFirstResult["posting"] = null;
  let reevaluation: ReprocessResult | null = null;
  if (kind === "transaction") {
    posting = await postTransactionBatch(args.tenantId, batchId, { partial: args.partial ?? "independent", userId: args.createdBy, importId: args.importId, failAfterWrites: args.failAfterWrites });
    // A transaction posted by the owner's own PAN can open a folio that earlier files' held transactions were waiting on.
    reevaluation = await reprocessHeldTransactions(args.tenantId, { folios: await batchFolios(args.tenantId, batchId), userId: args.createdBy, triggerBatchId: batchId });
    // Instalments move the SIP Master too.
    await rebuildSipBook(args.tenantId, { asOf: args.asOf, userId: args.createdBy });
  } else if (kind === "master" || kind === "holding") {
    posting = await postMasterBatch(args.tenantId, batchId, { name: args.fileName, buf: args.buf }, { userId: args.createdBy, importId: args.importId });
    // The authoritative master has arrived: re-evaluate what was held waiting for these folios —
    // and for these owners (a held transaction on another folio naming the owner's own PAN).
    reevaluation = await reprocessHeldTransactions(args.tenantId, { folios: await batchFolios(args.tenantId, batchId), ownerTokens: await batchOwnerTokens(args.tenantId, batchId), userId: args.createdBy, triggerBatchId: batchId });
  } else if (kind === "registration") {
    const book = await rebuildSipBook(args.tenantId, { asOf: args.asOf, userId: args.createdBy });
    posting = book;
    // A registration file posts nothing by itself: it feeds the SIP Master, which
    // posts only verified registrations. Record that on the batch and the import.
    await withTenant(args.tenantId, async (tx) => {
      const [c] = (await tx.execute(sql`
        SELECT count(*) FILTER (WHERE state IN ('staged', 'duplicate'))::int AS ok, count(*) FILTER (WHERE state NOT IN ('staged', 'duplicate'))::int AS held
          FROM rta_staging_rows WHERE tenant_id = ${args.tenantId}::uuid AND batch_id = ${batchId}::uuid`)).rows as Array<{ ok: number; held: number }>;
      const posted = book.sips.created + book.sips.updated + book.sips.linked;
      await tx.execute(sql`
        UPDATE rta_staging_batches SET posting_state = ${posted ? "posted" : "nothing_to_post"}, posted_at = now(),
               posting_counts = ${JSON.stringify({ registrations: book.registrations, byState: book.byState, sips: book.sips })}::jsonb, updated_at = now()
         WHERE tenant_id = ${args.tenantId}::uuid AND id = ${batchId}::uuid`);
      if (args.importId) {
        await tx.execute(sql`
          UPDATE rta_file_imports SET status = ${c.held ? "partial" : "completed"}, parsed_at = now(), rows_imported = ${c.ok}, rows_skipped = ${c.held}, rows_failed = 0,
                 remarks = ${`Validate-first: ${c.ok} registration row(s) read into the SIP Master${c.held ? `, ${c.held} held` : ""}. The SIP book now holds ${book.sips.created + book.sips.linked + book.sips.updated} verified registration(s) of ${book.registrations}; the rest are not verified (no status, no owner on record, or not a SIP) and are not counted.`}
           WHERE tenant_id = ${args.tenantId}::uuid AND id = ${args.importId}::uuid`);
      }
    });
  }
  return { batchId, stagingState: staged.state, recordKind: kind, posting, resumed, reevaluation };
}

/** The owners' own PAN tokens a staged master batch carries (never a guardian's: staging stores the legal owner's token). */
async function batchOwnerTokens(tenantId: string, batchId: string): Promise<string[]> {
  return withTenant(tenantId, async (tx) => ((await tx.execute(sql`
    SELECT DISTINCT pan_token FROM rta_staging_rows WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid AND pan_token IS NOT NULL`)).rows as Array<{ pan_token: string }>)
    .map((r) => r.pan_token));
}

/** The (AMC, folio) pairs a staged batch touched. */
async function batchFolios(tenantId: string, batchId: string): Promise<Array<{ amcCode: string | null; folioNumber: string }>> {
  return withTenant(tenantId, async (tx) => ((await tx.execute(sql`
    SELECT DISTINCT amc_code, folio_number FROM rta_staging_rows
     WHERE tenant_id = ${tenantId}::uuid AND batch_id = ${batchId}::uuid AND folio_number IS NOT NULL`)).rows as Array<{ amc_code: string | null; folio_number: string }>)
    .map((r) => ({ amcCode: r.amc_code, folioNumber: r.folio_number })));
}
