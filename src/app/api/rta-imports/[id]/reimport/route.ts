/**
 * POST /api/rta-imports/[id]/reimport — re-run one stored import.
 *
 * Use when an import left rows on the table: a transaction feed that skipped
 * rows because their folio master had not arrived yet, or a file rejected
 * because the right ZIP password wasn't saved at the time. Both become
 * importable once the missing piece lands, and the source file is still in
 * storage — so this re-queues the SAME object through the SAME pipeline.
 *
 * Nothing is re-downloaded and no mail is re-sent. Row writes upsert, so a
 * repeat is idempotent.
 *
 * Refusals (409, with the reason):
 *   • the row is still in flight (`uploaded` / `parsing`) — a second job would
 *     race the first one on the same row;
 *   • the row came from the drop folder (`file_key = feed:<sha>`) — that path
 *     never stores the file, so there is nothing to re-read;
 *   • the row completed (its file is purged by design) or has no file key.
 *
 * On success the row is RESET to `uploaded` with its previous counts, errors,
 * summary and failure remark cleared, in the same statement that claims it
 * (so a double click cannot queue two jobs). That makes the table's live
 * refresh pick it up and shows the new run's outcome rather than the old one.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { withTenant } from "@/db/client";
import { handleApiError } from "@/lib/api/error-handler";
import { getMailbackPasswords, passwordsToTry } from "@/lib/rta/mailback-config";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { assertRtaImportAccess, isUuid, RTA_IMPORT_CAPABILITY } from "@/lib/rta/import-access";
import { Q, addWithin } from "@/workers/queues";

export const dynamic = "force-dynamic";

/** Master / holdings go to the rich engine; everything else to the feed processor. */
const RICH_KINDS = new Set(["folio_master_dump", "cas_holdings"]);

const IN_FLIGHT = new Set(["uploaded", "parsing"]);

type Claimed =
  | { ok: true; row: { id: string; source: string; kind: string; file_name: string; file_key: string; status: string } }
  | { ok: false; status: number; error: string };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    requireCap(session.roles, RTA_IMPORT_CAPABILITY, session.permissions);
    const txOpts = { userId: session.userId, branchId: session.branchId, roles: session.roles };

    const claimed: Claimed = await withTenant(
      session.tenantId,
      async (tx) => {
        await assertRtaImportAccess(tx, session);
        if (!isUuid(id)) return { ok: false, status: 404, error: "Import not found." };

        const r = await tx.execute(sql`
          SELECT id, source, kind, file_name, file_key, status
          FROM rta_file_imports
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `);
        const row = (r.rows[0] as any) ?? null;
        if (!row) return { ok: false, status: 404, error: "Import not found." };
        if (IN_FLIGHT.has(row.status)) {
          return {
            ok: false,
            status: 409,
            error: "This import is still being processed. Wait for it to finish before re-running it.",
          };
        }
        if (typeof row.file_key === "string" && row.file_key.startsWith("feed:")) {
          return {
            ok: false,
            status: 409,
            error:
              "This file came from the server drop folder, which does not keep a copy of the file, so it cannot be re-run here. " +
              "Put the file back in the drop folder, or upload it on this page.",
          };
        }
        if (!row.file_key) {
          return {
            ok: false,
            status: 409,
            error: "The source file is no longer stored, so this import cannot be re-run. Re-request the report from the registrar.",
          };
        }
        // A completed import purges its own file by design — there is nothing to read.
        if (row.status === "completed") {
          return { ok: false, status: 409, error: "This import already completed; there is nothing to re-run." };
        }

        // Claim + reset in one statement. The status guard repeats the in-flight
        // check so a concurrent request that already claimed it matches nothing.
        // Provenance ("Auto-imported from forwarded email …") is kept; any other
        // remark is the previous run's failure text and is cleared.
        const reset = await tx.execute(sql`
          UPDATE rta_file_imports
          SET status = 'uploaded',
              rows_total = NULL, rows_imported = NULL, rows_skipped = NULL, rows_failed = NULL,
              errors = NULL, summary = NULL, parsed_at = NULL,
              remarks = CASE WHEN remarks ILIKE 'Auto-imported%' THEN remarks ELSE NULL END,
              updated_at = now()
          WHERE id = ${id}::uuid AND status NOT IN ('uploaded', 'parsing')
          RETURNING id
        `);
        if (!(reset.rows as any[]).length) {
          return {
            ok: false,
            status: 409,
            error: "This import is still being processed. Wait for it to finish before re-running it.",
          };
        }

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "rta_import.reimport",
          entityType: "rta_file_import",
          entityId: row.id,
          before: { status: row.status },
          after: { status: "uploaded", queued: true },
          ...clientMetaFromHeaders(req.headers),
        });
        return { ok: true, row };
      },
      txOpts
    );

    if (!claimed.ok) return NextResponse.json({ error: claimed.error }, { status: claimed.status });
    const row = claimed.row;

    const cfg = await withTenant(session.tenantId, async (tx) => getMailbackPasswords(tx, session.tenantId), txOpts);
    // Offer every saved secret regardless of the label it sits under — labels name
    // mailboxes for humans, they do not route, and they get mixed up in practice.
    const passwords = passwordsToTry(cfg, row.source);

    // Retries cover infrastructure failures only (a bad file is recorded on the row and does not throw); every path is idempotent.
    const opts = { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: { age: 3600 } } as const;
    try {
      if (RICH_KINDS.has(row.kind)) {
        await addWithin(Q.rtaImportProducer(),
          "rich-import",
          {
            mode: "rich", importId: row.id, tenantId: session.tenantId,
            key: row.file_key, filename: row.file_name, passwords,
            rta: row.source, reportType: "", dryRun: false, assignToMe: false,
            userId: session.userId, branchId: session.branchId, roles: session.roles,
          },
          opts
        );
      } else {
        await addWithin(Q.rtaImportProducer(),
          "import",
          {
            importId: row.id, tenantId: session.tenantId, source: row.source, kind: row.kind,
            key: row.file_key, filename: row.file_name, passwords,
            userId: session.userId, branchId: session.branchId, roles: session.roles,
          },
          opts
        );
      }
    } catch (err) {
      // The row was reset to `uploaded`; without a job it would sit there until
      // the reaper. Put it into a terminal state that says what happened.
      await withTenant(
        session.tenantId,
        (tx) =>
          tx.execute(sql`
            UPDATE rta_file_imports
            SET status = 'failed', remarks = 'Re-import could not be queued — try again in a minute.', updated_at = now()
            WHERE id = ${row.id}::uuid AND status = 'uploaded'
          `),
        txOpts
      ).catch(() => {});
      throw err;
    }

    return NextResponse.json({ ok: true, importId: row.id, status: "queued" });
  } catch (err) {
    return handleApiError(err);
  }
}
