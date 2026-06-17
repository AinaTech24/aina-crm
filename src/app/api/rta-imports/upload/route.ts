import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { RTA_FILE_KINDS, RTA_SOURCES } from "@/db/schema/rta_imports";
import { Q } from "@/workers/queues";

/**
 * POST /api/rta-imports/upload
 *
 * The browser has already PUT the file DIRECTLY to S3 via a presigned URL
 * (see /api/rta-imports/upload-url). This request carries only the small JSON
 * {source, kind, key, filename, password}.
 *
 * We do NOT parse here. Parsing a real RTA master (CAMS R9 / KFintech — a
 * ~10 MB zip that expands to a large spreadsheet) is CPU/memory-heavy and,
 * done inside this request, blocked Node's event loop and 503-ed the whole
 * site for every user (and OOM-crashed the web process). Instead we:
 *   1. record an rta_file_imports row in `uploaded` state
 *   2. enqueue a job for the RTA import worker (concurrency 1, isolated process)
 *   3. return { importId, status: 'queued' } immediately
 * The dialog then polls GET /api/rta-imports/:id for the outcome.
 */
export const runtime = "nodejs";

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

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { source, kind, key, filename: fileName, password } = parsed.data;

  // SECURITY: the `key` is supplied by the client (it came from
  // /api/rta-imports/upload-url, which builds keys as `tenants/<tenantId>/rta/...`).
  // Re-validate it here so a tenant cannot point us at another tenant's S3
  // object and have the worker parse + reflect their clients' PANs/folios back.
  // The presign route is the only legitimate key source and always uses this
  // exact prefix.
  const requiredPrefix = `tenants/${session.tenantId}/rta/`;
  if (!key.startsWith(requiredPrefix)) {
    return NextResponse.json(
      { error: "invalid key for tenant" },
      { status: 403 }
    );
  }

  // 1. Reserve an import row in `uploaded` state. period_start/end are NOT NULL
  //    placeholders (today) — the worker overwrites them with the file's real
  //    reporting period once parsed.
  const importId = await withTenant(
    session.tenantId,
    async (tx) => {
      const reserve = await tx.execute(sql`
        INSERT INTO rta_file_imports (
          tenant_id, source, kind, period_start, period_end,
          file_name, file_key, status, uploaded_by
        ) VALUES (
          ${session.tenantId}::uuid, ${source}, ${kind},
          ${new Date().toISOString().slice(0, 10)}::date,
          ${new Date().toISOString().slice(0, 10)}::date,
          ${fileName}, ${key}, 'uploaded', ${session.userId}::uuid
        )
        RETURNING id
      `);
      return (reserve.rows[0] as any).id as string;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  // 2. Enqueue the heavy parse for the worker. The password rides in the Redis
  //    job payload only (never persisted to the DB) and is dropped on complete.
  //    attempts:1 — a giant file that OOMs shouldn't be auto-retried into
  //    repeated OOMs; the user re-uploads. processRtaFile is upsert-idempotent.
  await Q.rtaImport().add(
    "import",
    {
      importId,
      tenantId: session.tenantId,
      source,
      kind,
      key,
      filename: fileName,
      password: password || undefined,
      userId: session.userId,
      branchId: session.branchId,
      roles: session.roles,
    },
    {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: 3600 },
    }
  );

  // Audit the ingestion request — RTA files populate transactions / AUM /
  // brokerage, a regulated action that must leave a trail. Outcome counters
  // live on the import row (updated by the worker).
  await withTenant(
    session.tenantId,
    async (tx) => {
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "rta_import.upload",
        entityType: "rta_file_import",
        entityId: importId,
        after: { source, kind, fileName, status: "queued" },
        ...clientMetaFromHeaders(req.headers),
      });
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return NextResponse.json({ importId, status: "queued" });
}
