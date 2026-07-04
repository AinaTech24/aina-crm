/**
 * FintechPrimitives (FP) mailback import worker.
 *
 * The browser uploads the RTA reverse feed to S3 (presigned PUT, same as the
 * native RTA importer), then /api/rta-imports/upload enqueues a job here when
 * the chosen source is "fintech_primitives".
 *
 * Per job:
 *   1. mark the rta_file_imports row `parsing`
 *   2. fetch the file from S3; if it's a password zip, extract the inner file
 *   3. push to FP, poll the file_operation, pull folios + transactions
 *      (all OUTSIDE any DB tx — the poll can take minutes)
 *   4. upsert into local folios + transactions in one tenant tx
 *   5. write counters + a reconciliation summary onto the import row
 *   6. delete the transient S3 object
 *
 * Idempotency: the import row is checked for a terminal status before work, and
 * every transaction carries a deterministic dedup_key, so a re-run is a no-op.
 */

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { getObjectBytes, deleteObject } from "@/lib/storage/s3";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { fetchFpMailback, applyFpMailback, type FpImportSummary } from "@/lib/fp/import";
import { syncFpForTenant, resolveFpConfigForTenant } from "@/lib/fp/sync";
import { captureError } from "@/lib/observability/capture";

/** Upload (backfill) mode — push a reverse-feed file to FP's transaction_processing. */
export type FpImportJob = {
  mode?: "upload";
  importId: string;
  tenantId: string;
  /** S3 object key the browser PUT the file to. */
  key: string;
  filename: string;
  password?: string;
  userId: string;
  branchId?: string | null;
  roles: string[];
};

/** Sync (primary) mode — pull folios + transactions from the FP API. */
export type FpSyncJob = {
  mode: "sync";
  importId: string;
  tenantId: string;
  lookbackDays?: number;
  userId?: string | null;
  branchId?: string | null;
  roles: string[];
};

type AnyFpJob = FpImportJob | FpSyncJob;

const MAX_BYTES = 25 * 1024 * 1024;

function ctxOf(job: AnyFpJob) {
  return { userId: job.userId ?? undefined, branchId: job.branchId ?? undefined, roles: job.roles };
}

async function markFailed(job: AnyFpJob, reason: string) {
  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'failed', parsed_at = now(), remarks = ${reason.slice(0, 1000)}
        WHERE id = ${job.importId}::uuid
      `);
    },
    ctxOf(job)
  );
}

/** Has this import already reached a terminal state? (Stalled-job re-run guard.) */
async function importAlreadyFinished(job: AnyFpJob): Promise<boolean> {
  try {
    return await withTenant(
      job.tenantId,
      async (tx) => {
        const r = await tx.execute(
          sql`SELECT status FROM rta_file_imports WHERE id = ${job.importId}::uuid LIMIT 1`
        );
        const st = (r.rows?.[0] as any)?.status as string | undefined;
        return st === "completed" || st === "partial" || st === "failed" || st === "rejected";
      },
      ctxOf(job)
    );
  } catch {
    return false; // can't check → run rather than silently drop
  }
}

export async function runFpImportJob(
  job: FpImportJob,
  report?: (p: { phase: string; pct: number }) => void
): Promise<void> {
  // 1. Mark parsing.
  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports SET status = 'parsing', parsed_at = now() WHERE id = ${job.importId}::uuid
      `);
    },
    ctxOf(job)
  );

  // 2. Read the file from S3.
  report?.({ phase: "Reading file", pct: 5 });
  let buf: Buffer;
  try {
    buf = await getObjectBytes(job.key);
  } catch (e: any) {
    await markFailed(job, `Could not read the uploaded file from storage — ${e?.message ?? "object not found"}.`);
    return;
  }
  if (buf.length === 0) return markFailed(job, "empty upload — no file received");
  if (buf.length > MAX_BYTES) return markFailed(job, "file too large (max 25 MB)");

  // Unzip password-protected RTA mailbacks to their inner file before sending
  // to FP (FP wants the raw reverse-feed file, not the archive).
  let bytes: Uint8Array = new Uint8Array(buf);
  let innerName = job.filename;
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    try {
      const r = await extractRtaFileFromZip(new Uint8Array(buf), job.password);
      bytes = r.data;
      innerName = r.filename;
    } catch (e: any) {
      return markFailed(job, `Could not open the zip — ${e?.message ?? "wrong password or unsupported archive"}.`);
    }
  }
  buf = Buffer.alloc(0); // free original

  // 3. FP network phase (outside any DB tx — polling can take minutes).
  //    Use THIS tenant's own FP credentials (env fallback for the shared sandbox).
  const cfg = await resolveFpConfigForTenant(job.tenantId);
  if (!cfg) {
    await markFailed(job, "Mailback Import is not configured for this firm. Add your credentials in Settings → Integrations.");
    return;
  }
  let summary: FpImportSummary;
  try {
    const data = await fetchFpMailback(bytes, innerName, {
      cfg,
      onPhase: (phase) => {
        const pct =
          phase === "uploading" ? 15
          : phase === "creating_operation" ? 25
          : phase === "processing" ? 40
          : phase === "fetching_folios" ? 65
          : 80;
        report?.({ phase: phaseLabel(phase), pct });
      },
    });

    // 4 + 5. Upsert in one tenant tx, then write counters/summary.
    report?.({ phase: "Importing transactions", pct: 90 });
    summary = await withTenant(job.tenantId, (tx) => applyFpMailback(tx as any, job.tenantId, data), ctxOf(job));
  } catch (e: any) {
    captureError("[fp-import] failed", e, { tenantId: job.tenantId, importId: job.importId });
    await markFailed(job, e?.message ?? "Mailback import failed");
    return;
  }

  await finalizeImport(job, summary);
}

/**
 * Sync (primary) mode — pull folios + transactions from the FP API and upsert.
 * No file, no S3, no upload/poll: the data already exists in FP.
 */
export async function runFpSyncJob(
  job: FpSyncJob,
  report?: (p: { phase: string; pct: number }) => void
): Promise<void> {
  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports SET status = 'parsing', parsed_at = now() WHERE id = ${job.importId}::uuid
      `);
    },
    ctxOf(job)
  );

  // Live phase text → the import row's `remarks`, so the Settings card (which
  // polls the row) shows dynamic progress: Connecting → Fetching folios →
  // Fetching transactions → Importing.
  const onProgress = async (msg: string) => {
    report?.({ phase: msg, pct: 40 });
    try {
      await withTenant(
        job.tenantId,
        (tx) =>
          tx.execute(sql`
            UPDATE rta_file_imports SET remarks = ${msg.slice(0, 200)}
            WHERE id = ${job.importId}::uuid AND status = 'parsing'
          `),
        ctxOf(job)
      );
    } catch {
      /* progress text is best-effort — never fail the sync over it */
    }
  };

  let summary: FpImportSummary;
  try {
    summary = await syncFpForTenant(
      job.tenantId,
      { userId: job.userId ?? undefined, branchId: job.branchId, roles: job.roles },
      { lookbackDays: job.lookbackDays, onProgress }
    );
  } catch (e: any) {
    captureError("[fp-sync] failed", e, { tenantId: job.tenantId, importId: job.importId });
    await markFailed(job, e?.message ?? "Mailback sync failed");
    return;
  }

  await finalizeImport(job, summary);
}

/** Write the import outcome (status + counters + summary) onto the audit row.
 *  Shared by upload and sync modes. */
async function finalizeImport(job: AnyFpJob, summary: FpImportSummary): Promise<void> {
  const status =
    summary.txImported === 0
      ? summary.txTotal === 0
        ? "completed" // FP returned no transactions (e.g. nothing to sync yet)
        : "failed"
      : summary.txSkipped > 0 || summary.txFailed > 0 || summary.foliosUnmatched > 0
        ? "partial"
        : "completed";

  const remarks =
    summary.foliosTotal === 0 && summary.txTotal === 0
      ? "Connected — no folios or transactions in this account yet. Records appear once your registrar feeds are processed."
      : `${summary.txImported}/${summary.txTotal} transactions · ` +
        `${summary.foliosMatched}/${summary.foliosTotal} folios matched · ` +
        `realised cap-gains ₹${summary.capitalGainsTotal.toLocaleString("en-IN")}` +
        (summary.foliosUnmatched > 0
          ? ` · ${summary.foliosUnmatched} folio(s) had no matching client (PAN not in your book)`
          : "") +
        (summary.foliosCapHit ? " · NOTE: folio list hit page cap — some folios may be unimported" : "");

  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = ${status}, parsed_at = now(),
            period_start = ${summary.periodStart}::date,
            period_end = ${summary.periodEnd}::date,
            rows_total = ${summary.txTotal},
            rows_imported = ${summary.txImported},
            rows_skipped = ${summary.txSkipped},
            rows_failed = ${summary.txFailed},
            errors = ${JSON.stringify(summary.errors)}::jsonb,
            summary = ${JSON.stringify(summary)}::jsonb,
            remarks = ${remarks.slice(0, 1000)}
        WHERE id = ${job.importId}::uuid
      `);
    },
    ctxOf(job)
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "uploading":
      return "Uploading mailback file";
    case "creating_operation":
      return "Starting processing";
    case "processing":
      return "Processing the mailback feed";
    case "fetching_folios":
      return "Fetching folios";
    case "fetching_transactions":
      return "Fetching transactions";
    default:
      return "Working";
  }
}

export function startFpImportWorker() {
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    "fp.import",
    async (job) => {
      const data = job.data as AnyFpJob;
      // Only the upload (backfill) mode has a transient S3 object to clean up.
      const localKey = data.mode === "sync" ? undefined : (data as FpImportJob).key;
      if (await importAlreadyFinished(data)) {
        if (localKey) await deleteObject(localKey).catch(() => {});
        return;
      }
      try {
        if (data.mode === "sync") {
          await runFpSyncJob(data, (p) => void job.updateProgress(p as any));
        } else {
          await runFpImportJob(data, (p) => void job.updateProgress(p as any));
        }
      } finally {
        if (localKey) await deleteObject(localKey).catch(() => {});
      }
    },
    // FP calls are network-bound (not CPU/memory heavy like a local parse), so a
    // little concurrency is fine.
    { connection, concurrency: 3 }
  );

  worker.on("failed", (job, err) => {
    captureError("[fp-import] job failed", err, { importId: (job?.data as FpImportJob)?.importId });
  });

  console.log("[fp-import] worker started (concurrency=3)");
  return () => {
    void worker.close();
    void connection.quit();
  };
}
