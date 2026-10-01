import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET    /api/review-meetings/[id]/files/[fileId] — download a meeting file
 *        (through the secure DownloadButton, so the route never shows in the
 *        browser chrome).
 * DELETE /api/review-meetings/[id]/files/[fileId] — remove it from the
 *        meeting and from storage.
 * Only a file listed on that meeting is served: the id is looked up in the
 * meeting's attachments, never trusted as a storage path.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { deleteObject, getObjectBytes } from "@/lib/storage/s3";
import { contentTypeFor, fileKey, loadMeetingForFiles } from "@/lib/review-meetings/files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, fileId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const entry = await withTenant(session.tenantId, async (tx) => {
      const m = await loadMeetingForFiles(tx, session, id);
      return m?.attachments.find((a) => a.fileId === fileId) ?? null;
    });
    if (!entry) return NextResponse.json({ error: "File not found" }, { status: 404 });
    const name = String(entry.name ?? "attachment");
    const bytes = await getObjectBytes(fileKey(session.tenantId, id, fileId));
    return new NextResponse(bytes as any, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(name),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, fileId } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const removed = await withTenant(session.tenantId, async (tx) => {
      const m = await loadMeetingForFiles(tx, session, id);
      const entry = m?.attachments.find((a) => a.fileId === fileId);
      if (!entry) return false;
      await tx.execute(sql`
        UPDATE review_meetings
           SET attachments = COALESCE((
                 SELECT jsonb_agg(a) FROM jsonb_array_elements(attachments) a
                  WHERE a->>'fileId' IS DISTINCT FROM ${fileId}
               ), '[]'::jsonb),
               updated_at = now()
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.file_delete",
        entityType: "review_meeting",
        entityId: id,
        before: { fileId, name: entry.name ?? null },
        ...clientMeta,
      });
      return true;
    });
    if (!removed) return NextResponse.json({ error: "File not found" }, { status: 404 });
    // After the commit: a storage hiccup must not undo the removal.
    await deleteObject(fileKey(session.tenantId, id, fileId)).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
