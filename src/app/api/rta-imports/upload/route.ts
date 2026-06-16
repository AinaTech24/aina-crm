import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { RTA_FILE_KINDS, RTA_SOURCES } from "@/db/schema/rta_imports";
import { processRtaFile } from "@/lib/rta/process";
import { decodeRtaToText } from "@/lib/rta/decode";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { getObjectBytes } from "@/lib/storage/s3";

/**
 * POST /api/rta-imports/upload
 *
 * Multipart upload of an RTA file (CSV / pipe-delimited / text).
 * Steps:
 *   1. Validate (source, kind) + file presence
 *   2. Read body as text, checksum it (dedupe)
 *   3. Insert rta_file_imports row in `parsing` state
 *   4. Run processRtaFile() in the same transaction
 *   5. Update the import row with counters + status
 *
 * Files larger than ~5MB should be uploaded via presigned URL to S3 then
 * processed by a background worker. v1 keeps it synchronous.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  source: z.enum(RTA_SOURCES),
  kind: z.enum(RTA_FILE_KINDS),
  /** S3 object key the browser PUT the file to (via a presigned URL). */
  key: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
  password: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireSession();
  // Only ops / back-office / owner / compliance can ingest RTA files
  // (anyone who can execute transactions can also ingest the daily feed).
  requireCap(session.roles, "transactions.execute");
  await assertActiveLicense(session.tenantId, session.roles);

  // The browser PUTs the file DIRECTLY to S3 via a presigned URL (see
  // /api/rta-imports/upload-url), bypassing the app server's ~10MB request-body
  // limit entirely. This request carries only the small JSON {source,kind,key,…}
  // and the server downloads the FULL object from S3 to parse it.
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { source, kind, key, filename: fileName, password: headerPassword } = parsed.data;

  let buf: Buffer;
  try {
    buf = await getObjectBytes(key);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not read the uploaded file from storage — ${e?.message ?? "object not found"}.` },
      { status: 400 }
    );
  }
  if (buf.length === 0) {
    return NextResponse.json({ error: "empty upload — no file received" }, { status: 400 });
  }
  if (buf.length > 60 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 60 MB)" }, { status: 413 });
  }
  // Checksum the ORIGINAL uploaded bytes so re-uploading the identical file dedupes.
  const checksum = createHash("sha256").update(buf).digest("hex");

  // RTA mailbacks arrive as password-protected zips. Unzip to the inner file
  // (with the supplied password) before decoding; a plain CSV/XLS is used as-is.
  let dataBuf = buf;
  let innerName = fileName;
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    const password = headerPassword;
    try {
      const r = await extractRtaFileFromZip(new Uint8Array(buf), password);
      dataBuf = Buffer.from(r.data);
      innerName = r.filename;
    } catch (e: any) {
      return NextResponse.json(
        { error: `Could not open the zip — ${e?.message ?? "wrong password or unsupported archive"}.` },
        { status: 400 }
      );
    }
  }
  // Decode the (inner) file to canonical pipe-delimited text. Real RTA files
  // arrive as .xls / .xlsx / .dbf (binary) — reading them as UTF-8 produced
  // garbage and silently imported zero rows. The decoder handles every
  // spreadsheet + CSV.
  const text = decodeRtaToText(dataBuf, innerName);

  const result = await withTenant(
    session.tenantId,
    async (tx) => {
      // Dedupe — same checksum within this kind/period already imported?
      const dupe = await tx.execute(sql`
        SELECT id, status FROM rta_file_imports
        WHERE tenant_id = ${session.tenantId}::uuid AND kind = ${kind} AND source = ${source}
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

      // 1. Reserve an import row
      const reserve = await tx.execute(sql`
        INSERT INTO rta_file_imports (
          tenant_id, source, kind, period_start, period_end,
          file_name, file_key, file_size_bytes, file_checksum,
          status, uploaded_by
        ) VALUES (
          ${session.tenantId}::uuid, ${source}, ${kind},
          ${new Date().toISOString().slice(0, 10)}::date,
          ${new Date().toISOString().slice(0, 10)}::date,
          ${fileName}, ${"inline:" + checksum.slice(0, 12)},
          ${buf.length}, ${checksum}, 'parsing', ${session.userId}::uuid
        )
        RETURNING id
      `);
      const importId = (reserve.rows[0] as any).id as string;

      // 2. Run the processor
      let outcome;
      let failure: string | null = null;
      try {
        outcome = await processRtaFile(tx, {
          tenantId: session.tenantId,
          source,
          kind,
          text,
        });
      } catch (e: any) {
        failure = e?.message ?? "Unknown parser error";
      }

      // 3. Update the import row with results
      if (failure || !outcome) {
        await tx.execute(sql`
          UPDATE rta_file_imports
          SET status = 'failed', parsed_at = now(), remarks = ${failure ?? "unknown error"}
          WHERE id = ${importId}::uuid
        `);
        return { importId, status: "failed", error: failure };
      }

      const status =
        outcome.rowsFailed > 0 || outcome.rowsSkipped > 0
          ? outcome.rowsImported === 0
            ? "failed"
            : "partial"
          : "completed";

      await tx.execute(sql`
        UPDATE rta_file_imports
        SET
          status = ${status},
          parsed_at = now(),
          period_start = ${outcome.periodStart}::date,
          period_end = ${outcome.periodEnd}::date,
          rows_total = ${outcome.rowsTotal},
          rows_imported = ${outcome.rowsImported},
          rows_skipped = ${outcome.rowsSkipped},
          rows_failed = ${outcome.rowsFailed},
          errors = ${JSON.stringify(outcome.errors)}::jsonb
        WHERE id = ${importId}::uuid
      `);

      return { importId, status, ...outcome };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // Audit the ingestion — RTA files populate transactions / AUM / brokerage,
  // a regulated action that must leave a trail.
  const r = result as any;
  await withTenant(
    session.tenantId,
    async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "rta_import.upload",
        entityType: "rta_file_import",
        entityId: r.importId ?? null,
        after: {
          source,
          kind,
          fileName,
          fileSizeBytes: buf.length,
          status: r.status ?? null,
          rowsImported: r.rowsImported ?? null,
          rowsSkipped: r.rowsSkipped ?? null,
          rowsFailed: r.rowsFailed ?? null,
          duplicate: r.duplicate ?? false,
        },
        ...clientMetaFromHeaders(req.headers),
      });
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return NextResponse.json(result);
}
