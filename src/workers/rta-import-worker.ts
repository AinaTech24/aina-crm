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
 *   1. mark the rta_file_imports row `parsing`, clearing the previous attempt's
 *      remark / counts / errors
 *   2. fetch the object from S3 by key, checksum it (dedupe)
 *   3. identify the file by CONTENT (file-kind.ts): a real zip archive is
 *      unpacked (password; exactly one data file), a workbook (.xlsx is a zip
 *      too) is read as a spreadsheet, text is decoded BOM / UTF-8 / UTF-16
 *      aware; then decode to canonical pipe text
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
import { extractRtaFileFromZip, RtaArchiveError } from "@/lib/rta/unzip";
import { decodeTextBytes, detectRtaContainer } from "@/lib/rta/file-kind";
import { maskPansInText } from "@/lib/rta/values";
import { rtaJobTiming } from "@/lib/rta/job-timing";
// RTA zip is uploaded to S3 (full file, no web-server body cap), parsed, then
// deleted from S3 immediately — transient, never retained.
import { getObjectBytes, deleteObject } from "@/lib/storage/s3";
import type { RtaSource, RtaFileKind } from "@/db/schema/rta_imports";
import { captureError } from "@/lib/observability/capture";
import { parseRtaCsv, parseRtaRows } from "@/lib/rta";
import { Q } from "./queues";
import { importRtaFolios, type RtaImportSummary } from "@/lib/rta/import";
import { isSpreadsheet, readSpreadsheetToRows } from "@/lib/rta/xls";
import { RICH_KINDS } from "@/lib/rta/classify-mailback";
import { getMailbackPasswords, passwordsToTry } from "@/lib/rta/mailback-config";
import { matchBookedBusinessAfterImport } from "@/lib/business/rta-match";
import { syncRtaJourneysAfterImport } from "@/lib/blueprints/rta-route";

/** Job timeout and reaper threshold, from one setting (lib/rta/job-timing.ts). */
const TIMING = rtaJobTiming();

export type RtaImportJob = {
  importId: string;
  tenantId: string;
  source: RtaSource;
  kind: RtaFileKind;
  /** S3 object key the browser PUT the file to. */
  key: string;
  filename: string;
  /** @deprecated single-password shape — still honoured, superseded by `passwords`. */
  password?: string;
  /** Every saved password for this source, tried in order until one opens the archive. */
  passwords?: string[];
  userId: string;
  branchId?: string | null;
  roles: string[];
};


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
        SET status = 'failed', parsed_at = now(), remarks = ${cleanRemark(reason)},
            file_checksum = COALESCE(${extra?.checksum ?? null}, file_checksum),
            file_size_bytes = COALESCE(${extra?.sizeBytes ?? null}, file_size_bytes)
        WHERE id = ${job.importId}::uuid
      `);
    },
    ctx
  );
}

/**
 * A ZIP that will not open with THIS firm's saved password is almost never a
 * problem to fix — it is somebody else's file.
 *
 * The mailback address receives whatever the firm forwards, and firms commonly
 * subscribe to the same registrar through more than one platform. Those other
 * platforms' archives are encrypted with THEIR password, land in the same
 * mailbox, and can outnumber the firm's own files several to one.
 *
 * Reporting them as `failed` buried the real failures in noise and implied the
 * operator had something to fix. They are recorded as `rejected` — "not ours,
 * ignored" — which is exactly what the status already means.
 */
function isWrongPasswordError(message: string | undefined): boolean {
  return /invalid password|wrong password|password/i.test(message ?? "");
}

/**
 * Strip characters Postgres's `text` type rejects outright before a value ever
 * reaches a query.
 *
 * A CAMS `.dbf` master reaching the rich-import path with no `.dbf` support
 * (fixed above, in xls.ts) got read as latin-1 CSV text — turning its binary
 * field-descriptor table (which embeds NUL bytes by DBF's own format) into an
 * "unrecognised format" error message THAT ITSELF CONTAINED NUL BYTES. Writing
 * that message to `remarks` threw `invalid byte sequence for encoding "UTF8":
 * 0x00` — a Postgres text column cannot hold a NUL character at all — and because that
 * threw INSIDE the very statement recording the failure, the row was left
 * orphaned in `parsing` with no reason ever saved, rescued only later by the
 * 60-minute reaper.
 *
 * Fixing the DBF gap stops THIS file from producing NUL-laden text. This is
 * the second, independent layer: whatever OTHER file format someday produces
 * similar garbage, the write that records the failure must never be able to
 * fail because of it — recording *some* reason beats losing the reason AND
 * leaving the row to be silently reaped.
 */
function sanitizeText(s: string | null | undefined): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex -- deliberately stripping NUL + other C0 control chars
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * A failure reason as it may be stored and shown: control characters stripped
 * (see sanitizeText), any PAN-shaped token masked — a parser or database error
 * can quote a row — and capped at 1000 characters.
 */
function cleanRemark(s: string | null | undefined): string | null {
  const t = sanitizeText(s);
  return t == null ? null : maskPansInText(t).slice(0, 1000);
}

/** An error safe to log: its message and stack with PAN-shaped tokens masked. */
function maskedError(e: unknown): Error {
  const out = new Error(maskPansInText(e instanceof Error ? e.message : String(e)));
  if (e instanceof Error && e.stack) out.stack = maskPansInText(e.stack);
  return out;
}

/** Merge the deprecated singular field with the new list, de-duplicated, in order. */
function candidatePasswords(job: { password?: string; passwords?: string[] }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of job.passwords ?? []) {
    if (p && !seen.has(p)) {
      out.push(p);
      seen.add(p);
    }
  }
  if (job.password && !seen.has(job.password)) out.push(job.password);
  return out;
}

/**
 * Try every saved password against a ZIP until one opens it.
 *
 * A firm can hold more than one password for the same registrar — a second ARN
 * registered separately, a rotated password kept alongside the old one during
 * transition. Trying them all here is what makes "not ours" mean what it says:
 * a file is only rejected once EVERY password this firm owns has failed on it,
 * not just the first one we happened to try.
 *
 * Returns the opened file, or null with the LAST error seen (a non-password
 * error — corrupt archive, unsupported format — takes priority when mixed with
 * password errors, since that's the more actionable diagnosis to surface).
 */
async function openWithAnyPassword(
  buf: Buffer,
  passwords: string[]
): Promise<{ ok: true; data: Uint8Array; filename: string; notes: string[] } | { ok: false; error: any; triedCount: number }> {
  const tryList = passwords.length ? passwords : [undefined];
  let lastNonPasswordErr: any = null;
  let lastErr: any = null;
  let tried = 0;
  for (const pw of tryList) {
    tried++;
    try {
      const r = await extractRtaFileFromZip(new Uint8Array(buf), pw);
      return { ok: true, data: r.data, filename: r.filename, notes: r.notes };
    } catch (e: any) {
      lastErr = e;
      if (!isWrongPasswordError(e?.message)) lastNonPasswordErr = e;
      // The archive opened and is unusable as it stands (no data file / several
      // data files). Another password cannot change that.
      if (e instanceof RtaArchiveError) break;
    }
  }
  return { ok: false, error: lastNonPasswordErr ?? lastErr, triedCount: tried };
}

/** Build the right message/status for an unzip failure, aware of how many passwords were tried. */
function classifyUnzipFailure(error: any, triedCount: number, hadAnyPassword: boolean): { rejected: boolean; message: string } {
  // Opened, but not importable as one file — say exactly why; never "not ours".
  if (error instanceof RtaArchiveError) return { rejected: false, message: error.message };
  if (hadAnyPassword && isWrongPasswordError(error?.message)) {
    return {
      rejected: true,
      message:
        triedCount > 1
          ? `Not this firm's file — none of the ${triedCount} saved passwords opened the archive, so it was ignored. ` +
            `(Multiple mailback subscriptions, or another platform's reports, can arrive at the same address.)`
          : NOT_OUR_FILE,
    };
  }
  return { rejected: false, message: `Could not open the zip — ${error?.message ?? "unsupported archive"}.` };
}

export type OpenedUpload =
  | { ok: true; data: Uint8Array; filename: string; notes: string[] }
  | { ok: false; rejected: boolean; message: string };

/**
 * The uploaded object → the one data file inside it, for BOTH import paths.
 *
 * What the upload is comes from its content (`detectRtaContainer`), not from
 * "starts with PK": an .xlsx / .xlsm / .xlsb is a zip of XML parts and used to
 * be "unzipped", importing one of its XML parts as the data. Now a workbook is
 * passed through as-is (the decoders read it as a spreadsheet), only a real
 * archive is unpacked — with every saved password, and only when it holds
 * exactly one data file — and a recognised non-data file (PDF, gzip, Word…)
 * fails with its reason.
 */
export async function openUpload(buf: Buffer, filename: string, passwords: string[]): Promise<OpenedUpload> {
  const kind = detectRtaContainer(buf, filename);
  if (kind.type === "unsupported") return { ok: false, rejected: false, message: kind.reason };
  if (kind.type !== "zip-archive") return { ok: true, data: buf, filename, notes: [] };

  const opened = await openWithAnyPassword(buf, passwords);
  if (!opened.ok) {
    const verdict = classifyUnzipFailure(opened.error, opened.triedCount, passwords.length > 0);
    return { ok: false, rejected: verdict.rejected, message: verdict.message };
  }
  const inner = detectRtaContainer(opened.data, opened.filename);
  if (inner.type === "zip-archive") {
    return {
      ok: false,
      rejected: false,
      message: `The archive's data file (${opened.filename}) is itself a zip archive. Archives are unpacked once — upload the inner file.`,
    };
  }
  if (inner.type === "unsupported") return { ok: false, rejected: false, message: `${opened.filename}: ${inner.reason}` };
  return { ok: true, data: opened.data, filename: opened.filename, notes: opened.notes };
}

/**
 * Mark the row `parsing` and wipe the previous attempt's outcome.
 *
 * A retry (re-import, rescan, stalled re-run) reuses the row. Its old remark,
 * counts and errors used to survive into the new run: the "clear a stale
 * failure remark" logic at the end of the job compared against the status
 * BEFORE that update — which this very step had already set to `parsing`, so
 * it never fired, and a re-imported `rejected` row that completed kept "Not
 * this firm's file…". Now the decision is made here, against the real
 * previous status: a failed / rejected attempt's remark goes; a provenance
 * note on a fresh row ("Auto-imported from forwarded email …", "Re-queued
 * after a new mailback password was saved") stays. Counts and errors always
 * go — NULL is what a not-yet-counted row holds.
 */
export async function markParsing(tenantId: string, importId: string, ctx: { userId: string; branchId?: string; roles: string[] }) {
  await withTenant(
    tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'parsing', parsed_at = now(),
            remarks = CASE WHEN status IN ('failed', 'rejected') THEN NULL ELSE remarks END,
            rows_total = NULL, rows_imported = NULL, rows_skipped = NULL, rows_failed = NULL,
            errors = NULL, summary = NULL
        WHERE id = ${importId}::uuid
      `);
    },
    ctx
  );
}

async function markRejected(job: RtaImportJob, reason: string, extra?: { checksum?: string; sizeBytes?: number }) {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  await withTenant(
    job.tenantId,
    async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'rejected', parsed_at = now(), remarks = ${cleanRemark(reason)},
            file_checksum = COALESCE(${extra?.checksum ?? null}, file_checksum),
            file_size_bytes = COALESCE(${extra?.sizeBytes ?? null}, file_size_bytes)
        WHERE id = ${job.importId}::uuid
      `);
    },
    ctx
  );
}

/** Shown on every archive we could not open — deliberately not phrased as an error. */
const NOT_OUR_FILE =
  "Not this firm's file — the archive is encrypted with a different password, " +
  "so it was ignored. (Other platforms' mailback reports can arrive at the same address.)";

/**
 * Idempotency guard. A worker restart (deploy / OOM) can leave a job 'stalled',
 * which BullMQ re-runs once. If the import already reached a terminal state the
 * re-run MUST be a no-op: the first run already deleted the transient S3 object,
 * so re-reading it throws "The specified key does not exist" — which, worse,
 * would CLOBBER a completed import back to failed. Skip when the row is terminal.
 */
async function importAlreadyFinished(job: {
  tenantId?: string;
  importId?: string;
  userId?: string;
  branchId?: string | null;
  roles?: string[];
}): Promise<boolean> {
  if (!job.tenantId || !job.importId || !job.userId) return false;
  try {
    return await withTenant(
      job.tenantId,
      async (tx) => {
        const r = await tx.execute(
          sql`SELECT status FROM rta_file_imports WHERE id = ${job.importId}::uuid LIMIT 1`
        );
        const st = (r.rows?.[0] as any)?.status as string | undefined;
        // ONLY a genuinely finished import counts. 'failed' and 'rejected' used
        // to be listed here too, which made every retry a silent no-op — and,
        // because the caller deletes the S3 object on this path, the retry also
        // DESTROYED the file it was meant to recover. That defeated the whole
        // point of keeping files on failure (see the `finally` block below):
        // re-queueing after a password fix deleted the archive instead of
        // importing it. A failed/rejected row must always be reprocessable.
        //
        // 'partial' is reprocessable too, and for the same reason: its skipped
        // rows are waiting on a folio master that may since have arrived. That
        // is safe because the row writes upsert, so a repeat is idempotent, and
        // because importSucceeded() no longer purges partial files — the object
        // is still there to re-read. Only 'completed' short-circuits, which is
        // the stalled-job case this guard was written for: that file IS gone.
        return st === "completed";
      },
      { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles ?? [] }
    );
  } catch {
    return false; // can't check → let the job run rather than silently drop it
  }
}

/** The actual import. Exported so it can be unit-tested / invoked one-off. */
export async function runRtaImportJob(job: RtaImportJob): Promise<void> {
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  const { importId, tenantId, source, kind, key, filename } = job;

  // 1. Mark parsing (and clear the previous attempt's outcome).
  await markParsing(tenantId, importId, ctx);

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
  // NO blanket size cap. A CAMS/KFintech master is legitimately hundreds of MB
  // and CSV/TXT never enters SheetJS — it is read as a string and streamed into
  // the parsers, so its cost is linear and bounded. The ONLY format that needs a
  // ceiling is a spreadsheet (.xls/.xlsx/.xlsb/.xlsm/.dbf), because XLSX.read()
  // materialises the entire workbook as an in-memory cell graph; that guard
  // lives in decodeRtaToText (SPREADSHEET_MAX_BYTES, tunable via
  // RTA_SPREADSHEET_MAX_BYTES) and is applied AFTER unzip, to the real payload
  // rather than to the compressed archive.

  // Checksum the ORIGINAL bytes so re-uploading the identical file dedupes.
  const checksum = createHash("sha256").update(buf).digest("hex");

  // NOTE: we deliberately do NOT hard-reject a re-uploaded (same-checksum) file.
  // The feed processors are upsert-idempotent (and the master/rich path upserts),
  // so re-importing is safe — and blocking it stranded users who needed to retry
  // a previously-failed or partial import. Re-import just refreshes in place.

  // 3. Identify by content; unzip a real archive (password-protected RTA
  //    mailbacks); then decode to pipe text.
  const opened = await openUpload(buf, filename, candidatePasswords(job));
  if (!opened.ok) {
    const extra = { checksum, sizeBytes: buf.length };
    if (opened.rejected) await markRejected(job, opened.message, extra);
    else await markFailed(job, opened.message, extra);
    return;
  }
  const archiveNote = opened.notes.length ? opened.notes.join(" ") : null;

  // Decode can legitimately REFUSE — a spreadsheet too large to hold in memory
  // (RtaFileTooLargeError), a password-protected workbook, a file it cannot
  // read. That message tells the operator exactly what to change, so it has to
  // land on the row; letting it escape to BullMQ leaves the row stuck in
  // 'parsing' with the advice buried in the worker log.
  let text: string;
  try {
    text = decodeRtaToText(opened.data, opened.filename);
  } catch (e: any) {
    await markFailed(job, e?.message ?? "Could not decode the file.", { checksum, sizeBytes: buf.length });
    return;
  }
  // Free the large buffers before the (memory-heavy) parse so they can be GC'd.
  opened.data = new Uint8Array(0);
  buf = Buffer.alloc(0);

  // 4 + 5. Process in one tenant transaction, then persist counters.
  // The parser's own failure, kept outside the transaction: if it was a
  // database error the transaction is aborted, the in-tx UPDATE below fails
  // too, and the outer catch should record THIS reason, not "current
  // transaction is aborted".
  let failure: string | null = null;
  try {
    await withTenant(
      tenantId,
      async (tx) => {
        let outcome;
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
                remarks = ${cleanRemark(failure ?? "unknown error")}
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

        // "completed · 0 rows" reads exactly like a silent failure, and it sent
        // us hunting for a parser bug that did not exist. A registrar quite
        // legitimately returns a report with only a header row — KFintech's
        // MFSD313 SIP register does it whenever no SIP was registered in the
        // period. Say so, so the next person doesn't have to re-derive it.
        const emptyNote =
          outcome.rowsTotal === 0
            ? "The registrar returned an empty report — a header row and no data. Nothing to import; this is not an error."
            : null;

        await tx.execute(sql`
          UPDATE rta_file_imports
          SET status = ${status}, parsed_at = now(), file_checksum = ${checksum},
              -- A stale FAILURE remark is cleared when this attempt STARTS
              -- (markParsing): a row that was 'rejected' ("Not this firm's file
              -- …") and is now 'completed' used to keep that text forever —
              -- 1,146 healthy rows in production read that way. What is left
              -- here is a provenance note, if any; an archive's ignored-files
              -- note is appended to it.
              remarks = NULLIF(concat_ws(' ', COALESCE(${emptyNote}::text, remarks), ${archiveNote}::text), ''),
              period_start = ${isoDateOrToday(outcome.periodStart)}::date,
              period_end = ${isoDateOrToday(outcome.periodEnd)}::date,
              rows_total = ${outcome.rowsTotal},
              rows_imported = ${outcome.rowsImported},
              rows_skipped = ${outcome.rowsSkipped},
              rows_failed = ${outcome.rowsFailed},
              errors = ${JSON.stringify(
                // Postgres's jsonb parser rejects an embedded NUL character escape outright
                // ("unsupported Unicode escape sequence") — the same NUL
                // restriction as a text column, just enforced at JSON-parse
                // time instead of at the encoding layer. JSON.stringify
                // always escapes a raw NUL char in a JS string to that exact
                // sequence, so stripping it from each reason BEFORE
                // stringifying (not after — regexing finished JSON text is
                // fragile) is what keeps this cast from throwing the same way
                // the `remarks` write above did.
                outcome.errors.map((e) => ({ ...e, reason: sanitizeText(e.reason) }))
              )}::jsonb
          WHERE id = ${importId}::uuid
        `);
      },
      ctx
    );
  } catch (e: any) {
    await markFailed(job, failure ?? e?.message ?? "import failed", { checksum });
  }
}

/** Byte length of the decoded text (file_size_bytes when the original buffer is freed). */
function dataLen(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Guard a derived period date before it reaches a `::date` cast.
 *
 * periodStart/periodEnd are the min/max of whatever the parser read out of the
 * date column. When a report has an unexpected layout those can come back as
 * junk — a real KFintech feed produced `period_start='42'`, `period_end='Status'`
 * — and Postgres then rejects the ENTIRE status UPDATE. The import's real row
 * counts were lost and the operator saw a raw SQL dump as the failure reason.
 *
 * A wrong-but-valid date is a cosmetic problem; a failed status write is not.
 */
function isoDateOrToday(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date().toISOString().slice(0, 10);
  return Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? new Date().toISOString().slice(0, 10) : s;
}

/**
 * Did this job's row actually end up imported? Drives whether the source file is
 * purged from S3 — a failed import KEEPS its file so a credential fix can retry
 * it. `partial` counts as done: rows landed, and the skipped ones are recorded
 * per-row, so re-running the whole file adds nothing.
 */
async function importSucceeded(job: { importId?: string }): Promise<boolean> {
  if (!job?.importId) return false;
  try {
    return await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT status FROM rta_file_imports WHERE id = ${job.importId}::uuid LIMIT 1
      `);
      const status = (r.rows[0] as any)?.status as string | undefined;
      // 'partial' deliberately does NOT purge. A partial import is one where
      // some rows were skipped for a reason that resolves later — nearly always
      // "folio not in client master", because the transaction feed arrived
      // before the folio master. Once the master imports, re-running the feed
      // picks those rows up. Purging on 'partial' threw the file away and made
      // the skipped rows permanently unrecoverable: one KFintech feed for VSN
      // Financial Services dropped 198 rows across 11 folios that way.
      return status === "completed";
    });
  } catch {
    // If we can't tell, keep the file. Retaining a stale object is cheap;
    // deleting one that's still needed is not recoverable.
    return false;
  }
}

/**
 * True when no OTHER import row still needs this S3 object.
 *
 * The same registrar mail forwarded from several mailboxes creates several
 * `rta_file_imports` rows pointing at ONE object. Purging on the first success
 * deleted the file while its siblings were still queued, so they failed with
 * "The specified key does not exist" and were recorded as real failures —
 * turning a harmless duplicate into a fake error and, worse, into an
 * unrecoverable one once the mail aged out of the registrar's link window.
 *
 * A sibling that has already reached a terminal state doesn't count: `completed`
 * is done with the bytes, and `rejected`/`failed` keep the object only so a
 * credential fix can retry — but that retry re-reads from S3, so the object must
 * survive for them too. Hence: keep the object while ANY other live row points
 * at it, terminal or not, and let the retention sweep reclaim it later.
 */
async function isLastLiveClaimOnObject(key: string, selfImportId?: string): Promise<boolean> {
  try {
    return await withSystem(async (tx) => {
      const r = await tx.execute(sql`
        SELECT count(*)::int AS n
        FROM rta_file_imports
        WHERE file_key = ${key}
          AND deleted_at IS NULL
          AND id <> ${selfImportId ?? "00000000-0000-0000-0000-000000000000"}::uuid
      `);
      return Number((r.rows[0] as any)?.n ?? 0) === 0;
    });
  } catch {
    // Can't tell — keep the object. Retaining a stale object is cheap; deleting
    // one another row still needs is not recoverable.
    return false;
  }
}

/**
 * Reap rows stuck in `parsing` — if the worker died mid-parse (e.g. OOM on a
 * huge file), nothing resets the row and the UI poll spins forever. Mark them
 * failed once they have been `parsing` longer than the job is ALLOWED to run
 * plus a margin (`rtaJobTiming`) — it used to be 60 min against a 180-min job
 * timeout, which failed live imports. Never auto-retried (a half-applied import is upsert-safe
 * but re-running a giant file just risks another OOM — the user re-uploads).
 */
async function reapStuckParsing(): Promise<number> {
  // Is anything actually moving through the queue right now? Concurrency is 1,
  // so a legitimate backlog can sit at 'uploaded' for a long time — far past any
  // fixed timeout. Reaping on age alone marked those queued-but-waiting rows
  // "the worker was busy or restarting", which was both wrong and alarming.
  // Only declare a queued row lost when the queue itself is genuinely empty.
  let queueBusy = false;
  try {
    const q = Q.rtaImport();
    const counts = await q.getJobCounts("wait", "active", "delayed", "paused");
    queueBusy = (counts.wait ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.paused ?? 0) > 0;
  } catch {
    // Can't read the queue → assume busy and reap nothing. A row left spinning
    // is recoverable; a wrongly-failed row confuses the operator.
    queueBusy = true;
  }

  const reaped = await withSystem(async (tx) => {
    // (1) Parse started but never finished (worker died/OOM mid-parse).
    // (2) Enqueued but no job exists to run it — only when the queue is idle.
    const rows = await tx.execute(sql`
      UPDATE rta_file_imports
      SET status = 'failed', parsed_at = COALESCE(parsed_at, now()),
          remarks = COALESCE(NULLIF(remarks, ''), 'Import didn''t finish — the worker restarted mid-parse. Re-upload to retry.')
      WHERE (
        (status = 'parsing' AND parsed_at IS NOT NULL
          AND parsed_at < now() - make_interval(mins => ${TIMING.reapParsingAfterMin}::int))
        ${queueBusy ? sql`` : sql`OR (status IN ('uploaded', 'queued') AND created_at < now() - interval '20 minutes')`}
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
  /** @deprecated single-password shape — still honoured, superseded by `passwords`. */
  password?: string;
  /** Every saved password for this source, tried in order until one opens the archive. */
  passwords?: string[];
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
  /** True when the file simply is not this firm's (wrong-password archive). */
  notOurs?: boolean;
  source?: string;
  reportType?: string;
  totalRows?: number;
  missingPan?: number;
  /** Parser warnings (e.g. invalid PAN values treated as no PAN) — counts only, no values. */
  warnings?: string[];
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

  // Identify by content; unzip a real archive (password-protected RTA
  // mailbacks) to its one data file. A workbook passes through as-is.
  const opened = await openUpload(buf, job.filename, candidatePasswords(job));
  if (!opened.ok) return { ok: false, notOurs: opened.rejected, error: opened.message };
  let data: Uint8Array = opened.data;
  const innerName = opened.filename;
  buf = Buffer.alloc(0); // free the original before the heavy parse

  report?.({ phase: "Parsing file", pct: 8 });
  // A workbook (CAMS R9 .xls, an .xlsx, a .dbf) via SheetJS; anything else as
  // delimited text, decoded BOM / UTF-8 / UTF-16 aware (it used to be latin-1,
  // which glued a UTF-8 BOM to the first header and garbled UTF-8 names).
  const parsed = isSpreadsheet(data, innerName)
    ? parseRtaRows(readSpreadsheetToRows(data, innerName))
    : parseRtaCsv(decodeTextBytes(data));
  data = new Uint8Array(0);

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
      captureError("[rta-import] post-import AUM rollup failed", maskedError(err), { tenantId: job.tenantId });
    }
  }

  const notes = [...opened.notes, ...parsed.warnings.map(maskPansInText)];
  return {
    ok: true,
    source: parsed.source,
    reportType: parsed.reportType,
    totalRows: parsed.totalRows,
    missingPan: parsed.missingPan,
    warnings: notes.length ? notes : undefined,
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
  // Capture ANY throw (parse error, DB error, quota throw, transient failure)
  // so the rta_file_imports row is marked failed with the REAL reason here —
  // instead of being left in `parsing` for the 20-min reaper to fail with the
  // generic "worker was busy or restarting" message (which masks the cause and
  // makes a master import look perpetually stuck). This mirrors the feed path's
  // try/catch in runRtaImportJob.
  const ctx = { userId: job.userId, branchId: job.branchId ?? undefined, roles: job.roles };
  // Like the feed path: show `parsing` while the import runs (a master import
  // used to sit at `uploaded` for its whole run, so the reaper and the inbox
  // poller's in-flight check both misread it), and clear the previous
  // attempt's outcome. A failure here must not stop the import itself.
  if (job.importId) {
    try {
      await markParsing(job.tenantId, job.importId, ctx);
    } catch (e) {
      captureError("[rta-import] could not mark rich import parsing", maskedError(e), { tenantId: job.tenantId, importId: job.importId });
    }
  }

  let result: RichImportResult;
  try {
    result = await computeRichImport(job, report);
  } catch (e: any) {
    captureError("[rta-import] rich import threw", maskedError(e), { tenantId: job.tenantId, importId: job.importId });
    result = { ok: false, error: e?.message ? `Import failed: ${e.message}` : "Import failed unexpectedly." };
  }
  if (result.error) result.error = cleanRemark(result.error) ?? undefined;
  if (job.importId) {
    await withTenant(
      job.tenantId,
      async (tx) => {
        if (!result.ok) {
          // "Not ours" is a routine no-op, not a failure the operator must act on.
          // NUL bytes stripped and PANs masked (cleanRemark, above) — a NUL in
          // the message made this very UPDATE throw and orphaned the row in
          // `parsing`. Counts / errors / summary cleared: they belong to an
          // earlier attempt, not to this failure.
          const status = result.notOurs ? "rejected" : "failed";
          await tx.execute(sql`
            UPDATE rta_file_imports SET status = ${status}, parsed_at = now(),
              remarks = ${result.error ?? "import failed"},
              rows_total = NULL, rows_imported = NULL, rows_skipped = NULL, rows_failed = NULL,
              errors = NULL, summary = NULL
            WHERE id = ${job.importId}::uuid
          `);
          return;
        }
        const s = result.summary;
        // Folios the importer held back (client in Trash, ambiguous, or filed
        // under another client) were counted as created/updated in the
        // preview figures but not written: report them as skipped, with their
        // reasons in the row's error list where the Exceptions page finds them.
        const held = s?.exceptions ?? [];
        const imported = Math.max(0, (s?.folios.created ?? 0) + (s?.folios.updated ?? 0) - held.length);
        const skipped = (s?.folios.skippedNoPan ?? 0) + held.length;
        const total = s?.folios.total ?? 0;
        const rowErrors = [
          ...held.map((e) => ({ row: e.row, reason: sanitizeText(e.reason) ?? "" })),
          ...(s && s.moved.folios > 0
            ? [{ row: 0, reason: `${s.moved.folios} folio(s) moved from an import placeholder to their PAN-keyed client, with ${s.moved.transactions} transaction(s) and ${s.moved.sips} SIP(s)` }]
            : []),
        ];
        const status = imported === 0 ? "failed" : skipped > 0 ? "partial" : "completed";
        const remarks = cleanRemark(
          [
            s ? `${s.investors.created} new + ${s.investors.updated} updated clients · ${s.folios.total} folios · ${s.amcs.length} AMCs` : null,
            ...(result.warnings ?? []),
          ]
            .filter(Boolean)
            .join(" · ") || null
        );
        await tx.execute(sql`
          UPDATE rta_file_imports SET status = ${status}, parsed_at = now(),
            rows_total = ${total}, rows_imported = ${imported}, rows_skipped = ${skipped}, rows_failed = 0,
            remarks = ${remarks},
            errors = ${rowErrors.length ? JSON.stringify(rowErrors) : null}::jsonb,
            summary = ${s ? JSON.stringify(s) : null}::jsonb
          WHERE id = ${job.importId}::uuid
        `);
      },
      ctx
    );
  }
  return result;
}

/**
 * Re-try every archive we previously gave up on, using the firm's CURRENT
 * password list.
 *
 * A `rejected` row means "no saved password opened this archive". That is the
 * normal outcome for another platform's report arriving at the same address —
 * but it is ALSO what a firm's own files look like before they have entered the
 * password for that ARN's mailback subscription. Since the source file is kept
 * on failure (see the purge note in the worker below), adding the missing
 * password can recover the whole backlog — but only if something goes back and
 * re-tries it. Without this, a firm fixes their password and still sees months
 * of "not ours" rows, because nothing ever revisits them.
 *
 * Only files that ACTUALLY OPEN are re-queued; anything still locked is left
 * `rejected` and counted, so a rescan can never spam the import dashboard with
 * files that belong to somebody else.
 */
export type RtaRescanJob = {
  mode: "rescan";
  tenantId: string;
  source: RtaSource;
};

/** Bound the work a single rescan does — a busy shared address holds thousands. */
const RESCAN_MAX_FILES = 1000;
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

export async function runRejectedRescanJob(
  job: RtaRescanJob
): Promise<{ requeued: number; stillLocked: number; scanned: number }> {
  const cfg = await withTenant(job.tenantId, async (tx) => getMailbackPasswords(tx, job.tenantId));
  // Every saved password, not just the ones saved under this registrar: a
  // password saved under KFintech can be the one a firm's CAMS reports open
  // with, so a new password of either kind is retried on every locked archive.
  const passwords = passwordsToTry(cfg, job.source);
  if (!passwords.length) return { requeued: 0, stillLocked: 0, scanned: 0 };

  const rows = await withTenant(job.tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT id, source, kind, file_name, file_key
      FROM rta_file_imports
      WHERE deleted_at IS NULL
        AND status = 'rejected'
        AND file_key IS NOT NULL
      ORDER BY created_at ASC
      LIMIT ${RESCAN_MAX_FILES}`);
    return r.rows as Array<{ id: string; source: RtaSource; kind: RtaFileKind; file_name: string; file_key: string }>;
  });

  let requeued = 0;
  let stillLocked = 0;
  const jobOpts = { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;

  for (const r of rows) {
    let buf: Buffer;
    try {
      buf = await getObjectBytes(r.file_key);
    } catch {
      continue; // object already purged — nothing to retry
    }
    // Only ZIP ARCHIVES carry a password; link-downloaded CSVs arrive in the
    // clear, and an .xlsx is a zip but not an archive. An archive that opens
    // but cannot be imported as it stands (several data files) is re-queued so
    // the import records that reason instead of "not ours".
    if (detectRtaContainer(buf, r.file_name).type === "zip-archive") {
      const opened = await openWithAnyPassword(buf, passwords);
      if (!opened.ok && !(opened.error instanceof RtaArchiveError)) {
        stillLocked++;
        continue;
      }
    }

    // The worker treats `rejected`/`failed` as terminal and short-circuits, so
    // the row MUST be reset before the job is queued or it will be dropped.
    await withTenant(job.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE rta_file_imports
        SET status = 'uploaded', parsed_at = NULL, errors = NULL,
            remarks = 'Re-queued after a new mailback password was saved'
        WHERE id = ${r.id}::uuid`);
    });

    if (RICH_KINDS.has(r.kind)) {
      await Q.rtaImport().add(
        "rich-import",
        {
          mode: "rich", importId: r.id, tenantId: job.tenantId, key: r.file_key,
          filename: r.file_name, passwords, rta: r.source, reportType: "",
          dryRun: false, assignToMe: false, userId: SYSTEM_USER, roles: [],
        },
        jobOpts
      );
    } else {
      await Q.rtaImport().add(
        "import",
        {
          importId: r.id, tenantId: job.tenantId, source: r.source, kind: r.kind,
          key: r.file_key, filename: r.file_name, passwords,
          userId: SYSTEM_USER, roles: [],
        },
        jobOpts
      );
    }
    requeued++;
  }

  console.log(
    `[rta-import] rescan ${job.tenantId}/${job.source}: ${requeued} re-queued, ${stillLocked} still locked, ${rows.length} scanned`
  );
  return { requeued, stillLocked, scanned: rows.length };
}

/** Queue a rescan of a firm's rejected archives for one registrar. */
export async function enqueueRejectedRescan(tenantId: string, source: RtaSource): Promise<void> {
  await Q.rtaImport().add(
    "rescan",
    { mode: "rescan", tenantId, source } satisfies RtaRescanJob,
    { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } }
  );
}

/**
 * Hard ceiling on one import job, in minutes. A since-inception CAMS WBR2 is a
 * 38 MB zip that expands to 326 MB and 512,916 rows, so this has to be generous
 * — it is a backstop against a WEDGED job, not a performance budget.
 */
const JOB_TIMEOUT_MS = TIMING.jobTimeoutMin * 60_000;

/**
 * Fail a job that has stopped making progress instead of holding the queue.
 *
 * With concurrency 1, one job that never settles is a total outage of imports
 * for every firm — which is exactly what happened: a job hung in an untimed S3
 * delete for fourteen hours while 140 files queued up behind it across four
 * tenants, and nothing surfaced it. BullMQ could not help: its stalled-job
 * detection only fires when the LOCK expires, and the worker was alive and
 * happily renewing it.
 *
 * The underlying promise cannot be cancelled, so the orphaned work may continue
 * in the background; that is acceptable because the import is upsert-idempotent
 * and the row is reaped separately. What matters is that the queue moves on.
 */
async function withJobTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${JOB_TIMEOUT_MS / 60_000} min and was abandoned so the queue can continue`)),
          JOB_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function startRtaImportWorker() {
  // BullMQ workers need their own blocking connection (maxRetriesPerRequest:null).
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    "rta.import",
    (job) => withJobTimeout(`[rta-import] job ${job.id}`, async () => {
      const localKey = (job.data as any)?.key as string | undefined;
      // Idempotency: if a worker restart left this job 'stalled' and BullMQ is
      // re-running it after the import already finished, do NOT reprocess — that
      // re-reads the already-deleted S3 object ("specified key does not exist")
      // and could clobber a completed import. Just clean up and return.
      if (await importAlreadyFinished(job.data as any)) {
        if (localKey) await deleteObject(localKey).catch(() => {});
        return;
      }
      try {
        // A rescan queues OTHER jobs rather than importing anything itself, so
        // it must be dispatched before the import paths (it carries no key).
        if ((job.data as any)?.mode === "rescan") {
          return await runRejectedRescanJob(job.data as RtaRescanJob);
        }
        // Rich master/holdings import returns its summary (UI polls for it);
        // the feed import updates the rta_file_imports row and returns nothing.
        if ((job.data as any)?.mode === "rich") {
          // Forward live progress to BullMQ so /api/rta/import-status (and the UI
          // bar + ETA) can read it. updateProgress is fire-and-forget.
          const summary = await runRichImportJob(job.data as RichImportJob, (p) => {
            void job.updateProgress(p as any);
          });
          await matchBookedBusinessAfterImport((job.data as any)?.tenantId);
          await syncRtaJourneysAfterImport((job.data as any)?.tenantId);
          return summary;
        }
        await runRtaImportJob(job.data as RtaImportJob);
        // New RTA rows can confirm or reject business the team booked
        // (lib/business/rta-match.ts). Best effort — never fails the import.
        await matchBookedBusinessAfterImport((job.data as RtaImportJob).tenantId);
        // …and settle clients whose physical forms are with the RTA (lib/blueprints/rta-route.ts).
        await syncRtaJourneysAfterImport((job.data as RtaImportJob).tenantId);
      } finally {
        // Purge the source file ONLY once it has actually been imported.
        //
        // This used to purge on success OR failure, which quietly made every
        // failure permanent: the commonest failure is a wrong ZIP password, and
        // deleting the file means fixing the password can never recover it — the
        // firm has to re-request the report from the registrar. Keeping the file
        // on failure makes a credential fix a genuine retry.
        //
        // Status is re-read rather than inferred from "didn't throw", because the
        // import records its own failure in the row and returns normally.
        //
        // ...and only once no OTHER live import row still points at the same
        // object. One registrar mail forwarded from several mailboxes produces
        // several rows sharing one file_key; the first to finish used to delete
        // the object out from under its siblings, which then failed with "The
        // specified key does not exist" and were recorded as genuine failures.
        if (localKey && (await importSucceeded(job.data as any))) {
          if (await isLastLiveClaimOnObject(localKey, (job.data as any)?.importId)) {
            await deleteObject(localKey).catch(() => {});
          }
        }
      }
    }),
    { connection, concurrency: 1 } // one heavy parse at a time — bounds peak memory
  );

  worker.on("failed", (job, err) => {
    captureError("[rta-import] job failed", maskedError(err), { importId: (job?.data as RtaImportJob)?.importId });
  });

  // Stuck-row reaper, every 5 minutes.
  const reapHandle = setInterval(async () => {
    try {
      const n = await reapStuckParsing();
      if (n > 0) console.log(`[rta-import] reaped ${n} stuck parsing row(s)`);
    } catch (err) {
      captureError("[rta-import] reaper error", maskedError(err));
    }
  }, 5 * 60 * 1000);
  reapHandle.unref?.();

  console.log(
    `[rta-import] worker started (concurrency=1, job timeout ${TIMING.jobTimeoutMin}m, reaper every 5m fails rows parsing > ${TIMING.reapParsingAfterMin}m)`
  );
  return () => {
    clearInterval(reapHandle);
    void worker.close();
    void connection.quit();
  };
}
