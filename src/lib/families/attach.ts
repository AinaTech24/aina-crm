/**
 * Put clients into a family — the one implementation behind
 * POST /api/families/[id]/members and Add client "into this family"
 * (POST /api/investors with familyId), so a client created straight into a
 * family is mapped INSIDE the create transaction: either both happen or
 * neither does (the form used to create the client, then fire a second
 * request whose failure nobody saw).
 *
 * Access: the family must be one the caller may map into
 * (lib/families/access `create`), and every client one they can open —
 * except a client created in this same transaction (`createdIds`), which the
 * caller just made.
 *
 * Head of family stays consistent:
 *   · linking someone as head (or into a family with no head) makes them the
 *     family's head; there is only ever one member with the head role;
 *   · moving a client OUT of a family they headed clears that family's head.
 * RM, address and review frequency follow the head (lib/families/head-rm,
 * lib/families/shared-details) — except the RM of a client in `keepRmOf`
 * (Add client with an RM explicitly chosen).
 */

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/jwt";
import { recordAudit } from "@/lib/audit";
import { investors, families, eventsOutbox } from "@/db/schema";
import { recomputeFamilyHealth } from "@/lib/families/health-persist";
import { assertFamilyEditable } from "@/lib/families/access";
import { loadViewableInvestor } from "@/lib/investors/access";
import { HEAD_ROLE, isHeadRole } from "@/lib/families/roles";
import { onClientFamilyMapped } from "@/lib/families/journey";
import { applyHeadRmToMembers } from "@/lib/families/head-rm";
import { applyFamilySharedDetails } from "@/lib/families/shared-details";

/** Make `investorId` the head of `familyId`: the pointer, and the only head role. */
export async function makeFamilyHead(tx: any, familyId: string, investorId: string) {
  await tx.update(families).set({ primaryInvestorId: investorId, updatedAt: new Date() } as any).where(eq(families.id, familyId));
  // Anyone else carrying the head role becomes "other" — two heads is how the
  // page used to badge one person "primary" and the map another "Head".
  await tx
    .update(investors)
    .set({ familyRole: "other", updatedAt: new Date() } as any)
    .where(and(eq(investors.familyId, familyId), ne(investors.id, investorId), inArray(investors.familyRole, ["self", "head", "primary"])));
  await tx.update(investors).set({ familyRole: HEAD_ROLE, updatedAt: new Date() } as any).where(eq(investors.id, investorId));
}

const err = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function attachClientsToFamily(
  tx: any,
  session: SessionUser,
  args: {
    familyId: string;
    investorIds: string[];
    familyRole: string | null;
    clientMeta?: Record<string, unknown>;
    /** Clients created in this transaction: no visibility check. */
    createdIds?: string[];
    /** Clients whose RM was chosen explicitly and must not be replaced by the head's. */
    keepRmOf?: string[];
  },
): Promise<{ linked: number; rmAssigned: number }> {
  const { familyId, investorIds: ids, clientMeta } = args;
  const role = args.familyRole ?? null;
  if (role && isHeadRole(role) && ids.length > 1) throw err("Only one person can be the head of the family.", 400);
  const created = new Set(args.createdIds ?? []);

  await assertFamilyEditable(tx, session, familyId, "create");
  const fam = (await tx.select().from(families).where(eq(families.id, familyId)).limit(1))[0];
  if (!fam) throw err("family not found", 404);

  const linked: string[] = [];
  const priorFamilies = new Set<string>();
  for (const investorId of ids) {
    // Only a client this person can open — and never a merged-away record.
    const inv = created.has(investorId)
      ? (await tx.select().from(investors).where(and(eq(investors.id, investorId), eq(investors.tenantId, session.tenantId))).limit(1))[0]
      : await loadViewableInvestor(tx, session, investorId);
    if (!inv) throw err("client not found", 404);
    if ((inv as any).mergedIntoId) throw err(`${inv.name} was merged into another record`, 409);
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
    await makeFamilyHead(tx, familyId, ids[0]);
    headChanged = ids[0] !== fam.primaryInvestorId;
  } else if (headless && linked.length) {
    const live = await tx
      .select({ id: investors.id })
      .from(investors)
      .where(and(eq(investors.familyId, familyId), isNull(investors.deletedAt), isNull(investors.mergedIntoId)));
    if (live.length === linked.length) {
      await makeFamilyHead(tx, familyId, linked[0]);
      headChanged = true;
    }
  }

  // The head's RM: for everyone when the head changed, else for the clients
  // just mapped — minus a client whose RM was chosen on purpose.
  const keep = new Set(args.keepRmOf ?? []);
  const rm = await applyHeadRmToMembers(tx, {
    tenantId: session.tenantId,
    familyId,
    onlyInvestorIds: headChanged ? undefined : linked.filter((id) => !keep.has(id)),
    actorUserId: session.userId,
    reason: headChanged ? "head_changed" : "mapped_to_family",
    clientMeta,
  });
  // The head's address and the family's review frequency, the same way.
  await applyFamilySharedDetails(tx, {
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
      ...(clientMeta ?? {}),
    });
  }

  await recomputeFamilyHealth(tx, familyId);
  for (const prior of priorFamilies) if (prior !== familyId) await recomputeFamilyHealth(tx, prior);
  return { linked: linked.length, rmAssigned: rm.reassigned };
}
