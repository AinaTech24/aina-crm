import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { putObject, vaultKey, isS3Configured } from "@/lib/storage/s3";
import { handleApiError } from "@/lib/api/error-handler";

/**
 * POST /api/compliance/upload   (multipart/form-data: file, kind?)
 *
 * Server-side proxy upload to the document vault. The browser posts the raw
 * file here and WE put it into S3 (or the local-disk fallback). This is the
 * robust path versus a browser-direct presigned PUT:
 *
 *   - No bucket CORS needed (server→S3 is not a cross-origin browser request).
 *   - No signed-header replay (the SDK sends SSE/Content-Type itself).
 *   - One round-trip instead of presign → PUT → register.
 *
 * Returns { key } which the caller then registers via POST
 * /api/compliance/documents. Capped to keep the request bounded; large media
 * should still use the presigned flow once bucket CORS is configured.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const KINDS = new Set(["compliance", "kyc", "marketing", "general"]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload");

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "file is empty" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large — max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB` },
        { status: 413 }
      );
    }

    const kindRaw = String(form.get("kind") ?? "compliance");
    const kind = (KINDS.has(kindRaw) ? kindRaw : "compliance") as
      | "compliance"
      | "kyc"
      | "marketing"
      | "general";

    const key = vaultKey(session.tenantId, kind, file.name || "document");
    const contentType = file.type || "application/octet-stream";
    const buf = Buffer.from(await file.arrayBuffer());

    try {
      await putObject(key, buf, contentType);
    } catch (e: any) {
      // Surface a storage-specific message so a misconfigured bucket / bad key
      // is diagnosable from the UI instead of a generic 500.
      const detail = e?.name || e?.Code || e?.message || "unknown error";
      return NextResponse.json(
        {
          error: isS3Configured()
            ? `Storage upload failed (${detail}). Check S3 bucket/region and IAM s3:PutObject permission.`
            : `Local storage write failed (${detail}).`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ key, contentType, sizeBytes: buf.length, storage: isS3Configured() ? "s3" : "local" });
  } catch (err) {
    return handleApiError(err);
  }
}
