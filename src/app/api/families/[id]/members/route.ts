import { handleApiError } from "@/lib/api/error-handler";
/**
 * Family membership management.
 *
 *   POST   /api/families/[id]/members  Body: { investorId, familyRole? } — attach an existing investor.
 *   DELETE /api/families/[id]/members?investorId=…                       — detach.
 *
 * On attach: sets investors.family_id + family_role and emits an outbox event
 * so any downstream workflows (e.g. family-onboarding play) can react.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors, families, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const AddBody = z.object({
  investorId: z.string().uuid(),
  familyRole: z.string().optional(), // 'spouse' | 'son' | 'daughter' | 'father' | ...
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: familyId } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = AddBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      // Confirm family exists (RLS already scopes to tenant)
      const fam = (await tx.select().from(families).where(eq(families.id, familyId)).limit(1))[0];
      if (!fam) throw Object.assign(new Error("family not found"), { status: 404 });

      // Confirm investor exists
      const inv = (await tx.select().from(investors).where(eq(investors.id, parse.data.investorId)).limit(1))[0];
      if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });

      const updated = await tx
        .update(investors)
        .set({
          familyId,
          familyRole: parse.data.familyRole ?? null,
          updatedAt: new Date(),
        } as any)
        .where(eq(investors.id, parse.data.investorId))
        .returning();

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "investor.family_linked",
        entityType: "investor",
        entityId: parse.data.investorId,
        before: { familyId: inv.familyId } as any,
        after: { familyId, familyRole: parse.data.familyRole } as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.member.add",
        entityType: "family",
        entityId: familyId,
        before: { familyId: inv.familyId },
        after: { investorId: parse.data.investorId, familyRole: parse.data.familyRole },
        ...clientMeta,
      });

      return updated[0];
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: familyId } = await params;
  const url = new URL(req.url);
  const investorId = url.searchParams.get("investorId");
  if (!investorId) return NextResponse.json({ error: "investorId query required" }, { status: 400 });

  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(investors)
        .set({ familyId: null, familyRole: null, updatedAt: new Date() } as any)
        .where(and(eq(investors.id, investorId), eq(investors.familyId, familyId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.member.remove",
        entityType: "family",
        entityId: familyId,
        before: { investorId, familyId },
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
