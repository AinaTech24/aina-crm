import { handleApiError } from "@/lib/api/error-handler";
/**
 * Leads collection.
 *   GET  /api/leads
 *   POST /api/leads
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { pickAssignee } from "@/lib/assignment/engine";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense, assertModuleEnabled } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { pickRmForNewLead } from "@/lib/leads/assign";
import { canEditAllLeads, leadScopeCondition, requireLeadView } from "@/lib/leads/access";
import {
  normalizeEmail,
  normalizeLeadSource,
  normalizePan,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";
import { leads, eventsOutbox, tasks } from "@/db/schema";
import { scoreFields } from "@/lib/leads/score";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  pan: z.string().optional(),
  city: z.string().optional(),
  // Optional lead photo — storage key (general kind) or URL. Never required.
  avatarUrl: z.string().max(500).optional(),
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
  /** Canonical pipeline value in rupees (preferred over the free-text amount). */
  expectedBusinessAmount: z.number().min(0).max(1e12).optional(),
  aumPotential: z.enum(["under_10l", "10l_50l", "50l_2cr", "hni_2cr_plus"]).optional(),
  leadType: z.enum(["individual", "hni", "nri", "corporate", "minor"]).optional(),
  /** Products of interest (multi). The column already existed — now captured. */
  interestProducts: z.array(z.string().max(60)).max(20).optional(),
  occupation: z.string().max(120).optional(),
  currentInvestments: z.array(z.string().max(60)).max(20).optional(),
  altPhone: z.string().max(20).optional(),
  altEmail: z.string().email().optional().or(z.literal("")),
  /** First follow-up moment — sets next_follow_up_at + spawns a follow-up task. */
  followUpDate: z.string().datetime().optional().or(z.literal("")),
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
    await assertModuleEnabled(session.tenantId, "lead_management", session.roles);
    requireLeadView(session);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const scope = leadScopeCondition(session);
      // Exclude soft-deleted (archived) leads from every consumer of this API.
      const notArchived = sql`${leads.lostReason} IS DISTINCT FROM '__deleted__'`;
      const base = and(isNull(leads.convertedInvestorId), notArchived);
      const where = scope ? and(base, scope) : base;
      // Hottest leads first (persisted deterministic score), newest as tiebreak.
      // Bounded so a large tenant can't return an unbounded payload.
      return tx.select().from(leads).where(where).orderBy(desc(leads.leadScore), desc(leads.createdAt)).limit(1000);
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
    await assertModuleEnabled(session.tenantId, "lead_management", session.roles);
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
      if (body.ownerId && canEditAllLeads(session)) {
        assignedOwnerId = body.ownerId;
        assignedVia = "manual";
      } else if (!canEditAllLeads(session)) {
        assignedOwnerId = session.userId;
        assignedVia = "creator";
      } else {
        // Configurable Assignment Rules win when defined; else the built-in
        // least-loaded picker; else the creator.
        const rulePick = await pickAssignee(tx, {
          tenantId: session.tenantId,
          subjectType: "lead",
          record: { source: body.source },
        });
        if (rulePick) {
          assignedOwnerId = rulePick;
          assignedVia = "round_robin";
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
      }

      // Canonical pipeline value wins; keep intended_amount populated (from it)
      // so legacy scoring + old readers keep working.
      const intendedAmount =
        body.intendedAmount ??
        (body.expectedBusinessAmount != null ? String(body.expectedBusinessAmount) : null);
      const followUpAt =
        body.followUpDate && body.followUpDate !== "" ? new Date(body.followUpDate) : null;

      const inserted = await tx
        .insert(leads)
        .values({
          id,
          tenantId: session.tenantId,
          branchId: session.branchId,
          name: body.name,
          email: body.email || null,
          emailNormalized: normalizeEmail(body.email),
          phone: body.phone || null,
          phoneNormalized: normalizePhoneLast10(body.phone),
          pan: normalizePan(body.pan),
          city: body.city || null,
          avatarUrl: body.avatarUrl || null,
          source: normalizeLeadSource(body.source),
          sourceCampaign: body.sourceCampaign || null,
          stage: "new",
          stageChangedAt: new Date(),
          intendedAmount,
          expectedBusinessAmount:
            body.expectedBusinessAmount != null ? String(body.expectedBusinessAmount) : null,
          aumPotential: body.aumPotential ?? null,
          leadType: body.leadType ?? null,
          interestProducts: body.interestProducts ?? [],
          profile: {
            ...(body.occupation ? { occupation: body.occupation } : {}),
            ...(body.currentInvestments?.length ? { currentInvestments: body.currentInvestments } : {}),
          },
          altPhone: body.altPhone || null,
          altEmail: body.altEmail || null,
          nextFollowUpAt: followUpAt,
          notes: body.notes,
          ownerId: assignedOwnerId,
          referredByInvestorId: body.referredByInvestorId ?? null,
          referredByName: body.referredByName ?? null,
          subDistributorId: body.subDistributorId ?? null,
          // Deterministic initial score from the captured signals.
          ...scoreFields({
            source: normalizeLeadSource(body.source),
            stage: "new",
            intendedAmount,
            stageChangedAt: new Date(),
            email: body.email || null,
            phone: body.phone || null,
            pan: normalizePan(body.pan),
          }),
        } as any)
        .returning();

      // First follow-up — set on the lead above + spawn a task the RM sees in
      // their queue (mirrors how the call-outcome flow creates follow-ups).
      if (followUpAt && !Number.isNaN(followUpAt.getTime())) {
        await tx.insert(tasks).values({
          tenantId: session.tenantId,
          subjectType: "lead",
          subjectId: id,
          relatedLeadId: id,
          type: "follow_up",
          title: `Follow-up: ${body.name}`,
          description: body.notes ?? null,
          priority: "normal",
          status: "open",
          assigneeId: assignedOwnerId ?? session.userId,
          createdById: session.userId,
          department: "sales",
          dueAt: followUpAt,
        } as any);
      }

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
