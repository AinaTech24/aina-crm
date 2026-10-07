import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { RTA_FILE_KINDS, RTA_SOURCES } from "@/db/schema/rta_imports";
import { getMailbackPasswords, passwordsToTry } from "@/lib/rta/mailback-config";
import { Q } from "@/workers/queues";
import { RTA_FILE_TYPE_BY_KIND } from "@/lib/rta/file-types";

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
  requireCap(session.roles, "transactions.execute", session.permissions);
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


  // Guard the most common (and silent) mis-pick: a CAMS R9 or KFintech
  // MFSD211/MFSD203 — the master / holdings exports — uploaded under a
  // transaction-FEED kind. The feed engine then reads tens of thousands of
  // master rows as the wrong record type and skips almost all of them (the
  // "partial · 30k skipped" outcome). These files MUST use "Folio master dump"
  // (or "CAS holdings"), which routes to the rich engine that creates the
  // client book. Detect by the registrar's report code in the file name and
  // fail fast with an actionable message instead of importing garbage.
  // Same code set classify-mailback.ts routes to the rich engine, kept in step
  // with it: KFintech MFSD211/311 (register) and MFSD203/310 (register +
  // holdings); CAMS WBR9/R9 and WBR4 (master + balances) and WBR22 (AUM by
  // scheme by investor). Previously only R9/211/203 were caught, so the same
  // mis-pick still slipped through on the other four codes.
  // WBR22 is deliberately NOT here. It has no PAN column, so the rich engine
  // discards every row; classify-mailback routes it to monthly_aum_statement,
  // which groups by folio. Listing it as a "master" would force the upload into
  // the one engine that cannot read it.
  const looksLikeMaster =
    /(?:wbr\s*_?)?r(?:9|4)(?=\.|_|-|$)/i.test(fileName) ||
    /mfsd\s*_?(?:211|311|203|310)/i.test(fileName);
  if (looksLikeMaster && kind !== "folio_master_dump" && kind !== "cas_holdings") {
    const fileLabel = /mfsd\s*_?(?:203|310)/i.test(fileName)
      ? "KFintech MFSD203/310 (folio register + holdings)"
      : /mfsd\s*_?(?:211|311)/i.test(fileName)
        ? "KFintech MFSD211/311 (folio master)"
        : "CAMS WBR9/WBR4 (master + holdings)";
    const selected = RTA_FILE_TYPE_BY_KIND[kind]?.label ?? kind.replace(/_/g, " ");
    return NextResponse.json(
      {
        error:
          `This is a ${fileLabel} file, but you picked "${selected}". ` +
          `Choose "Folio master dump" instead and upload it again — that one loads your clients, folios and holdings. ` +
          `Nothing was imported, so no data has changed.`,
      },
      { status: 400 }
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
  //    repeated OOMs; the user re-uploads. Processors are upsert-idempotent.
  //
  // Master / holdings files (the client + folio register) go through the RICH
  // engine — it creates clients and resolves real AMC/scheme names via ISIN →
  // AMFI. Everything else (daily feed, brokerage, AUM, SIP book, mandates) uses
  // the feed engine. This is what makes ONE importer cover both: the user just
  // picks the file kind; we route to the right engine under the hood.
  const RICH_KINDS = new Set(["folio_master_dump", "cas_holdings"]);
  const useRich = RICH_KINDS.has(kind) && (source === "cams" || source === "kfintech");

  // Fall back to the firm's SAVED mailback passwords when the dialog's one
  // doesn't open the archive. A firm with several ARNs holds several passwords
  // per registrar, and the person uploading rarely knows which subscription a
  // given file came from — so a manual upload used to fail with "not our file"
  // on an archive the platform could already open, purely because the wrong one
  // of the firm's own passwords was typed. Auto-import, re-import and the
  // rejected-rescan have always tried them all; this is the last path that
  // didn't. Every saved secret is offered regardless of the label it sits under
  // (labels name mailboxes for humans, they do not route) and regardless of the
  // selected registrar, mirroring the re-import route — a mis-picked source
  // shouldn't cost the user the import. The typed password is kept and tried
  // too; unzip attempts are cheap and stop at the first that opens.
  const savedPasswords = await withTenant(
    session.tenantId,
    async (tx) => {
      const cfg = await getMailbackPasswords(tx, session.tenantId);
      return passwordsToTry(cfg, source);
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  ).catch(() => [] as string[]);

  await Q.rtaImport().add(
    useRich ? "rich-import" : "import",
    useRich
      ? {
          mode: "rich",
          importId,
          tenantId: session.tenantId,
          key,
          filename: fileName,
          password: password || undefined,
          passwords: savedPasswords,
          rta: source,
          reportType: "",
          dryRun: false,
          assignToMe: false,
          userId: session.userId,
          branchId: session.branchId,
          roles: session.roles,
        }
      : {
          importId,
          tenantId: session.tenantId,
          source,
          kind,
          key,
          filename: fileName,
          password: password || undefined,
          passwords: savedPasswords,
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
