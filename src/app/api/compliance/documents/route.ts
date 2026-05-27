/**
 * Compliance documents collection.
 *
 *   GET  /api/compliance/documents
 *   POST /api/compliance/documents          — register an uploaded doc (after presigned PUT)
 *
 * Upload flow:
 *   1. Client POSTs metadata to /upload-url to get a presigned PUT
 *   2. Client uploads file directly to S3 with that URL
 *   3. Client POSTs the storage key + metadata here to register it
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { complianceDocuments } from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  category: z.enum([
    "arn",
    "euin",
    "nism",
    "kyd",
    "amc_empanelment",
    "ddq",
    "sop",
    "complaint",
    "marketing_approval",
    "audit_report",
    "ria_compliance",
    "other",
  ]),
  name: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  storageKey: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  issuedOn: z.string().optional(),
  expiresOn: z.string().optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.select().from(complianceDocuments).orderBy(desc(complianceDocuments.createdAt));
    });
    return NextResponse.json({ documents: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const id = uuid();
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(complianceDocuments).values({
        id,
        tenantId: session.tenantId,
        category: body.category,
        name: body.name,
        description: body.description,
        storageKey: body.storageKey,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes ? String(body.sizeBytes) : undefined,
        issuedOn: body.issuedOn || null,
        expiresOn: body.expiresOn || null,
        relatedEntityType: body.relatedEntityType,
        relatedEntityId: body.relatedEntityId,
        tags: body.tags ?? [],
        uploadedByUserId: session.userId,
      } as any);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
