import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/insurance/extract
 *
 * Multipart upload of a policy document (PDF / JPG / PNG, <= 25MB). Reads it
 * with Claude and returns a structured draft mapped to our insurance schema for
 * the RM to review + edit + save. Persists NOTHING — advisory auto-fill only,
 * exactly like every other AI helper in this codebase (AI is a starting point,
 * never the source of truth). Gated by insurance.write + an active license.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { extractInsurancePolicy } from "@/lib/ai/assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Document extraction is a vision call — give it headroom over the default.
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — matches the dropzone copy
const ALLOWED = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
} as const;

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write");
    await assertActiveLicense(session.tenantId, session.roles);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "expected multipart/form-data with a 'file' field" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
    }

    const mediaType = ALLOWED[file.type as keyof typeof ALLOWED];
    if (!mediaType) {
      return NextResponse.json(
        { error: "unsupported file type — upload a PDF, JPG, or PNG" },
        { status: 415 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "the uploaded file is empty" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file too large — maximum is 25MB" }, { status: 413 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const result = await extractInsurancePolicy({ base64, mediaType });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ draft: result }, { status: 200 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
