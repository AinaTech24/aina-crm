import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/review-meetings/[id]/files — upload a file to a meeting's
 * Attachments (multipart, field `file`). The bytes go to object storage under
 * a firm- and meeting-scoped key; the meeting's attachments list gains a
 * `{ name, url: "", fileId, size }` entry. See lib/review-meetings/files.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { putObject } from "@/lib/storage/s3";
import { MEETING_FILE_MAX_BYTES, fileKey, loadMeetingForFiles, contentTypeFor } from "@/lib/review-meetings/files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a file to upload" }, { status: 400 });
    if (file.size > MEETING_FILE_MAX_BYTES) return NextResponse.json({ error: "The file is larger than 25 MB" }, { status: 400 });
    const name = (file.name || "attachment").replace(/[^\w.\- ()]+/g, "_").slice(0, 180);
    const buf = Buffer.from(await file.arrayBuffer());
    const fileId = randomUUID();

    const entry = await withTenant(session.tenantId, async (tx) => {
      const m = await loadMeetingForFiles(tx, session, id);
      if (!m) return null;
      await putObject(fileKey(session.tenantId, id, fileId), buf, file.type || contentTypeFor(name));
      const e = { name, url: "", fileId, size: buf.length, uploadedAt: new Date().toISOString() };
      await tx.execute(sql`
        UPDATE review_meetings
           SET attachments = COALESCE(attachments, '[]'::jsonb) || ${JSON.stringify([e])}::jsonb,
               updated_at = now()
         WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
      `);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.file_upload",
        entityType: "review_meeting",
        entityId: id,
        after: { fileId, name, size: buf.length },
        ...clientMeta,
      });
      return e;
    });
    if (!entry) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    return NextResponse.json({ attachment: entry }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
