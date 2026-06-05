import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/content-library/upload-url     (AINA platform admins and MFD admins/marketing)
 *
 * Body: { filename, contentType }
 * Returns: { url, key, publicUrl }
 *
 * The presigned URL lets the user's browser PUT the file directly
 * into S3 (under `library/` for admins, `tenants/<tenantId>/library/` for tenant custom).
 * Then the client POSTs /api/content-library with `fileUrl = publicUrl`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import { can } from "@/lib/auth/rbac";
import { presignedPutUrl, bucket } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

const Body = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(120),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const platformAdmin = isPlatformAdmin(session.roles);
    const canUpload = platformAdmin || can(session.roles, "template.edit");
    if (!canUpload) {
      return NextResponse.json({ error: "forbidden — insufficient capabilities" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const safe = parse.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const key = platformAdmin
      ? `library/${Date.now()}-${safe}`
      : `tenants/${session.tenantId}/library/${Date.now()}-${safe}`;
    const url = await presignedPutUrl(key, parse.data.contentType, 600);
    const region = process.env.S3_REGION ?? "ap-south-1";
    const publicUrl = url.startsWith("/api/upload-local")
      ? url
      : `https://${bucket()}.s3.${region}.amazonaws.com/${key}`;
    return NextResponse.json({ url, key, publicUrl });
  } catch (err: any) {
    return handleApiError(err);
  }
}
