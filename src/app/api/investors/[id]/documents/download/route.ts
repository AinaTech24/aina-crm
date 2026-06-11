import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/investors/[id]/documents/download?docId=…
 *
 * Returns a short-lived presigned S3 GET URL for one of the client's documents.
 * Verifies the document belongs to this tenant + this investor before signing.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.view", session.permissions);
    const sp = new URL(req.url).searchParams;
    const docId = sp.get("docId");
    const inline = sp.get("inline") === "1";
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });

    const doc = await withTenant(session.tenantId, async (tx) => {
      const [d] = await tx
        .select({ storageKey: complianceDocuments.storageKey, name: complianceDocuments.name })
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.id, docId),
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "investor"),
            eq(complianceDocuments.relatedEntityId, id)
          )
        )
        .limit(1);
      return d ?? null;
    });

    if (!doc || !doc.storageKey) return NextResponse.json({ error: "document not found" }, { status: 404 });
    const url = await presignedGetUrl(doc.storageKey, 600, doc.name ?? undefined, inline);
    return NextResponse.json({ url });
  } catch (err: any) {
    return handleApiError(err);
  }
}
