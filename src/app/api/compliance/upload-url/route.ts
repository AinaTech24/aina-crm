/**
 * POST /api/compliance/upload-url
 * Body: { filename, contentType, kind?: 'compliance'|'kyc'|'marketing'|'general' }
 *
 * Returns a presigned S3 PUT URL the browser uses to upload directly.
 * After upload, client calls POST /api/compliance/documents with the key to register it.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { presignedPutUrl, vaultKey } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

const Body = z.object({
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(120),
  kind: z.enum(["compliance", "kyc", "marketing", "general"]).default("compliance"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const key = vaultKey(session.tenantId, parse.data.kind, parse.data.filename);
    const url = await presignedPutUrl(key, parse.data.contentType, 600);
    return NextResponse.json({ url, key });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
