import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/rta-imports/upload-url
 *
 * Returns a presigned S3 PUT URL so the browser uploads large RTA files DIRECTLY
 * to S3 — bypassing the app server's request-body size limit (~10MB) that
 * truncated big zips. Body: { filename, contentType? } → { url, key }.
 * The client then PUTs the file to `url` and calls /api/rta-imports/upload with
 * the returned `key`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { presignedPutUrl } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().max(150).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "transactions.execute");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const safe = parse.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const key = `tenants/${session.tenantId}/rta/${Date.now()}-${safe}`;
    const contentType = parse.data.contentType || "application/octet-stream";
    const url = await presignedPutUrl(key, contentType, 900);
    return NextResponse.json({ url, key });
  } catch (err: any) {
    return handleApiError(err);
  }
}
