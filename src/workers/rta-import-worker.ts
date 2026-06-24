/**
 * RTA import worker.
 *
 * Parsing a real RTA master (CAMS R9 / KFintech MFSD — a ~10 MB zip that
 * expands to a large spreadsheet) is CPU- and memory-heavy: it OOM-crashed or
 * event-loop-blocked the WEB server when done inside the upload request,
 * 503-ing the whole site for every user. So the upload route now only records
 * the import row + enqueues a job here; this worker does the actual work in the
 * isolated worker process (concurrency 1 — one heavy parse at a time).
 *
 * Flow per job:
 *   1. mark the rta_file_imports row `parsing`
 *   2. fetch the object from S3 by key, checksum it (dedupe)
 *   3. unzip (password) if needed, decode to canonical pipe text
 *   4. run processRtaFile() in one tenant transaction
 *   5. update the row with status + counters (completed | partial | failed | rejected)
 *
 * A reaper marks rows stuck in `parsing` (worker died mid-job) as failed so the
 * UI poll resolves instead of spinning forever.
 */

import { Worker } from "bullmq";
import IORedis from "ioredis";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { withTenant, withSystem } from "@/db/client";
import { processRtaFile } from "@/lib/rta/process";
import { decodeRtaToText } from "@/lib/rta/decode";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
// RTA zip is uploaded to S3 (full file, no web-server body cap), parsed, then
// deleted from S3 immediately — transient, never retained.
import { getObjectBytes, deleteObject } from "@/lib/storage/s3";
import type { RtaSource, RtaFileKind } from "@/db/schema/rta_imports";
import { captureError } from "@/lib/observability/capture";
import { parseRtaCsv, parseRtaRows } from "@/lib/rta";
import { importRtaFolios, type RtaImportSummary } from "@/lib/rta/import";
import { isSpreadsheet, readSpreadsheetToRows } from "@/lib/rta/xls";

export type RtaImportJob = {
  importId: string;
  tenantId: string;
  source: RtaSource;
  kind: RtaFileKind;
  /** S3 object key the browser PUT the file to. */
  key: string;
  filename: string;
  password?: string;
  userId: string;
  branchId?: string | null;
  roles: string[];
};

const MAX_BYTES = 60 * 1024 * 1024;

async function markFailed(
  job: RtaImportJob,
  reason: string,
  extra?: { checksum?: string; sizeBytes?: number }
) {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'failed', parsed_at = now(), remarks = ${reason.slice(0, 1000)},
            file_checksum = COALESCE(${extra?.checksum ?? null}, file_checksum),
            file_size_bytes = COALESCE(${extra?.sizeBytes ?? null}, file_size_bytes)
        WHERE id = ${job.importId}::uuid
      `);
    },
    ctx
  );
}

/** The actual import. Exported so it can be unit-tested / invoked one-off. */
export async function runRtaImportJob(job: RtaImportJob): Promise<void> {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  const { importId, tenantId, source, kind, key, filename } = job;

  // 1. Mark parsing.
  await withTenant(
    tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports SET status = 'parsing', parsed_at = now() WHERE id = ${importId}::uuid
      `);
    },
    ctx
  );

  // 2. Read the full file from S3 (uploaded directly by the browser).
  let buf: Buffer;
  try {
    buf = await getObjectBytes(key);
  } catch (e: any) {
    await markFailed(job, `Could not read the uploaded file from storage — ${e?.message ?? "object not found"}.`);
    return;
  }
  if (buf.length === 0) {
    await markFailed(job, "empty upload — no file received");
    return;
  }
  if (buf.length > MAX_BYTES) {
    await markFailed(job, "file too large (max 60 MB)");
    return;
  }

  // Checksum the ORIGINAL bytes so re-uploading the identical file dedupes.
  const checksum = createHash("sha256").update(buf).digest("hex");

  // NOTE: we deliberately do NOT hard-reject a re-uploaded (same-checksum) file.
  // The feed processors are upsert-idempotent (and the master/rich path upserts),
  // so re-importing is safe — and blocking it stranded users who needed to retry
  // a previously-failed or partial import. Re-import just refreshes in place.

  // 3. Unzip (password-protected RTA mailbacks) then decode to pipe text.
  let dataBuf = buf;
  let innerName = filename;
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    try {
      const r = await extractRtaFileFromZip(new Uint8Array(buf), job.password);
      dataBuf = Buffer.from(r.data);
      innerName = r.filename;
    } catch (e: any) {
      await markFailed(
        job,
        `Could not open the zip — ${e?.message ?? "wrong password or unsupported archive"}.`,
        { checksum, sizeBytes: buf.length }
      );
      return;
    }
  }

  const text = decodeRtaToText(dataBuf, innerName);
  // Free the large buffers before the (memory-heavy) parse so they can be GC'd.
  dataBuf = Buffer.alloc(0);
  buf = Buffer.alloc(0);

  // 4 + 5. Process in one tenant transaction, then persist counters.
  try {
    await withTenant(
      tenantId,
      async (tx) => {
        let outcome;
        let failure: string | null = null;
        try {
          outcome = await processRtaFile(tx, { tenantId, source, kind, text });
        } catch (e: any) {
          failure = e?.message ?? "Unknown parser error";
        }

        if (failure || !outcome) {
          await tx.execute(sql`
            UPDATE rta_file_imports
            SET status = 'failed', parsed_at = now(), file_checksum = ${checksum},
                file_size_bytes = ${dataLen(text)},
                remarks = ${failure ?? "unknown error"}
            WHERE id = ${importId}::uuid
          `);
          return;
        }

        const status =
          outcome.rowsFailed > 0 || outcome.rowsSkipped > 0
            ? outcome.rowsImported === 0
              ? "failed"
              : "partial"
            : "completed";

        await tx.execute(sql`
          UPDATE rta_file_imports
          SET status = ${status}, parsed_at = now(), file_checksum = ${checksum},
              period_start = ${outcome.periodStart}::date,
              period_end = ${outcome.periodEnd}::date,
              rows_total = ${outcome.rowsTotal},
              rows_imported = ${outcome.rowsImported},
              rows_skipped = ${outcome.rowsSkipped},
              rows_failed = ${outcome.rowsFailed},
              errors = ${JSON.stringify(outcome.errors)}::jsonb
          WHERE id = ${importId}::uuid
        `);
      },
      ctx
    );
  } catch (e: any) {
    await markFailed(job, e?.message ?? "import failed", { checksum });
  }
}

/** Byte length of the decoded text (file_size_bytes when the original buffer is freed). */
function dataLen(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Reap rows stuck in `parsing` — if the worker died mid-parse (e.g. OOM on a
 * huge file), nothing resets the row and the UI poll spins forever. Mark them
 * failed after 20 min. Never auto-retried (a half-applied import is upsert-safe
 * but re-running a giant file just risks another OOM — the user re-uploads).
 */
async function reapStuckParsing(): Promise<number> {
  const reaped = await withSystem(async (tx) => {
    // (1) Parse started but never finished (worker died/OOM mid-parse).
    // (2) Enqueued but the worker never picked it up — stuck at 'uploaded'/'queued'
    //     with no error (today's failure mode: worker starved while the box was
    //     building). Both get a clear, actionable failure so the row stops
    //     spinning and the user can re-upload.
    const rows = await tx.execute(sql`
      UPDATE rta_file_imports
      SET status = 'failed', parsed_at = COALESCE(parsed_at, now()),
          remarks = COALESCE(NULLIF(remarks, ''), 'Import didn''t finish — the worker was busy or restarting. Re-upload to retry.')
      WHERE (
        (status = 'parsing' AND parsed_at IS NOT NULL AND parsed_at < now() - interval '20 minutes')
        OR (status IN ('uploaded', 'queued') AND created_at < now() - interval '20 minutes')
      )
      RETURNING id
    `);
    return rows.rows.length;
  });
  return reaped;
}

/**
 * Rich master/holdings import (the /dashboard/imports/rta importer). Unlike the
 * feed processor above, this resolves real AMC + scheme names and CREATES the
 * full client book (investors + folios + families) via importRtaFolios — and it
 * supports a dry-run preview. Heavy CAMS R9 (.xls ~50 MB) parsing runs here in
 * the isolated worker (concurrency 1) instead of the web request. Returns the
 * summary as the job's return value so the UI can poll for it.
 */
export type RichImportJob = {
  mode: "rich";
  tenantId: string;
  key: string;
  filename: string;
  password?: string;
  rta: string;
  reportType: string;
  dryRun: boolean;
  assignToMe: boolean;
  userId: string;
  branchId?: string | null;
  roles: string[];
  /** When set, this is the UNIFIED importer flow: update this rta_file_imports
   *  row with the outcome (so it shows on the /dashboard/rta-imports dashboard),
   *  and the dialog polls the row. When absent, it's the standalone job-poll flow. */
  importId?: string;
};

export type RichImportResult = {
  ok: boolean;
  error?: string;
  source?: string;
  reportType?: string;
  totalRows?: number;
  missingPan?: number;
  summary?: RtaImportSummary;
};

/** Progress payload the UI polls for (via job.progress on import-status). */
export type RichImportProgress = { phase: string; pct: number; done?: number; total?: number };

async function computeRichImport(
  job: RichImportJob,
  report?: (p: RichImportProgress) => void
): Promise<RichImportResult> {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };

  report?.({ phase: "Reading file", pct: 4 });
  let buf = await getObjectBytes(job.key);
  if (buf.length === 0) return { ok: false, error: "empty upload — no file received" };
  if (buf.length > 80 * 1024 * 1024) return { ok: false, error: "file too large (max 80 MB)" };

  // Unzip password-protected RTA mailbacks to their inner file.
  let data: Uint8Array = new Uint8Array(buf);
  let innerName = job.filename;
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    try {
      const r = await extractRtaFileFromZip(new Uint8Array(buf), job.password);
      data = r.data;
      innerName = r.filename;
    } catch (e: any) {
      return { ok: false, error: `Could not open the zip — ${e?.message ?? "wrong password or unsupported archive"}.` };
    }
  }
  buf = Buffer.alloc(0); // free the original before the heavy parse

  report?.({ phase: "Parsing file", pct: 8 });
  // Binary Excel (CAMS R9 .xls) via SheetJS; anything else as latin-1 CSV.
  const parsed = isSpreadsheet(data, innerName)
    ? parseRtaRows(readSpreadsheetToRows(data))
    : parseRtaCsv(new TextDecoder("latin1").decode(data));

  if (parsed.source === "unknown" || parsed.folios.length === 0) {
    return {
      ok: false,
      error: parsed.warnings[0] ?? "Unrecognised RTA file — header did not match a known report.",
      source: parsed.source,
      reportType: parsed.reportType,
      totalRows: parsed.totalRows,
    };
  }
  if (job.rta && parsed.source !== job.rta) {
    return { ok: false, error: `You selected ${job.rta.toUpperCase()}, but this file looks like ${parsed.source.toUpperCase()} ${parsed.reportType}. Pick the matching RTA, or the right file.` };
  }
  if (job.reportType && parsed.reportType && job.reportType !== parsed.reportType) {
    return { ok: false, error: `You selected file type ${job.reportType}, but this file is ${parsed.reportType}. Pick the matching file type.` };
  }

  const { loadTenantLicense } = await import("@/lib/auth/license");
  const license = await loadTenantLicense(job.tenantId, undefined);
  report?.({ phase: "Importing records", pct: 15, total: parsed.totalRows });
  const summary = await withTenant(
    job.tenantId,
    (tx) =>
      importRtaFolios(tx as any, job.tenantId, parsed.folios, {
        dryRun: job.dryRun,
        assignRmId: job.assignToMe ? job.userId : null,
        reportType: parsed.reportType,
        kind: parsed.kind === "holdings" ? "holdings" : parsed.kind === "full" ? "full" : "master",
        quotaCap: license.maxInvestors,
        // Clients fill 15→40%, folios 40→85% of the bar; the UI derives the ETA.
        onProgress: (phase, done, total) => {
          const frac = done / Math.max(1, total);
          const pct =
            phase === "clients"
              ? 15 + Math.round(25 * frac)
              : 40 + Math.round(45 * frac);
          report?.({
            phase: phase === "clients" ? "Importing clients" : "Importing folios",
            pct,
            done,
            total,
          });
        },
      }),
    ctx
  );

  // After a REAL import, revalue folios + roll holdings up to investors.aum so
  // the profile headlines/AUM reflect the freshly-created book immediately.
  if (!job.dryRun) {
    report?.({ phase: "Finalizing valuations", pct: 88 });
    try {
      const { revalueAllFolios, recomputeCombinedAum } = await import("@/lib/finance/aum-persist");
      await withTenant(
        job.tenantId,
        async (tx) => {
          await revalueAllFolios(tx);
          await recomputeCombinedAum(tx);
        },
        ctx
      );
    } catch (err) {
      captureError("[rta-import] post-import AUM rollup failed", err, { tenantId: job.tenantId });
    }
  }

  return {
    ok: true,
    source: parsed.source,
    reportType: parsed.reportType,
    totalRows: parsed.totalRows,
    missingPan: parsed.missingPan,
    summary,
  };
}

/**
 * Run a rich import. In the UNIFIED flow (job.importId set) it also writes the
 * outcome onto the rta_file_imports row so it appears on the dashboard and the
 * upload dialog's poll resolves. Always returns the result (used by the
 * standalone job-poll flow).
 */
export async function runRichImportJob(
  job: RichImportJob,
  report?: (p: RichImportProgress) => void
): Promise<RichImportResult> {
  const result = await computeRichImport(job, report);
  if (job.importId) {
    const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
    await withTenant(
      job.tenantId,
      async (tx) => {
        if (!result.ok) {
          await tx.execute(sql`
            UPDATE rta_file_imports SET status = 'failed', parsed_at = now(),
              remarks = ${(result.error ?? "import failed").slice(0, 1000)}
            WHERE id = ${job.importId}::uuid
          `);
          return;
        }
        const s = result.summary;
        const imported = (s?.folios.created ?? 0) + (s?.folios.updated ?? 0);
        const skipped = s?.folios.skippedNoPan ?? 0;
        const total = s?.folios.total ?? 0;
        const status = imported === 0 ? "failed" : skipped > 0 ? "partial" : "completed";
        const remarks = s
          ? `${s.investors.created} new + ${s.investors.updated} updated clients · ${s.folios.total} folios · ${s.amcs.length} AMCs`
          : null;
        await tx.execute(sql`
          UPDATE rta_file_imports SET status = ${status}, parsed_at = now(),
            rows_total = ${total}, rows_imported = ${imported}, rows_skipped = ${skipped}, rows_failed = 0,
            remarks = ${remarks},
            summary = ${s ? JSON.stringify(s) : null}::jsonb
          WHERE id = ${job.importId}::uuid
        `);
      },
      ctx
    );
  }
  return result;
}

export function startRtaImportWorker() {
  // BullMQ workers need their own blocking connection (maxRetriesPerRequest:null).
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    "rta.import",
    async (job) => {
      const localKey = (job.data as any)?.key as string | undefined;
      try {
        // Rich master/holdings import returns its summary (UI polls for it);
        // the feed import updates the rta_file_imports row and returns nothing.
        if ((job.data as any)?.mode === "rich") {
          // Forward live progress to BullMQ so /api/rta/import-status (and the UI
          // bar + ETA) can read it. updateProgress is fire-and-forget.
          return await runRichImportJob(job.data as RichImportJob, (p) => {
            void job.updateProgress(p as any);
          });
        }
        await runRtaImportJob(job.data as RtaImportJob);
      } finally {
        // Purge the RTA zip from S3 once parsing is done (success OR failure) —
        // it's transient, never retained.
        if (localKey) await deleteObject(localKey).catch(() => {});
      }
    },
    { connection, concurrency: 1 } // one heavy parse at a time — bounds peak memory
  );

  worker.on("failed", (job, err) => {
    captureError("[rta-import] job failed", err, { importId: (job?.data as RtaImportJob)?.importId });
  });

  // Stuck-row reaper, every 5 minutes.
  const reapHandle = setInterval(async () => {
    try {
      const n = await reapStuckParsing();
      if (n > 0) console.log(`[rta-import] reaped ${n} stuck parsing row(s)`);
    } catch (err) {
      captureError("[rta-import] reaper error", err);
    }
  }, 5 * 60 * 1000);
  reapHandle.unref?.();

  console.log("[rta-import] worker started (concurrency=1, reaper=5m)");
  return () => {
    clearInterval(reapHandle);
    void worker.close();
    void connection.quit();
  };
}
