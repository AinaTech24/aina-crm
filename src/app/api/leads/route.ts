import { handleApiError } from "@/lib/api/error-handler";
/**
 * Leads collection.
 *   GET  /api/leads
 *   POST /api/leads
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { pickRmForNewLead } from "@/lib/leads/assign";
import { leads, eventsOutbox } from "@/db/schema";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  city: z.string().optional(),
  source: z
    .enum([
      // Spec-canonical (10)
      "referral", "website", "social_media", "webinar", "seminar",
      "walk_in", "existing_client", "google", "cold_call", "other",
      // Legacy
      "meta_ads", "google_ads", "linkedin", "youtube", "event", "manual",
    ])
    .default("manual"),
  sourceCampaign: z.string().optional(),
  intendedAmount: z.string().optional(),
  notes: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  /** When source is 'referral' or 'existing_client' — link to the referrer in the Clients module. */
  referredByInvestorId: z.string().uuid().optional(),
  referredByName: z.string().max(200).optional(),
  /** When sourced by a channel partner — drives commission split on conversion. */
  subDistributorId: z.string().uuid().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.select().from(leads).orderBy(desc(leads.createdAt));
    });
    return NextResponse.json({ leads: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    // Allow lead.edit.all (marketing) OR lead.edit.assigned (rm). Owner
    // always wins via the can() override. branch_head doesn't have a
    // dedicated lead-edit cap in the matrix — treat as edit.assigned.
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned"]);
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = CreateBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const body = parse.data;

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    let assignedOwnerId: string | null = null;
    let assignedVia: "manual" | "round_robin" | "creator" = "creator";

    await withTenant(session.tenantId, async (tx) => {
      // Resolve owner: explicit body.ownerId wins; otherwise auto-assign to an
      // RM via least-loaded round-robin; otherwise fall back to the creator.
      if (body.ownerId) {
        assignedOwnerId = body.ownerId;
        assignedVia = "manual";
      } else {
        const picked = await pickRmForNewLead(tx, {
          branchId: session.branchId ?? null,
          strategy: "least_loaded",
          excludeUserId: session.roles.includes("rm") ? null : session.userId,
        });
        if (picked) {
          assignedOwnerId = picked;
          assignedVia = "round_robin";
        } else {
          assignedOwnerId = session.userId;
          assignedVia = "creator";
        }
      }

      const inserted = await tx
        .insert(leads)
        .values({
          id,
          tenantId: session.tenantId,
          branchId: session.branchId,
          name: body.name,
          email: body.email || null,
          phone: body.phone || null,
          city: body.city || null,
          source: body.source,
          sourceCampaign: body.sourceCampaign || null,
          stage: "new",
          stageChangedAt: new Date(),
          intendedAmount: body.intendedAmount,
          notes: body.notes,
          ownerId: assignedOwnerId,
          referredByInvestorId: body.referredByInvestorId ?? null,
          referredByName: body.referredByName ?? null,
          subDistributorId: body.subDistributorId ?? null,
        } as any)
        .returning();

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "lead.created",
        entityType: "lead",
        entityId: id,
        after: inserted[0] as any,
        meta: { userId: session.userId, assignedVia, assignedOwnerId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.create",
        entityType: "lead",
        entityId: id,
        after: { name: body.name, source: body.source, stage: "new", ownerId: assignedOwnerId, assignedVia },
        ...clientMeta,
      });
    });

    return NextResponse.json({ id, ownerId: assignedOwnerId, assignedVia }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
