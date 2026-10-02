import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/leads/[id]/documents/download?docId=…[&inline=1]
 *
 * A short-lived presigned URL for one of the lead's attachments. The file must
 * belong to this firm and this lead, and the viewer must be able to see the
 * lead. Each view / download is audited, as for a client's documents.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments } from "@/db/schema";
import { presignedGetUrl } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { loadViewableLead } from "@/lib/leads/access";

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
      if (!(await loadViewableLead(tx, session, id))) return null;
      const [d] = await tx
        .select({ storageKey: complianceDocuments.storageKey, name: complianceDocuments.name })
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.id, docId),
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "lead"),
            eq(complianceDocuments.relatedEntityId, id),
          ),
        )
        .limit(1);
      if (!d) return null;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: inline ? "document.view" : "document.download",
        entityType: "compliance_document",
        entityId: docId,
        after: { name: d.name, leadId: id } as any,
        ...clientMetaFromHeaders(req.headers),
      });
      return d;
    });

    if (!doc || !doc.storageKey) return NextResponse.json({ error: "document not found" }, { status: 404 });
    const url = await presignedGetUrl(doc.storageKey, 600, doc.name || "attachment", inline);
    return NextResponse.json({ url });
  } catch (err: any) {
    return handleApiError(err);
  }
}
