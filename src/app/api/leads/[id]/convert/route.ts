/**
 * POST /api/leads/[id]/convert
 * Body: { pan, segmentTag?, investorCategory?, rmId?, notes? }
 *
 * Converts a qualified lead into an investor:
 *   1. Creates an investor record using lead's name/email/phone/city + PAN supplied
 *   2. Stamps lead.stage = 'converted', converted_at = now(), converted_investor_id = new id
 *   3. Emits 'lead.converted' + 'investor.created' outbox events so subscribed
 *      workflows (welcome onboarding, first-investment plays) fire automatically.
 *
 * Returns { investorId } so the UI can redirect.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import {
  leads,
  investors,
  eventsOutbox,
  riskProfileResponses,
  proposals,
  complianceDocuments,
  communications,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F"),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).default("Retail"),
  investorCategory: z
    .enum(["individual", "huf", "corporate", "trust", "nri", "minor", "other"])
    .default("individual"),
  rmId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const investorId = uuid();

    const result = await withTenant(session.tenantId, async (tx) => {
      const lead = (await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1))[0];
      if (!lead) throw Object.assign(new Error("lead not found"), { status: 404 });
      if (lead.stage === "converted" && lead.convertedInvestorId) {
        // Idempotent — return the existing investor
        return { investorId: lead.convertedInvestorId, alreadyConverted: true };
      }

      // Create investor
      const inserted = await tx
        .insert(investors)
        .values({
          id: investorId,
          tenantId: session.tenantId,
          branchId: session.branchId,
          name: lead.name,
          pan: body.pan.toUpperCase(),
          email: lead.email,
          phone: lead.phone,
          whatsappPhone: lead.phone,
          address: lead.city ? ({ city: lead.city, country: "India" } as any) : null,
          segmentTag: body.segmentTag,
          investorCategory: body.investorCategory,
          rmId: body.rmId ?? lead.ownerId ?? session.userId,
          status: "active",
          onboardedAt: new Date(),
          notes: body.notes ?? lead.notes ?? null,
          kycStatus: "pending",
        } as any)
        .returning();

      // Stamp lead
      await tx
        .update(leads)
        .set({
          stage: "converted",
          stageChangedAt: new Date(),
          convertedInvestorId: investorId,
          convertedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(leads.id, leadId));

      // ─── DATA CARRYOVER ──────────────────────────────────────────────
      // Per the spec: no data should be lost on conversion. We re-point
      // every related record from the lead onto the new investor.

      // 1. Risk profile responses — the lead's responses used `lead_id` in
      //    `investor_id` polymorphically (see /api/public/risk-profile/submit).
      //    Repoint to the actual investor so investor.riskProfile column lines up.
      const carriedRpr = await tx.execute(sql`
        UPDATE risk_profile_responses
           SET investor_id = ${investorId}::uuid,
               updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid
           AND investor_id = ${leadId}::uuid
        RETURNING id, final_category, total_score, signed_at
      `);
      const latestRisk = (carriedRpr.rows as any[])[0];
      if (latestRisk) {
        // signed_at comes back as a string from raw tx.execute (Postgres
        // formatted timestamp). Drizzle's update on a timestamp column
        // calls value.toISOString() — so we MUST hand it a real Date.
        const signedAt = latestRisk.signed_at ? new Date(latestRisk.signed_at) : null;
        await tx
          .update(investors)
          .set({
            riskProfile: latestRisk.final_category as any,
            riskProfileScore: Number(latestRisk.total_score),
            riskProfileSignedAt: signedAt,
            updatedAt: new Date(),
          } as any)
          .where(eq(investors.id, investorId));
      }

      // 2. Proposals — re-point lead-bound proposals to also carry the investor
      await tx
        .update(proposals)
        .set({ investorId, recipientType: "investor" as any, updatedAt: new Date() } as any)
        .where(eq(proposals.leadId, leadId));

      // 3. Compliance documents (KYC uploads) — were saved with
      //    related_entity_type='lead' + related_entity_id=leadId. Move them.
      await tx.execute(sql`
        UPDATE compliance_documents
           SET related_entity_type = 'investor',
               related_entity_id = ${investorId}::uuid,
               updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid
           AND related_entity_type = 'lead'
           AND related_entity_id = ${leadId}::uuid
      `);

      // 4. Communications — set the investor_id on lead-bound rows so the
      //    investor's timeline picks them up.
      await tx
        .update(communications)
        .set({ investorId, updatedAt: new Date() } as any)
        .where(eq(communications.leadId, leadId));

      // 5. Meetings (review_meetings) — already keyed by investorId=leadId
      //    by the call-outcome flow. Repoint.
      await tx.execute(sql`
        UPDATE review_meetings
           SET investor_id = ${investorId}::uuid,
               updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid
           AND investor_id = ${leadId}::uuid
      `);

      // 6. Open share_tokens (proposal approval, doc collection, risk profile)
      //    pointing at the lead → repoint at investor so links keep working.
      await tx.execute(sql`
        UPDATE share_tokens
           SET subject_type = 'investor',
               subject_id = ${investorId}::uuid,
               updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid
           AND subject_type = 'lead'
           AND subject_id = ${leadId}::uuid
           AND used_at IS NULL
      `);

      // Outbox events — let subscribed workflows kick in.
      // `inserted[0]` contains Date objects from Drizzle's returning(); we
      // round-trip through JSON.stringify so the JSONB column gets plain
      // ISO-string dates instead of native Date instances (which trip
      // Drizzle's value formatter inside jsonb: "value.toISOString is not
      // a function" on the next downstream consumer).
      const investorSnapshot = JSON.parse(JSON.stringify(inserted[0] ?? {}));
      await tx.insert(eventsOutbox).values([
        {
          tenantId: session.tenantId,
          kind: "lead.converted",
          entityType: "lead",
          entityId: leadId,
          after: { investorId } as any,
          meta: { userId: session.userId } as any,
        },
        {
          tenantId: session.tenantId,
          kind: "investor.created",
          entityType: "investor",
          entityId: investorId,
          after: investorSnapshot as any,
          meta: { userId: session.userId, source: "lead_conversion", leadId } as any,
        },
      ] as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.convert",
        entityType: "lead",
        entityId: leadId,
        after: { investorId, leadName: lead.name },
        ...clientMeta,
      });

      return { investorId, alreadyConverted: false };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("investors_tenant_pan_unique")) {
      return NextResponse.json(
        { error: "An investor with this PAN already exists — use the existing record." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
