import { handleApiError } from "@/lib/api/error-handler";
/**
 * Family membership management.
 *
 *   POST   /api/families/[id]/members  Body: { investorId, familyRole? }
 *                                         or { investorIds: [...], familyRole? } — attach (several at once)
 *   PATCH  /api/families/[id]/members  Body: { investorId, familyRole }         — change a member's relationship
 *   DELETE /api/families/[id]/members?investorId=…                              — detach
 *
 * Access (lib/families/access): the family must be visible to the caller and
 * the caller must hold an edit capability; every client being linked must be
 * one the caller can open (lib/investors/access). Both used to be unchecked —
 * any editor could move any client in the firm into any household.
 *
 * Head of family stays consistent:
 *   · linking someone as head (or into a family with no head) makes them the
 *     family's head; there is only ever one member with the head role;
 *   · moving a client OUT of a family they headed clears that family's head;
 *   · detaching the head clears the head.
 * On attach an outbox event lets downstream workflows react.
 *
 * RM follows the head (lib/families/head-rm): a client mapped into the family
 * gets the head's RM, and making someone head gives every member the new
 * head's RM — by default; a member's RM can still be changed on their record.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors, families, eventsOutbox } from "@/db/schema";
import { recomputeFamilyHealth } from "@/lib/families/health-persist";
import { assertFamilyEditable } from "@/lib/families/access";
import { loadViewableInvestor } from "@/lib/investors/access";
import { HEAD_ROLE, isHeadRole } from "@/lib/families/roles";
import { onClientFamilyMapped } from "@/lib/families/journey";
import { applyHeadRmToMembers } from "@/lib/families/head-rm";

export const dynamic = "force-dynamic";

const Role = z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, "invalid relationship");

const AddBody = z
  .object({
    investorId: z.string().uuid().optional(),
    investorIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    familyRole: Role.optional(),
  })
  .refine((b) => b.investorId || b.investorIds?.length, { message: "investorId or investorIds required" });

const PatchBody = z.object({ investorId: z.string().uuid(), familyRole: Role });

/** Make `investorId` the head of `familyId`: the pointer, and the only head role. */
async function makeHead(tx: any, familyId: string, investorId: string) {
  await tx.update(families).set({ primaryInvestorId: investorId, updatedAt: new Date() } as any).where(eq(families.id, familyId));
  // Anyone else carrying the head role becomes "other" — two heads is how the
  // page used to badge one person "primary" and the map another "Head".
  await tx
    .update(investors)
    .set({ familyRole: "other", updatedAt: new Date() } as any)
    .where(and(eq(investors.familyId, familyId), ne(investors.id, investorId), inArray(investors.familyRole, ["self", "head", "primary"])));
  await tx.update(investors).set({ familyRole: HEAD_ROLE, updatedAt: new Date() } as any).where(eq(investors.id, investorId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: familyId } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = AddBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const ids = Array.from(new Set([...(parse.data.investorIds ?? []), ...(parse.data.investorId ? [parse.data.investorId] : [])]));
    const role = parse.data.familyRole ?? null;
    if (role && isHeadRole(role) && ids.length > 1) {
      return NextResponse.json({ error: "Only one person can be the head of the family." }, { status: 400 });
    }

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      await assertFamilyEditable(tx, session, familyId);
      const fam = (await tx.select().from(families).where(eq(families.id, familyId)).limit(1))[0];
      if (!fam) throw Object.assign(new Error("family not found"), { status: 404 });

      const linked: string[] = [];
      const priorFamilies = new Set<string>();
      for (const investorId of ids) {
        // Only a client this person can open — and never a merged-away record.
        const inv = await loadViewableInvestor(tx, session, investorId);
        if (!inv) throw Object.assign(new Error("client not found"), { status: 404 });
        if ((inv as any).mergedIntoId) throw Object.assign(new Error(`${inv.name} was merged into another record`), { status: 409 });
        // Mapped to this family — newly or already: either way the client's
        // onboarding "Map Family" step is done (lib/families/journey).
        await onClientFamilyMapped(tx, session.tenantId, investorId);
        if (inv.familyId === familyId) continue;

        // Leaving a family they headed: that family loses its head, rather than
        // keep pointing at someone who is no longer in it.
        if (inv.familyId) {
          priorFamilies.add(inv.familyId);
          await tx
            .update(families)
            .set({ primaryInvestorId: null, updatedAt: new Date() } as any)
            .where(and(eq(families.id, inv.familyId), eq(families.primaryInvestorId, investorId)));
        }

        await tx
          .update(investors)
          .set({ familyId, familyRole: role && isHeadRole(role) ? HEAD_ROLE : role, updatedAt: new Date() } as any)
          .where(eq(investors.id, investorId));

        await tx.insert(eventsOutbox).values({
          tenantId: session.tenantId,
          kind: "investor.family_linked",
          entityType: "investor",
          entityId: investorId,
          before: { familyId: inv.familyId } as any,
          after: { familyId, familyRole: role } as any,
          meta: { userId: session.userId } as any,
        } as any);
        linked.push(investorId);
      }

      // Head: an explicit head link, or the first member of a family without one.
      const headless = !fam.primaryInvestorId;
      let headChanged = false;
      if (ids.length === 1 && role && isHeadRole(role)) {
        await makeHead(tx, familyId, ids[0]);
        headChanged = ids[0] !== fam.primaryInvestorId;
      } else if (headless && linked.length) {
        const live = await tx
          .select({ id: investors.id })
          .from(investors)
          .where(and(eq(investors.familyId, familyId), isNull(investors.deletedAt), isNull(investors.mergedIntoId)));
        if (live.length === linked.length) {
          await makeHead(tx, familyId, linked[0]);
          headChanged = true;
        }
      }

      // The head's RM: for everyone when the head changed, else for the
      // clients just mapped.
      const rm = await applyHeadRmToMembers(tx, {
        tenantId: session.tenantId,
        familyId,
        onlyInvestorIds: headChanged ? undefined : linked,
        actorUserId: session.userId,
        reason: headChanged ? "head_changed" : "mapped_to_family",
        clientMeta,
      });

      if (linked.length) {
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "family.member.add",
          entityType: "family",
          entityId: familyId,
          after: { investorIds: linked, familyRole: role },
          ...clientMeta,
        });
      }

      await recomputeFamilyHealth(tx, familyId);
      for (const prior of priorFamilies) if (prior !== familyId) await recomputeFamilyHealth(tx, prior);
      return { linked: linked.length, rmAssigned: rm.reassigned };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: familyId } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { investorId, familyRole } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const out = await withTenant(session.tenantId, async (tx) => {
      await assertFamilyEditable(tx, session, familyId);
      const fam = (await tx.select().from(families).where(eq(families.id, familyId)).limit(1))[0];
      const [m] = await tx
        .select({ id: investors.id, familyRole: investors.familyRole })
        .from(investors)
        .where(and(eq(investors.id, investorId), eq(investors.familyId, familyId)))
        .limit(1);
      if (!fam || !m) return null;

      let rmAssigned = 0;
      if (isHeadRole(familyRole)) {
        await makeHead(tx, familyId, investorId);
        // A new head: every member takes the new head's RM (by default).
        if (investorId !== fam.primaryInvestorId) {
          const rm = await applyHeadRmToMembers(tx, {
            tenantId: session.tenantId,
            familyId,
            actorUserId: session.userId,
            reason: "head_changed",
            clientMeta,
          });
          rmAssigned = rm.reassigned;
        }
      } else {
        await tx.update(investors).set({ familyRole, updatedAt: new Date() } as any).where(eq(investors.id, investorId));
        // Demoting the head leaves the family without one, honestly.
        if (fam.primaryInvestorId === investorId) {
          await tx.update(families).set({ primaryInvestorId: null, updatedAt: new Date() } as any).where(eq(families.id, familyId));
        }
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.member.role",
        entityType: "family",
        entityId: familyId,
        before: { investorId, familyRole: m.familyRole },
        after: { investorId, familyRole },
        ...clientMeta,
      });
      await recomputeFamilyHealth(tx, familyId);
      return { ok: true, rmAssigned };
    });
    if (!out) return NextResponse.json({ error: "member not found" }, { status: 404 });
    return NextResponse.json(out);
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
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const removed = await withTenant(session.tenantId, async (tx) => {
      await assertFamilyEditable(tx, session, familyId);
      const rows = await tx
        .update(investors)
        .set({ familyId: null, familyRole: null, updatedAt: new Date() } as any)
        .where(and(eq(investors.id, investorId), eq(investors.familyId, familyId)))
        .returning({ id: investors.id });
      // Nothing to remove — say so instead of logging an unlink that never happened.
      if (!rows.length) return false;

      // The head left: the family has no head until someone is chosen.
      await tx.execute(sql`
        UPDATE families SET primary_investor_id = NULL, updated_at = now()
         WHERE id = ${familyId}::uuid AND primary_investor_id = ${investorId}::uuid
      `);

      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "investor.family_unlinked",
        entityType: "investor",
        entityId: investorId,
        before: { familyId } as any,
        after: { familyId: null } as any,
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.member.remove",
        entityType: "family",
        entityId: familyId,
        before: { investorId, familyId },
        ...clientMeta,
      });

      await recomputeFamilyHealth(tx, familyId);
      return true;
    });
    if (!removed) return NextResponse.json({ error: "That client is not in this family." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
