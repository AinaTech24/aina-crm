import { handleApiError } from "@/lib/api/error-handler";
/**
 * Insurance claims collection.
 *   POST /api/insurance-claims — create a claim
 * (The list page queries directly via withTenant; no GET needed here.)
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { insuranceClaims, investors, CLAIM_STATUSES, CLAIM_TYPES, CLAIM_MODES, INTIMATION_MODES, SUBMITTED_MODES } from "@/db/schema";

export const dynamic = "force-dynamic";

const ClaimBody = z.object({
  policyId: z.string().uuid().optional(),
  policyNumber: z.string().max(80).optional(),
  insurer: z.string().max(160).optional(),
  investorId: z.string().uuid().optional(),
  proposerName: z.string().min(1).max(160),
  contactPerson: z.string().max(160).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  claimStatus: z.enum(CLAIM_STATUSES).optional(),
  policyDetails: z.string().max(2000).optional(),
  claimType: z.enum(CLAIM_TYPES).optional(),
  claimMode: z.enum(CLAIM_MODES).optional(),
  intimationMode: z.enum(INTIMATION_MODES).optional(),
  submittedMode: z.enum(SUBMITTED_MODES).optional(),
  admissionDate: z.string().optional(),
  intimationDate: z.string().optional(),
  submissionDate: z.string().optional(),
  settlementDate: z.string().optional(),
  claimedAmount: z.number().min(0).optional(),
  settledAmount: z.number().min(0).optional(),
  rmId: z.string().uuid().optional(),
  comments: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "insurance.write");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = ClaimBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);

    await withTenant(session.tenantId, async (tx) => {
      if (b.investorId) {
        const inv = await tx.select({ id: investors.id }).from(investors).where(eq(investors.id, b.investorId)).limit(1);
        if (inv.length === 0) throw Object.assign(new Error("Client not found in this tenant"), { status: 404 });
      }
      await tx.insert(insuranceClaims).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        policyId: b.policyId ?? null,
        policyNumber: b.policyNumber ?? null,
        insurer: b.insurer ?? null,
        investorId: b.investorId ?? null,
        proposerName: b.proposerName,
        contactPerson: b.contactPerson ?? null,
        email: b.email || null,
        phone: b.phone ?? null,
        claimStatus: b.claimStatus ?? "claim_intimated",
        policyDetails: b.policyDetails ?? null,
        claimType: b.claimType ?? null,
        claimMode: b.claimMode ?? null,
        intimationMode: b.intimationMode ?? null,
        submittedMode: b.submittedMode ?? null,
        admissionDate: b.admissionDate ?? null,
        intimationDate: b.intimationDate ?? null,
        submissionDate: b.submissionDate ?? null,
        settlementDate: b.settlementDate ?? null,
        claimedAmount: b.claimedAmount != null ? String(b.claimedAmount) : "0",
        settledAmount: b.settledAmount != null ? String(b.settledAmount) : "0",
        rmId: b.rmId ?? session.userId,
        comments: b.comments ?? null,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "insurance_claim.create",
        entityType: "insurance_claim",
        entityId: id,
        after: { proposerName: b.proposerName, policyNumber: b.policyNumber, claimStatus: b.claimStatus, claimedAmount: b.claimedAmount },
        ...clientMeta,
      });
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
