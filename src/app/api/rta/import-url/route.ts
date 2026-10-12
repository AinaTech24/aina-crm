import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/rta/import-url
 *
 * Presigned S3 PUT URL for the RICH master/holdings importer so the browser
 * uploads large files (CAMS R9 .xls, KFintech masters) DIRECTLY to S3 —
 * bypassing the app body limit. The client then calls /api/rta/import-async
 * with the returned key. Body: { filename, contentType? } → { url, key }.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { requireRtaImportAccess, RTA_IMPORT_CAPABILITY } from "@/lib/rta/import-access";
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
    // Same access as the live upload route (lib/rta/import-access): the RTA
    // import capability on a book not narrowed to the caller's own clients.
    // (Was investor.edit.all OR dashboard.view.owner — out of step with the
    // upload path that imports the very same master files.)
    requireCap(session.roles, RTA_IMPORT_CAPABILITY, session.permissions);
    await requireRtaImportAccess(session);
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
