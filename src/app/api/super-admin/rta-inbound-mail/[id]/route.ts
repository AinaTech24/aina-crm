/**
 * GET /api/super-admin/rta-inbound-mail/:id — the whole mail for Aina Admin →
 * Inbound Mail's viewer: headers, the body (HTML as a locked-down page for a
 * sandboxed iframe, or text) and every attachment (lib/rta/inbound-archive.ts).
 *
 * Only mail kept in the archive can be opened (`available: false` with the
 * reason otherwise — mail from before the archive existed, or older than its
 * window). Mail carries client data: platform admins with
 * `platform.settings.manage` only, and each open is audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { withPlatformAdmin } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { archiveDays, mailView, readArchivedMail } from "@/lib/rta/inbound-archive";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const row = await withPlatformAdmin(session.userId, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT id::text, raw_key, tenant_id::text AS tenant_id, subject FROM rta_inbound_messages WHERE id = ${id}::uuid`)).rows[0] as
        | { id: string; raw_key: string | null; tenant_id: string | null; subject: string | null }
        | undefined;
      if (r?.raw_key) {
        await recordAudit(tx, {
          tenantId: PLATFORM_TENANT_ID,
          actorUserId: session.userId,
          action: "rta_inbound.mail_opened",
          entityType: "rta_inbound_message",
          entityId: id,
          after: { tenantId: r.tenant_id },
        });
      }
      return r;
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!row.raw_key) {
      return NextResponse.json({
        available: false,
        reason: `The full mail is not kept for this message — mail is kept ${archiveDays()} days from when it arrives, and only since the viewer was added. Attachments that were imported can still be downloaded.`,
      });
    }
    let raw: Buffer;
    try {
      raw = await readArchivedMail(row.raw_key);
    } catch {
      return NextResponse.json({ available: false, reason: "The stored mail could not be read — it may have been removed from storage." });
    }
    return NextResponse.json({ available: true, mail: await mailView(raw) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleApiError(err);
  }
}
