/**
 * Families collection.
 *
 *   GET  /api/families        — list all families with member counts
 *   POST /api/families        — create a new family group
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { families } from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  headName: z.string().min(2).max(120),
  familyName: z.string().min(2).max(120).optional(),
  primaryInvestorId: z.string().uuid().optional(),
  rmId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) =>
      tx.select().from(families).orderBy(desc(families.createdAt))
    );
    return NextResponse.json({ families: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(families).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId,
        headName: parse.data.headName,
        familyName: parse.data.familyName ?? parse.data.headName,
        primaryInvestorId: parse.data.primaryInvestorId ?? null,
        rmId: parse.data.rmId ?? session.userId,
        notes: parse.data.notes,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.create",
        entityType: "family",
        entityId: id,
        after: {
          headName: parse.data.headName,
          familyName: parse.data.familyName,
        },
        ...clientMeta,
      });
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
