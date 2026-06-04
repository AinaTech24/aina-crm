import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single investor endpoints.
 *
 *   GET    /api/investors/[id]   — full investor + folios + sips + last comms
 *   PATCH  /api/investors/[id]   — partial update (catalog-writable fields only)
 *   DELETE /api/investors/[id]   — soft delete (status='exited' + DPDP purge per request)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { healthFields } from "@/lib/investors/health";
import { recomputeFamilyHealthForInvestor } from "@/lib/families/health-persist";
import {
  investors,
  folios,
  sips,
  goals,
  communications,
  serviceRequests,
  tasks,
  eventsOutbox,
  auditLog,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  whatsappPhone: z.string().optional(),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  investorCategory: z.enum(["individual", "huf", "corporate", "trust", "nri", "minor", "other"]).optional(),
  rmId: z.string().uuid().optional(),
  // Client-service preferences
  statementCadence: z.enum(["off", "monthly", "quarterly"]).optional(),
  languagePref: z.enum(["en", "hi", "gu", "mr", "ta", "te", "kn", "bn", "ml", "pa"]).optional(),
  riskProfile: z.enum(["conservative", "moderate", "aggressive", "very_aggressive"]).optional(),
  nomineeName: z.string().optional(),
  nomineeRelation: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumberMasked: z.string().optional(),
  bankIfsc: z.string().optional(),
  notes: z.string().optional(),
  // KYC tracker (Network FP 2.4 parity, migration 0024)
  nameAsPerPan: z.string().max(200).nullable().optional(),
  kycStatus: z
    .enum([
      "pending",
      "registered",
      "verified",
      "hold",
      "rejected",
      "expired",
      "re_kyc_required",
    ])
    .optional(),
  panAadhaarLinkStatus: z
    .enum(["linked", "not_linked", "pending", "not_applicable"])
    .nullable()
    .optional(),
  residencyStatus: z
    .enum(["indian_resident", "nri", "oci", "pio", "foreign_national"])
    .nullable()
    .optional(),
  aadhaarLast4: z
    .string()
    .regex(/^\d{4}$/, "Aadhaar last 4 must be 4 digits")
    .nullable()
    .optional()
    .or(z.literal("")),
  kycValidatedAt: z.string().nullable().optional(),
  ckycNumber: z.string().max(40).nullable().optional(),
  ckycExpiryAt: z.string().nullable().optional(),
  /** Cross-sell / product-holdings matrix: { productKey: statusKey }. */
  crossSell: z.record(z.string(), z.string()).nullable().optional(),
  // ── Master-record editable fields (Sanchay parity) ──────────────────
  dob: z.string().nullable().optional(), // YYYY-MM-DD (date column accepts string)
  gender: z.enum(["M", "F", "O"]).nullable().optional(),
  alternatePhone: z.string().max(20).nullable().optional(),
  occupation: z.string().max(120).nullable().optional(),
  incomeRange: z.string().max(60).nullable().optional(),
  employerName: z.string().max(200).nullable().optional(),
  address: z
    .object({
      line1: z.string().max(300).optional(),
      city: z.string().max(120).optional(),
      state: z.string().max(120).optional(),
      pincode: z.string().max(12).optional(),
      country: z.string().max(80).optional(),
    })
    .nullable()
    .optional(),
  serviceTier: z.enum(["A", "B", "C"]).nullable().optional(),
  bseUccCode: z.string().max(40).nullable().optional(),
  nseCanCode: z.string().max(40).nullable().optional(),
  mandateStatus: z.enum(["none", "pending", "active", "expired", "rejected", "cancelled"]).nullable().optional(),
  mandateRefNo: z.string().max(60).nullable().optional(),
  status: z.enum(["active", "dormant", "inactive", "redemption_risk", "closed", "exited"]).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const seesAssigned = can(session.roles, "investor.view.assigned", session.permissions);
    if (!seesAll && !seesAssigned) {
      return NextResponse.json({ error: "forbidden: missing view capability" }, { status: 403 });
    }

    const result = await withTenant(session.tenantId, async (tx) => {
      const inv = (await tx.select().from(investors).where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId))).limit(1))[0];
      if (!inv) return null;

      // Enforce RM assignment gating
      if (!seesAll && seesAssigned && inv.rmId !== session.userId) {
        throw Object.assign(new Error("forbidden: client not assigned to you"), { status: 403 });
      }

      const [foliosRows, sipsRows, goalsRows, commsRows, tasksRows, srRows] = await Promise.all([
        tx.select().from(folios).where(eq(folios.investorId, id)),
        tx.select().from(sips).where(eq(sips.investorId, id)),
        tx.select().from(goals).where(eq(goals.investorId, id)),
        tx
          .select()
          .from(communications)
          .where(eq(communications.investorId, id))
          .orderBy(desc(communications.createdAt))
          .limit(10),
        tx.select().from(tasks).where(eq(tasks.subjectId, id)).limit(20),
        tx.select().from(serviceRequests).where(eq(serviceRequests.investorId, id)).limit(20),
      ]);

      // Log PII access (DPDP requirement)
      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorType: "user",
        action: "investor.view",
        entityType: "investor",
        entityId: id,
        piiAccessed: { pan: !!inv.pan, dob: !!inv.dob, address: !!inv.address } as any,
        reason: "investor 360 page",
      } as any);

      return {
        investor: inv,
        folios: foliosRows,
        sips: sipsRows,
        goals: goalsRows,
        communications: commsRows,
        tasks: tasksRows,
        serviceRequests: srRows,
      };
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(investors).where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      // Stamp KYC audit fields when any KYC-related column is touched.
      const touchingKyc =
        parse.data.kycStatus !== undefined ||
        parse.data.nameAsPerPan !== undefined ||
        parse.data.panAadhaarLinkStatus !== undefined ||
        parse.data.residencyStatus !== undefined ||
        parse.data.aadhaarLast4 !== undefined ||
        parse.data.kycValidatedAt !== undefined ||
        parse.data.ckycNumber !== undefined ||
        parse.data.ckycExpiryAt !== undefined;

      // Recompute persisted health from the post-patch state — many edited
      // fields (KYC, nominee, bank, risk profile, review dates) feed the score.
      const merged = { ...before, ...parse.data };
      const health = healthFields(merged as any);

      const after = await tx
        .update(investors)
        .set({
          ...parse.data,
          updatedAt: new Date(),
          ...(touchingKyc
            ? { kycLastUpdatedBy: session.userId }
            : {}),
          ...health,
        } as any)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .returning();

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "investor.updated",
        entityType: "investor",
        entityId: id,
        before: before as any,
        after: after[0] as any,
        meta: { userId: session.userId } as any,
      } as any);

      // A member's KYC/nominee/risk/etc. feeds its family's health too —
      // re-score the family this investor belongs to (no-op if unlinked).
      await recomputeFamilyHealthForInvestor(tx, id);

      return after[0];
    });

    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(investors)
        .set({ status: "exited", exitedAt: new Date(), updatedAt: new Date() } as any)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)));

      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.exit",
        entityType: "investor",
        entityId: id,
      } as any);
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
