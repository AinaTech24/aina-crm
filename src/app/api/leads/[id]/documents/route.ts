import { handleApiError } from "@/lib/api/error-handler";
/**
 * A lead's attachments.
 *
 *   GET    /api/leads/[id]/documents          — the lead's files + its proposals
 *   POST   /api/leads/[id]/documents          — register an uploaded file
 *   DELETE /api/leads/[id]/documents?docId=…  — remove a file
 *
 * Files live in `compliance_documents` with related_entity_type='lead' — the
 * linkage the lead's KYC uploads already use, and the one lead conversion
 * moves onto the new client (convert route, carryover step 3), so nothing
 * attached to a lead is lost when it becomes a client.
 *
 * Proposals are not copied here: they are listed from `proposals.lead_id`,
 * each with its PDF, so the attachment list always shows the current version.
 * The PDF flag follows the PDF route's own rule (managers, or the preparer).
 *
 * Upload flow: POST /api/compliance/upload (multipart) → POST here with the key.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, require as requireCap } from "@/lib/auth/rbac";
import { complianceDocuments, proposals } from "@/db/schema";
import { deleteObject } from "@/lib/storage/s3";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { loadEditableLead, loadViewableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(1).max(300),
  storageKey: z.string().min(1).max(500),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

const ofLead = (tenantId: string, leadId: string) =>
  and(
    eq(complianceDocuments.tenantId, tenantId),
    eq(complianceDocuments.relatedEntityType, "lead"),
    eq(complianceDocuments.relatedEntityId, leadId),
  );

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.view", session.permissions);
    const seesAllProposals =
      can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const canViewProposals = can(session.roles, "proposal.view", session.permissions);

    const data = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadViewableLead(tx, session, id);
      if (!lead) return null;
      const docs = await tx
        .select()
        .from(complianceDocuments)
        .where(and(ofLead(session.tenantId, id), isNull(complianceDocuments.supersededById)))
        .orderBy(desc(complianceDocuments.createdAt));
      const props = canViewProposals
        ? await tx
            .select({
              id: proposals.id,
              number: proposals.proposalNumber,
              title: proposals.title,
              status: proposals.status,
              total: proposals.totalInvestment,
              createdAt: proposals.createdAt,
              preparedBy: proposals.preparedByUserId,
            })
            .from(proposals)
            .where(and(eq(proposals.tenantId, session.tenantId), eq(proposals.leadId, id)))
            .orderBy(desc(proposals.createdAt))
        : [];
      return { docs, props };
    });
    if (!data) return NextResponse.json({ error: "lead not found" }, { status: 404 });

    return NextResponse.json({
      documents: data.docs.map((d) => ({
        id: d.id,
        name: d.name,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        clientUploaded: Array.isArray(d.tags) && (d.tags as string[]).includes("client_uploaded"),
        createdAt: d.createdAt,
      })),
      proposals: data.props.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        status: p.status,
        total: p.total != null ? Number(p.total) : null,
        createdAt: p.createdAt,
        canPdf: seesAllProposals || p.preparedBy === session.userId,
      })),
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const docId = uuid();

    await withTenant(session.tenantId, async (tx) => {
      await loadEditableLead(tx, session, id);
      await tx.insert(complianceDocuments).values({
        id: docId,
        tenantId: session.tenantId,
        category: "other",
        name: b.name,
        storageKey: b.storageKey,
        mimeType: b.mimeType ?? null,
        sizeBytes: b.sizeBytes != null ? String(b.sizeBytes) : null,
        relatedEntityType: "lead",
        relatedEntityId: id,
        tags: ["lead_attachment"],
        uploadedByUserId: session.userId,
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "document.upload",
        entityType: "compliance_document",
        entityId: docId,
        after: { name: b.name, leadId: id } as any,
        ...meta,
      });
    });
    return NextResponse.json({ id: docId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "document.upload", session.permissions);
    const docId = new URL(req.url).searchParams.get("docId");
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);

    const removed = await withTenant(session.tenantId, async (tx) => {
      await loadEditableLead(tx, session, id);
      const [doc] = await tx
        .select()
        .from(complianceDocuments)
        .where(and(eq(complianceDocuments.id, docId), ofLead(session.tenantId, id)))
        .limit(1);
      if (!doc) return null;
      await tx.delete(complianceDocuments).where(eq(complianceDocuments.id, docId));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "document.delete",
        entityType: "compliance_document",
        entityId: docId,
        before: { name: doc.name, leadId: id } as any,
        ...meta,
      });
      return doc;
    });
    if (!removed) return NextResponse.json({ error: "document not found" }, { status: 404 });
    // After the commit: a storage hiccup must not undo the removal.
    if (removed.storageKey) await deleteObject(removed.storageKey).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
