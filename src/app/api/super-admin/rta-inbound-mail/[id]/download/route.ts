/**
 * GET /api/super-admin/rta-inbound-mail/:id/download
 *   ?i=<n>   one attachment, by its position in the mail
 *   ?eml=1   the whole mail as an .eml file (opens in Outlook / Thunderbird)
 *   ?log=<n> an attachment by its position in the poller's log — from the
 *            archived mail when kept, else the copy stored for its import
 *            (so an imported file stays downloadable after the mail is gone)
 *
 * Platform admins with `platform.settings.manage`; each download is audited.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { handleApiError } from "@/lib/api/error-handler";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { withPlatformAdmin } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { PLATFORM_TENANT_ID } from "@/lib/platform";
import { getObjectBytes } from "@/lib/storage/s3";
import { mailAttachment, mailView, readArchivedMail } from "@/lib/rta/inbound-archive";

export const dynamic = "force-dynamic";

const notFound = (msg = "Not found") => NextResponse.json({ error: msg }, { status: 404 });

/** A filename safe for Content-Disposition, plus the UTF-8 form for browsers that read it. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
    const sp = req.nextUrl.searchParams;
    const wantEml = sp.get("eml") === "1";
    const idx = sp.has("i") ? Number(sp.get("i")) : null;
    const logIdx = sp.has("log") ? Number(sp.get("log")) : null;
    if (!wantEml && !(Number.isInteger(idx) && idx! >= 0) && !(Number.isInteger(logIdx) && logIdx! >= 0)) {
      return NextResponse.json({ error: "Say what to download" }, { status: 400 });
    }

    const row = await withPlatformAdmin(session.userId, async (tx) =>
      (await tx.execute(sql`
        SELECT id::text, raw_key, subject, attachments, tenant_id::text AS tenant_id FROM rta_inbound_messages WHERE id = ${id}::uuid`)).rows[0] as
        | { id: string; raw_key: string | null; subject: string | null; attachments: Array<{ filename: string; importId?: string | null }>; tenant_id: string | null }
        | undefined
    );
    if (!row) return notFound();

    let out: { name: string; type: string; body: Buffer } | null = null;
    const raw = row.raw_key ? await readArchivedMail(row.raw_key).catch(() => null) : null;

    if (wantEml) {
      if (!raw) return notFound("The full mail is not kept for this message.");
      const base = (row.subject ?? "mail").replace(/[^\w .-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "mail";
      out = { name: `${base}.eml`, type: "message/rfc822", body: raw };
    } else if (idx != null) {
      if (!raw) return notFound("The full mail is not kept for this message.");
      const a = await mailAttachment(raw, idx);
      if (!a) return notFound("No such attachment.");
      out = { name: a.filename, type: a.contentType, body: a.content };
    } else {
      // By the log's position: match the archived mail's attachment by name, else the import's stored copy.
      const logged = row.attachments?.[logIdx!];
      if (!logged) return notFound("No such attachment.");
      if (raw) {
        const view = await mailView(raw);
        const match = view.attachments.find((a) => a.filename === logged.filename);
        const a = match ? await mailAttachment(raw, match.index) : null;
        if (a) out = { name: a.filename, type: a.contentType, body: a.content };
      }
      if (!out && logged.importId) {
        const key = await withPlatformAdmin(session.userId, async (tx) =>
          ((await tx.execute(sql`SELECT file_key FROM rta_file_imports WHERE id::text = ${logged.importId}`)).rows[0] as { file_key: string } | undefined)?.file_key
        );
        const body = key ? await getObjectBytes(key).catch(() => null) : null;
        if (body) out = { name: logged.filename, type: "application/octet-stream", body };
      }
      if (!out) return notFound("This attachment was not kept — only imported files and mail from the last 30 days can be downloaded.");
    }

    await withPlatformAdmin(session.userId, (tx) =>
      recordAudit(tx, {
        tenantId: PLATFORM_TENANT_ID,
        actorUserId: session.userId,
        action: "rta_inbound.download",
        entityType: "rta_inbound_message",
        entityId: id,
        after: { file: out!.name, tenantId: row.tenant_id },
      })
    );
    return new NextResponse(new Uint8Array(out.body), {
      headers: {
        "content-type": out.type,
        "content-disposition": disposition(out.name),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
