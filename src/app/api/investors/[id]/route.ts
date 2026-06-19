import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single investor endpoints.
 *
 *   GET    /api/investors/[id]   — full investor + folios + sips + last comms
 *   PATCH  /api/investors/[id]   — partial update (catalog-writable fields only)
 *   DELETE /api/investors/[id]   — PERMANENT hard delete: removes the client and
 *                                  cascades its owned-data subgraph (folios,
 *                                  transactions, SIPs, goals, proposals … per
 *                                  migration 0131). Irreversible. Gated on the
 *                                  narrow `investor.delete` capability (owner /
 *                                  compliance only) — NOT `investor.edit.all`.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { healthFields } from "@/lib/investors/health";
import { NomineesArray } from "@/lib/investors/nominee";
import { registerNomineePanDocs } from "@/lib/investors/nominee-docs";
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
  complianceDocuments,
  users,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().optional(),
  // Master identity — editable so RMs can fix typos. PAN is uppercased + length-
  // capped; empty string clears it. (DOB is below.)
  pan: z.string().max(10).nullable().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  whatsappPhone: z.string().optional(),
  // Client photo — storage key (general kind) or external URL; "" clears it.
  avatarUrl: z.string().max(500).nullable().optional(),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  investorCategory: z.enum(["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"]).optional(),
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
  // Multiple nominees / bank accounts. The legacy single columns above are kept
  // in sync with the first array entry (mirrored in the handler).
  nominees: NomineesArray,
  bankAccounts: z.array(z.object({
    bankName: z.string().max(120),
    accountMasked: z.string().max(60).optional(),
    ifsc: z.string().max(20).optional(),
    accountType: z.string().max(20).optional(),
  })).max(10).optional(),
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
  clientCategory: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  bseUccCode: z.string().max(40).nullable().optional(),
  nseCanCode: z.string().max(40).nullable().optional(),
  mandateStatus: z.enum(["none", "pending", "active", "expired", "rejected", "cancelled"]).nullable().optional(),
  mandateRefNo: z.string().max(60).nullable().optional(),
  status: z.enum(["active", "dormant", "inactive", "redemption_risk", "closed", "exited"]).optional(),
  reviewFrequency: z.enum(["monthly", "quarterly", "half_yearly", "annual"]).nullable().optional(),
  // Relationship dates — onboardedAt is a timestamp (coerced to Date in the
  // handler); anniversaryDate is a plain date column (accepts YYYY-MM-DD).
  onboardedAt: z.string().nullable().optional(),
  anniversaryDate: z.string().nullable().optional(),
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

      // Enforce scope gating: branch heads → own branch; RMs → assigned only.
      const branchScoped =
        !session.roles.includes("owner") && session.roles.includes("branch_head") && !!session.branchId;
      if (!seesAll && branchScoped) {
        if (inv.branchId !== session.branchId) {
          throw Object.assign(new Error("forbidden: client is in another branch"), { status: 403 });
        }
      } else if (!seesAll && seesAssigned && inv.rmId !== session.userId) {
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

      // Reassigning the RM must stay inside the firm: a uuid from another tenant
      // is a valid uuid but would orphan the client under an RM who can't see
      // them. Verify the target user belongs to this tenant before assigning.
      if (parse.data.rmId !== undefined && parse.data.rmId !== before.rmId) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, parse.data.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return "bad_rm" as const;
      }

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
      // Mirror the first nominee / bank entry into the legacy single columns so
      // existing readers (PDFs, proposals, the health score) keep working.
      const mirror: Record<string, unknown> = {};
      if (parse.data.nominees) {
        const n0 = parse.data.nominees[0];
        mirror.nomineeName = n0?.name ?? null;
        mirror.nomineeRelation = n0?.relation ?? null;
        mirror.nomineeDob = n0?.dob ?? null;
      }
      if (parse.data.bankAccounts) {
        const b0 = parse.data.bankAccounts[0];
        mirror.bankName = b0?.bankName ?? null;
        mirror.bankAccountNumberMasked = b0?.accountMasked ?? null;
        mirror.bankIfsc = b0?.ifsc ?? null;
      }
      const merged = { ...before, ...parse.data, ...mirror };
      const health = healthFields(merged as any);

      // When an explicit review cadence is set, derive the next review date from
      // the last review (or today) so the "Next review" reminder reflects it.
      const reviewPatch: Record<string, unknown> = {};
      if (parse.data.reviewFrequency) {
        const base = before.lastReviewAt ? new Date(before.lastReviewAt as any) : new Date();
        const months =
          parse.data.reviewFrequency === "monthly" ? 1 :
          parse.data.reviewFrequency === "quarterly" ? 3 :
          parse.data.reviewFrequency === "half_yearly" ? 6 : 12;
        const next = new Date(base);
        next.setMonth(next.getMonth() + months);
        reviewPatch.nextReviewAt = next;
      }

      // onboardedAt is a timestamp column — coerce the YYYY-MM-DD string to a
      // Date (Drizzle's date column takes anniversaryDate as a string directly).
      const datePatch: Record<string, unknown> = {};
      if (parse.data.onboardedAt !== undefined) {
        datePatch.onboardedAt = parse.data.onboardedAt ? new Date(parse.data.onboardedAt) : null;
      }

      const after = await tx
        .update(investors)
        .set({
          ...parse.data,
          ...reviewPatch,
          ...datePatch,
          ...mirror,
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

      // Attribute the edit on the audit trail so "last modified by" reflects it
      // (the change-log drawer + RecordProvenance read this).
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.update",
        entityType: "investor",
        entityId: id,
        before: before as any,
        after: after[0] as any,
        ...clientMetaFromHeaders(req.headers),
      });

      // Register any newly-uploaded nominee PAN files as client documents.
      await registerNomineePanDocs(tx, session.tenantId, id, parse.data.nominees, session.userId);

      // A member's KYC/nominee/risk/etc. feeds its family's health too —
      // re-score the family this investor belongs to (no-op if unlinked).
      await recomputeFamilyHealthForInvestor(tx, id);

      return after[0];
    });

    if (result === "bad_rm") return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
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
    // Permanent erasure is far more dangerous than an edit — gate on the narrow
    // delete capability (owner / compliance), not the broad edit.all.
    requireCap(session.roles, "investor.delete");
    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ name: investors.name, pan: investors.pan })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return "not_found" as const;

      // Audit BEFORE the row + its owned-data subgraph are removed.
      await tx.insert(auditLog).values({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "investor.delete",
        entityType: "investor",
        entityId: id,
        before: { name: inv.name, pan: inv.pan } as any,
      } as any);

      // Documents link to the client polymorphically (no FK), so the cascade
      // won't reach them — remove them explicitly.
      await tx
        .delete(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.tenantId, session.tenantId),
            eq(complianceDocuments.relatedEntityType, "investor"),
            eq(complianceDocuments.relatedEntityId, id)
          )
        );

      // Permanent hard delete — folios/transactions/sips/proposals/goals/etc.
      // cascade automatically (migration 0131).
      await tx
        .delete(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)));
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
