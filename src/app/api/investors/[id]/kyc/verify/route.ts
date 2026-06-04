import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/[id]/kyc/verify
 *   Runs the configured KYC provider (or stub) for this client and writes the
 *   result back onto the investor (kyc status, CKYC number, name-as-per-PAN,
 *   PAN-Aadhaar link). Turns days of manual transcription into one click.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors } from "@/db/schema";
import { verifyKyc } from "@/lib/kyc/verify";

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<string, string> = {
  verified: "verified",
  not_found: "pending",
  mismatch: "hold",
  pending: "pending",
  error: "pending",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const [inv] = await tx
          .select()
          .from(investors)
          .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!inv) return null;

        const r = await verifyKyc({
          pan: inv.pan,
          name: inv.name,
          dob: (inv as any).dob ?? null,
          aadhaarLast4: (inv as any).aadhaarLast4 ?? null,
        });

        const patch: any = { kycStatus: STATUS_MAP[r.status] ?? "pending", kycLastUpdatedBy: session.userId, updatedAt: new Date() };
        if (r.status === "verified") {
          patch.kycValidatedAt = new Date();
          if (r.ckycNumber) patch.ckycNumber = r.ckycNumber;
          if (r.nameAsPerPan) patch.nameAsPerPan = r.nameAsPerPan;
          if (r.panAadhaarLinked != null) patch.panAadhaarLinkStatus = r.panAadhaarLinked ? "linked" : "not_linked";
        }
        await tx.update(investors).set(patch).where(eq(investors.id, id));

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "investor.kyc.verify",
          entityType: "investor",
          entityId: id,
          after: { provider: r.provider, status: r.status, ckycNumber: r.ckycNumber, kycStatus: patch.kycStatus },
          ...clientMeta,
        });
        return { ok: true, provider: r.provider, status: r.status, kycStatus: patch.kycStatus, ckycNumber: r.ckycNumber ?? null, message: r.message };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
