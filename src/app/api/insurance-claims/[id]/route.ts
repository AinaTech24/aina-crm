import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single insurance claim.
 *   GET    /api/insurance-claims/[id]
 *   PATCH  /api/insurance-claims/[id]
 *   DELETE /api/insurance-claims/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { insuranceClaims, investors, CLAIM_STATUSES, CLAIM_TYPES, CLAIM_MODES, INTIMATION_MODES, SUBMITTED_MODES } from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    policyId: z.string().uuid().nullable().optional(),
    policyNumber: z.string().max(80).nullable().optional(),
    insurer: z.string().max(160).nullable().optional(),
    investorId: z.string().uuid().nullable().optional(),
    proposerName: z.string().min(1).max(160).optional(),
    contactPerson: z.string().max(160).nullable().optional(),
    email: z.string().email().nullable().optional().or(z.literal("")),
    phone: z.string().max(20).nullable().optional(),
    claimStatus: z.enum(CLAIM_STATUSES).optional(),
    policyDetails: z.string().max(2000).nullable().optional(),
    claimType: z.enum(CLAIM_TYPES).nullable().optional(),
    claimMode: z.enum(CLAIM_MODES).nullable().optional(),
    intimationMode: z.enum(INTIMATION_MODES).nullable().optional(),
    submittedMode: z.enum(SUBMITTED_MODES).nullable().optional(),
    admissionDate: z.string().nullable().optional(),
    intimationDate: z.string().nullable().optional(),
    submissionDate: z.string().nullable().optional(),
    settlementDate: z.string().nullable().optional(),
    claimedAmount: z.number().min(0).optional(),
    settledAmount: z.number().min(0).optional(),
    rmId: z.string().uuid().nullable().optional(),
    comments: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.view");
    const row = await withTenant(session.tenantId, async (tx) => {
      const c = (await tx.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1))[0];
      if (!c) return null;
      const inv = c.investorId
        ? (await tx.select({ name: investors.name }).from(investors).where(eq(investors.id, c.investorId)).limit(1))[0]
        : null;
      return { ...c, investorName: inv?.name ?? null };
    });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1))[0];
      if (!before) return null;
      const patch: any = { ...parse.data, updatedAt: new Date() };
      for (const k of ["claimedAmount", "settledAmount"] as const) {
        if (patch[k] != null) patch[k] = String(patch[k]);
      }
      const r = await tx.update(insuranceClaims).set(patch).where(eq(insuranceClaims.id, id)).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance_claim.update",
        entityType: "insurance_claim",
        entityId: id,
        before: { claimStatus: before.claimStatus, settledAmount: before.settledAmount } as any,
        after: parse.data as any,
        ...clientMeta,
      });
      return r[0];
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write");
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const ok = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(insuranceClaims).where(eq(insuranceClaims.id, id)).limit(1))[0];
      if (!before) return false;
      await tx.delete(insuranceClaims).where(eq(insuranceClaims.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance_claim.delete",
        entityType: "insurance_claim",
        entityId: id,
        before: { proposerName: before.proposerName, claimStatus: before.claimStatus },
        ...clientMeta,
      });
      return true;
    });
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
