import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-lead endpoints.
 *
 *   GET    /api/leads/[id]   — fetch one lead
 *   PATCH  /api/leads/[id]   — partial update
 *   DELETE /api/leads/[id]   — soft delete (lib/leads/lifecycle.ts; restorable)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { writeStageThroughJourney } from "@/lib/blueprints/journey-access";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { leads, eventsOutbox, users } from "@/db/schema";
import { canEditAllLeads, loadEditableLead, loadViewableLead } from "@/lib/leads/access";
import { reassignLead } from "@/lib/leads/ownership";
import { leadContactIssue } from "@/lib/leads/contact-rules";
import { softDeleteLead } from "@/lib/leads/lifecycle";
import { scoreFields } from "@/lib/leads/score";
import {
  normalizeEmail,
  normalizeLeadSource,
  normalizeLeadStage,
  normalizePan,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";

export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  pan: z.string().optional(),
  city: z.string().optional(),
  pincode: z.string().optional(),
  source: z.string().optional(),
  sourceCampaign: z.string().optional(),
  stage: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  intendedAmount: z.string().optional(),
  followUpNotes: z.string().optional(),
  nextFollowUpAt: z.string().optional(),
  lostReason: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) => loadViewableLead(tx, session, id));
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
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    // What an edit changes is held to the create rules (L21): a real phone /
    // email / PAN — an invalid PAN is refused with its field, never dropped.
    const issue = leadContactIssue(parse.data);
    if (issue) return NextResponse.json({ error: issue.error, field: issue.field }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = await loadEditableLead(tx, session, id);
      const patch: Record<string, any> = { ...parse.data };
      if (!canEditAllLeads(session) && !(session.mobile && session.roles.includes("rm"))) delete patch.ownerId;
      // Reassigning the owner must stay inside the firm — a uuid from another
      // tenant would orphan the lead under someone who can't see it.
      if (patch.ownerId && patch.ownerId !== before.ownerId) {
        const [u] = await tx
          .select({ id: users.id, branchId: users.branchId, status: users.status })
          .from(users)
          .where(and(eq(users.id, patch.ownerId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return "bad_owner" as const;
        if (u.status !== "active") return "bad_owner" as const;
        if (session.mobile && !session.roles.some(r => ["owner", "ops", "back_office"].includes(r))
          && (!session.branchId || u.branchId !== session.branchId)) return "bad_owner" as const;
      }
      // Owner and branch move together, the lead's follow-ups go with it and
      // the new owner is told (lib/leads/ownership.ts, L12 / L13 / L14).
      let newOwner: string | null | undefined;
      if (patch.ownerId && patch.ownerId !== before.ownerId) newOwner = patch.ownerId;
      delete patch.ownerId;
      if (Object.prototype.hasOwnProperty.call(patch, "email")) {
        patch.email = patch.email || null;
        patch.emailNormalized = normalizeEmail(patch.email);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "phone")) {
        patch.phone = patch.phone || null;
        patch.phoneNormalized = normalizePhoneLast10(patch.phone);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "pan")) {
        patch.pan = normalizePan(patch.pan);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "source")) {
        patch.source = normalizeLeadSource(patch.source);
      }
      // A stage edit goes through the journey (below), never a bare
      // leads.stage write — the board and the stepper must agree (audit L9).
      let stageMove: string | null = null;
      if (Object.prototype.hasOwnProperty.call(patch, "stage")) {
        const next = normalizeLeadStage(patch.stage);
        if (next !== normalizeLeadStage(before.stage)) stageMove = next;
        delete patch.stage;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "nextFollowUpAt")) {
        patch.nextFollowUpAt = patch.nextFollowUpAt ? new Date(patch.nextFollowUpAt) : null;
      }
      // Re-score on edit. The deterministic score depends on source / stage /
      // amount / contact fields; recompute from the merged row so an edit moves
      // the hot/warm/cold band immediately (previously only create + the stage
      // route re-scored, so editing the intended amount left the score stale).
      const merged: any = { ...before, ...patch };
      const scored = scoreFields({
        source: merged.source,
        stage: merged.stage,
        intendedAmount: merged.intendedAmount,
        lastContactAt: merged.lastContactAt,
        nextFollowUpAt: merged.nextFollowUpAt,
        stageChangedAt: merged.stageChangedAt,
        email: merged.email,
        phone: merged.phone,
        pan: merged.pan,
        interestProducts: merged.interestProducts,
      });
      let after = await tx
        .update(leads)
        .set({ ...patch, ...scored, updatedAt: new Date() } as any)
        .where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)))
        .returning();
      if (newOwner) {
        await reassignLead(tx, { tenantId: session.tenantId, leadId: id, toOwnerId: newOwner, actorUserId: session.userId });
        after = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));
      }
      if (stageMove) {
        const moved = await writeStageThroughJourney(tx, session, id, stageMove, {
          remarks: "Stage changed on the lead record.",
          ...clientMeta,
        });
        if (!moved.ok) throw Object.assign(new Error(moved.reason ?? "This stage move is not allowed."), { status: 409 });
        after = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId)));
      }

      // Emit lead.updated (before/after) so the workflow-rules engine can react
      // to a lead edit — e.g. a stage change made from the edit panel. (Only the
      // /won route emitted this before, so panel edits fired no automations.)
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "lead.updated",
        entityType: "lead",
        entityId: id,
        before: before as any,
        after: (after[0] ?? before) as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.update",
        entityType: "lead",
        entityId: id,
        before: { name: before.name, stage: before.stage } as any,
        after: { ...patch, ...(stageMove ? { stage: stageMove } : {}), ...(newOwner ? { ownerId: newOwner } : {}) } as any,
        ...clientMeta,
      });
      return after[0];
    });
    if (result === "bad_owner") return NextResponse.json({ error: "selected owner is not a user in this firm" }, { status: 400 });
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
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = await loadEditableLead(tx, session, id);
      // lib/leads/lifecycle.ts: hidden everywhere, journey stopped (its step
      // kept for a restore), follow-ups and step tasks cancelled, audited.
      await softDeleteLead(tx, { tenantId: session.tenantId, actorUserId: session.userId, lead: before }, clientMeta);
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
