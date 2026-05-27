/**
 * Public document-collection submission — POST /api/public/docs/submit.
 *
 * Accepts a multipart form with token id + one or more files. Validates the
 * token, uploads each file to S3 under tenants/<tenantId>/kyc/…, indexes them
 * into compliance_documents linked to the lead/investor, advances the lead
 * stage to docs_received, and pushes an outbox event.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { shareTokens, complianceDocuments, leads, eventsOutbox } from "@/db/schema";
import { markShareTokenUsed } from "@/lib/share-tokens";
import { putObject, vaultKey } from "@/lib/storage/s3";
import { transitionTo } from "@/lib/blueprints/engine";
import { enforce } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 10 MB per file
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export async function POST(req: NextRequest) {
  try {
    // 10 uploads per IP per hour. Each request can carry multiple files,
    // so this is the *number of submissions*, not files. Stops S3-upload
    // spam against the public link.
    const limited = enforce(req, "public.docs", { limit: 10, windowSec: 60 * 60 });
    if (limited) return limited;

    const formData = await req.formData();
    const tokenId = String(formData.get("tokenId") ?? "");
    const signatureName = String(formData.get("signatureName") ?? "").trim();
    const extraNotes = String(formData.get("extraNotes") ?? "");

    if (!tokenId) return NextResponse.json({ error: "missing tokenId" }, { status: 400 });
    if (!signatureName) return NextResponse.json({ error: "Signature required" }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = req.headers.get("user-agent") ?? "";

    // Step 1: token lookup (cross-tenant — no session yet).
    const tk = await withSystem(async (tx) => {
      const [t] = await tx.select().from(shareTokens).where(eq(shareTokens.id, tokenId));
      if (!t) throw new Error("Invalid token");
      if (t.revokedAt) throw new Error("This link was revoked");
      if (t.usedAt) throw new Error("This link has already been used");
      if (new Date(t.expiresAt as any) < new Date()) throw new Error("This link has expired");
      if (t.kind !== "document_collection") throw new Error("Not a document-collection token");
      return t;
    });

    // Step 2: actual writes happen inside the token's tenant scope so RLS
    // protects every UPDATE/INSERT against cross-tenant write even if the
    // token-id flow ever leaks.
    const out = await withTenant(tk.tenantId!, async (tx) => {
      // Walk all file_* entries
      const uploaded: Array<{ docId: string; key: string; label: string; size: number; mime: string }> = [];
      for (const [name, value] of formData.entries()) {
        if (!name.startsWith("file_") || !(value instanceof File)) continue;
        const docKey = name.slice(5);
        const label = String(formData.get(`label_${docKey}`) ?? docKey);
        const file = value as File;
        if (file.size === 0) continue;
        if (file.size > MAX_BYTES) throw new Error(`${label}: file too large (max 10 MB)`);
        if (!ALLOWED_MIMES.has(file.type)) throw new Error(`${label}: only PDF, JPG or PNG allowed`);
        const buf = Buffer.from(await file.arrayBuffer());
        const key = vaultKey(tk.tenantId!, "kyc", file.name);
        await putObject(key, buf, file.type);
        const docId = uuid();
        await tx.insert(complianceDocuments).values({
          id: docId,
          tenantId: tk.tenantId,
          category: "kyd" as any,
          name: label,
          description: docKey,
          storageKey: key,
          mimeType: file.type,
          sizeBytes: String(file.size),
          relatedEntityType: tk.subjectType,
          relatedEntityId: tk.subjectId,
          tags: [`onboarding`, `client_uploaded`, docKey] as any,
        } as any);
        uploaded.push({ docId, key, label, size: file.size, mime: file.type });
      }

      if (uploaded.length === 0) throw new Error("No files received");

      // Advance lead stage
      if (tk.subjectType === "lead") {
        await tx
          .update(leads)
          .set({
            stage: "docs_received" as any,
            stageChangedAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(eq(leads.id, tk.subjectId));
        // Move blueprint instance to docs_received
        try {
          await transitionTo(tx, tk.tenantId!, tk.subjectId, "docs_received", {
            systemBypass: true,
            remarks: `Client uploaded ${uploaded.length} document(s) via secure link.`,
          });
        } catch (e) {
          console.error("[docs/submit] blueprint advance failed:", e);
        }
      }

      // Outbox event — kicks off the conversion + ops-task workflow
      await tx.insert(eventsOutbox).values({
        tenantId: tk.tenantId,
        kind: "documents.received",
        entityType: tk.subjectType,
        entityId: tk.subjectId,
        after: { docs: uploaded, signature: signatureName, notes: extraNotes },
        meta: { tokenId, ip, userAgent: ua } as any,
      } as any);

      await markShareTokenUsed({
        id: tokenId,
        result: { uploaded, signature: signatureName, notes: extraNotes },
        ipAddress: ip,
        userAgent: ua,
      });

      return { uploaded: uploaded.length };
    });

    return NextResponse.json(out, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: 400 });
  }
}
