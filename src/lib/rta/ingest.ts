/**
 * Shared RTA ingest helper — reserve an rta_file_imports row, run the
 * processor, and stamp the result. Used by the manual upload route's logic and
 * by the automated feed-ingestion worker so both behave identically (dedupe by
 * checksum, idempotent processing, accurate status).
 *
 * Two entry points:
 *   - `ingestRtaFile` takes the file's BYTES and goes through the same
 *     content detection and decoders as the upload worker (file-kind.ts →
 *     unzip.ts → decode.ts): a plain zip with one data file is unpacked, a
 *     workbook is read as a spreadsheet with timezone-proof dates, text is
 *     decoded BOM / UTF-8 / UTF-16 aware. A drop folder has no password, so an
 *     encrypted archive fails with that reason.
 *   - `ingestRtaText` takes already-decoded text. The drop-folder poller
 *     (workers/feed-ingest.ts) still calls it with the file read as UTF-8, so
 *     it now REFUSES text that is evidently a binary file read as UTF-8 — a
 *     zip, an Excel workbook, a DBF, UTF-16 — with an explicit reason, instead
 *     of letting the parser report "unrecognised header" or import garbage.
 *     Moving feed-ingest.ts to `ingestRtaFile` lifts that restriction.
 */

import { resolvePipelineMode } from "./staging/config";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { RtaFileKind, RtaSource } from "@/db/schema/rta_imports";
import { processRtaFile } from "./process";
import { decodeRtaToText } from "./decode";
import { detectRtaContainer } from "./file-kind";
import { extractRtaFileFromZip } from "./unzip";
import { maskPansInText } from "./values";

export type IngestArgs = {
  tenantId: string;
  source: RtaSource;
  kind: RtaFileKind;
  fileName: string;
  text: string;
  /** Who/what ingested it (null for the automated feed). */
  uploadedBy?: string | null;
};

export type IngestResult = {
  duplicate?: boolean;
  importId: string | null;
  status: string;
  rowsTotal?: number;
  rowsImported?: number;
  rowsSkipped?: number;
  rowsFailed?: number;
  error?: string | null;
};

/** Strip what Postgres text / jsonb rejects (NUL and other C0 controls) and mask PANs. */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately stripping NUL + other C0 control chars
  return maskPansInText(s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""));
}

/** A derived period date, or today when the parser produced something that is not one. */
function isoDateOrToday(v: unknown): string {
  const s = String(v ?? "").trim();
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return today;
  return Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? today : s;
}

/**
 * Why this "text" cannot be parsed, or null when it looks like real delimited
 * text. Recognises the binary files a drop folder realistically receives,
 * after they have been read as UTF-8 (which is lossy, so they cannot be
 * recovered from the string — only refused).
 */
export function binaryTextReason(text: string): string | null {
  const head = text.slice(0, 4096);
  if (head.startsWith("PK\u0003\u0004") || head.startsWith("PK\u0005\u0006")) {
    return "This drop-folder file is a zip archive or an .xlsx workbook, but it was handed to the importer as text. Use the byte-level ingest (ingestRtaFile), or drop the CSV / TXT itself.";
  }
  if (head.includes("\u0000")) {
    return "This drop-folder file is binary (an Excel .xls, a DBF, or UTF-16 text), but it was handed to the importer as text. Use the byte-level ingest (ingestRtaFile), or drop a UTF-8 CSV / TXT.";
  }
  return null;
}

/** Reserve a row that records a failure before any parsing happened. */
async function recordFailedIngest(tx: Tx, args: Omit<IngestArgs, "text">, checksum: string, sizeBytes: number, reason: string) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await tx.execute(sql`
    INSERT INTO rta_file_imports (
      tenant_id, source, kind, period_start, period_end,
      file_name, file_key, file_size_bytes, file_checksum, status, parsed_at, remarks, uploaded_by
    ) VALUES (
      ${args.tenantId}::uuid, ${args.source}, ${args.kind}, ${today}::date, ${today}::date,
      ${args.fileName}, ${"feed:" + checksum.slice(0, 12)},
      ${sizeBytes}, ${checksum}, 'failed', now(), ${clean(reason).slice(0, 1000)},
      ${args.uploadedBy ?? null}
    )
    RETURNING id
  `);
  return (r.rows[0] as any).id as string;
}

export type IngestFileArgs = Omit<IngestArgs, "text"> & { bytes: Uint8Array };

/**
 * Ingest a drop-folder file from its BYTES — the same detection and decoders
 * as the upload worker. Any refusal (encrypted or multi-file archive, PDF,
 * password-protected workbook, oversized spreadsheet) is recorded as a
 * `failed` row with the reason, then returned.
 */
export async function ingestRtaFile(tx: Tx, args: IngestFileArgs): Promise<IngestResult> {
  const { bytes, ...rest } = args;
  let data = bytes;
  let name = args.fileName;
  let text: string;
  try {
    if (detectRtaContainer(bytes, name).type === "zip-archive") {
      const inner = await extractRtaFileFromZip(bytes); // a drop folder has no password
      data = inner.data;
      name = inner.filename;
    }
    text = decodeRtaToText(data, name);
  } catch (e: any) {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const reason = e?.message ?? "Could not read the file.";
    const importId = await recordFailedIngest(tx, rest, checksum, bytes.length, reason);
    return { importId, status: "failed", error: clean(reason) };
  }
  return ingestRtaText(tx, { ...rest, text });
}

export async function ingestRtaText(tx: Tx, args: IngestArgs): Promise<IngestResult> {
  // A BOM read as UTF-8 survives as U+FEFF glued to the first header.
  if (args.text.charCodeAt(0) === 0xfeff) args = { ...args, text: args.text.slice(1) };
  const checksum = createHash("sha256").update(args.text, "utf8").digest("hex");

  // A firm on validate-first (or refused it) never gets the existing importer
  // from the drop folder either — that path used to ignore the pipeline mode.
  const mode = await resolvePipelineMode(args.tenantId);
  // Paused / halted / emergency: write NOTHING and record nothing — the file
  // stays in the drop folder and is picked up again once the firm is resumed.
  if (mode.mode === "held") {
    return { importId: null, status: "held", error: mode.refused ?? "RTA imports are paused for this firm" };
  }
  if (mode.mode === "validate_first" || mode.mode === "validate_first_refused") {
    const { text, ...rest } = args;
    const why = mode.mode === "validate_first"
      ? "This firm imports RTA files validate-first; the drop folder does not run that path. Upload the file or let the mailbox poller take it."
      : `Validate-first is refused for this firm (${mode.refused ?? "posting controls"}); the drop-folder file was not imported.`;
    const importId = await recordFailedIngest(tx, rest, checksum, Buffer.byteLength(text, "utf8"), why);
    return { importId, status: "failed", error: why };
  }

  const binary = binaryTextReason(args.text);
  if (binary) {
    const { text, ...rest } = args;
    const importId = await recordFailedIngest(tx, rest, checksum, Buffer.byteLength(text, "utf8"), binary);
    return { importId, status: "failed", error: binary };
  }

  // Dedupe — same checksum within this kind/source already imported?
  const dupe = await tx.execute(sql`
    SELECT id, status FROM rta_file_imports
    WHERE tenant_id = ${args.tenantId}::uuid AND kind = ${args.kind} AND source = ${args.source}
      AND file_checksum = ${checksum}
      AND status IN ('completed', 'partial')
    LIMIT 1
  `);
  if (dupe.rows.length > 0) {
    return {
      duplicate: true,
      importId: (dupe.rows[0] as any).id,
      status: (dupe.rows[0] as any).status,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const reserve = await tx.execute(sql`
    INSERT INTO rta_file_imports (
      tenant_id, source, kind, period_start, period_end,
      file_name, file_key, file_size_bytes, file_checksum, status, uploaded_by
    ) VALUES (
      ${args.tenantId}::uuid, ${args.source}, ${args.kind}, ${today}::date, ${today}::date,
      ${args.fileName}, ${"feed:" + checksum.slice(0, 12)},
      ${Buffer.byteLength(args.text, "utf8")}, ${checksum}, 'parsing',
      ${args.uploadedBy ?? null}
    )
    RETURNING id
  `);
  const importId = (reserve.rows[0] as any).id as string;

  let outcome;
  let failure: string | null = null;
  try {
    outcome = await processRtaFile(tx, {
      tenantId: args.tenantId,
      source: args.source,
      kind: args.kind,
      text: args.text,
    });
  } catch (e: any) {
    failure = e?.message ?? "Unknown parser error";
  }

  if (failure || !outcome) {
    const reason = clean(failure ?? "unknown error").slice(0, 1000);
    await tx.execute(sql`
      UPDATE rta_file_imports
        SET status = 'failed', parsed_at = now(), remarks = ${reason}
      WHERE id = ${importId}::uuid
    `);
    return { importId, status: "failed", error: reason };
  }

  const status =
    outcome.rowsFailed > 0 || outcome.rowsSkipped > 0
      ? outcome.rowsImported === 0
        ? "failed"
        : "partial"
      : "completed";

  await tx.execute(sql`
    UPDATE rta_file_imports
      SET status = ${status}, parsed_at = now(),
          -- Same guards as the upload worker: a junk derived date must not
          -- abort the status write, and a NUL in a reason makes the jsonb cast
          -- throw.
          period_start = ${isoDateOrToday(outcome.periodStart)}::date,
          period_end = ${isoDateOrToday(outcome.periodEnd)}::date,
          rows_total = ${outcome.rowsTotal}, rows_imported = ${outcome.rowsImported},
          rows_skipped = ${outcome.rowsSkipped}, rows_failed = ${outcome.rowsFailed},
          errors = ${JSON.stringify(outcome.errors.map((e) => ({ ...e, reason: clean(String(e.reason ?? "")) })))}::jsonb
    WHERE id = ${importId}::uuid
  `);

  return {
    importId,
    status,
    rowsTotal: outcome.rowsTotal,
    rowsImported: outcome.rowsImported,
    rowsSkipped: outcome.rowsSkipped,
    rowsFailed: outcome.rowsFailed,
  };
}
