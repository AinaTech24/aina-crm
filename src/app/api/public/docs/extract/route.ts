/**
 * Public onboarding link — POST /api/public/docs/extract (multipart: tokenId,
 * docKey, file).
 *
 * The client uploads a document FIRST; this reads it and returns the details
 * it shows (lib/onboarding/doc-extract.ts) so the form can fill them in and
 * ask only for the rest. NO AI: PDF text layer or OCR, then patterns.
 *
 * - Token-gated like presign/submit: a live, unused document_collection link.
 *   The token is not consumed here.
 * - NOTHING is stored: the file is read in memory and dropped. The real upload
 *   still happens at submit, through presign.
 * - OCR is CPU-heavy, so it is rate-limited per IP and per link, capped at
 *   10 MB, and at most two run at once on the server; a busy server answers
 *   "could not read" and the client types the details instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withSystem } from "@/db/client";
import { shareTokens } from "@/db/schema";
import { enforce, enforceLinkToken, PUBLIC_LINK_IP_CEILING } from "@/lib/rate-limit";
import { extractDocumentText } from "@/lib/insurance/extract-text";
import { KIND_LABEL, extractFromText } from "@/lib/onboarding/doc-extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED: Record<string, "application/pdf" | "image/jpeg" | "image/png"> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
};
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CONCURRENT = 2;
let running = 0;

export async function POST(req: NextRequest) {
  const limited = enforce(req, "public.docs.extract", PUBLIC_LINK_IP_CEILING);
  if (limited) return limited;
  try {
    const form = await req.formData().catch(() => null);
    const tokenId = String(form?.get("tokenId") ?? "");
    const docKey = String(form?.get("docKey") ?? "").slice(0, 60);
    const file = form?.get("file");
    if (!tokenId || !docKey) return NextResponse.json({ error: "missing tokenId or docKey" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    const mediaType = ALLOWED[file.type];
    if (!mediaType) return NextResponse.json({ error: "Only PDF, JPG or PNG can be read." }, { status: 415 });
    if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "The file is empty or larger than 10 MB." }, { status: 400 });

    // Each document is read once or twice; allow re-uploads, but not a loop.
    const perToken = enforceLinkToken("public.docs.extract", tokenId, 40);
    if (perToken) return perToken;

    await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t) throw Object.assign(new Error("Invalid link"), { status: 404 });
      if (t.revokedAt) throw Object.assign(new Error("This link was revoked"), { status: 410 });
      if (t.usedAt) throw Object.assign(new Error("This link has already been used"), { status: 410 });
      if (new Date(t.expiresAt as unknown as string) < new Date()) throw Object.assign(new Error("This link has expired"), { status: 410 });
      if (t.kind !== "document_collection") throw Object.assign(new Error("Not an onboarding link"), { status: 400 });
    });

    if (running >= MAX_CONCURRENT) {
      return NextResponse.json({ kind: null, label: null, fields: {}, busy: true });
    }
    running++;
    let text = "";
    try {
      text = (await extractDocumentText(Buffer.from(await file.arrayBuffer()), mediaType)).text ?? "";
    } catch {
      return NextResponse.json({ kind: null, label: null, fields: {} });
    } finally {
      running--;
    }
    const { kind, fields } = extractFromText(text, docKey);
    return NextResponse.json({ kind, label: kind ? KIND_LABEL[kind] : null, fields }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message ?? "Could not read the document" }, { status: e.status ?? 500 });
  }
}
