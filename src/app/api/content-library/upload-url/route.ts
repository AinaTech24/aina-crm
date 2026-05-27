/**
 * POST /api/content-library/upload-url     (AINA platform admins only)
 *
 * Body: { filename, contentType }
 * Returns: { url, key, publicUrl }
 *
 * The presigned URL lets the AINA admin's browser PUT the file directly
 * into S3 (under `library/<timestamp>-<safeFilename>`). Then the client
 * POSTs /api/content-library with `fileUrl = publicUrl`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform";
import { presignedPutUrl, bucket } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

const Body = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(120),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isPlatformAdmin(session.roles)) {
      return NextResponse.json({ error: "forbidden — platform admin only" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const safe = parse.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const key = `library/${Date.now()}-${safe}`;
    const url = await presignedPutUrl(key, parse.data.contentType, 600);
    const region = process.env.S3_REGION ?? "ap-south-1";
    const publicUrl = `https://${bucket()}.s3.${region}.amazonaws.com/${key}`;
    return NextResponse.json({ url, key, publicUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
