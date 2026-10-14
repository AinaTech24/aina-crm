import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single-family endpoints.
 *
 *   GET    /api/families/[id]   — fetch one family + member count
 *   PATCH  /api/families/[id]   — partial update
 *   DELETE /api/families/[id]   — hard delete only if no live members linked, otherwise 409
 *
 * Every verb checks the family is visible to the caller (lib/families/access);
 * they used to check only a capability, so PATCH could reassign the RM of any
 * family in the firm.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { families, investors, users } from "@/db/schema";
import { familyHealthFields } from "@/lib/families/health";
import { nextFamilyReview } from "@/lib/families/cadence";
import { loadViewableFamily, assertFamilyEditable } from "@/lib/families/access";
import { HEAD_ROLE } from "@/lib/families/roles";
import { applyFamilySharedDetails } from "@/lib/families/shared-details";

export const dynamic = "force-dynamic";

const Patch = z.object({
  headName: z.string().min(2).max(120).optional(),
  familyName: z.string().min(2).max(120).optional(),
  primaryInvestorId: z.string().uuid().nullable().optional(),
  rmId: z.string().uuid().nullable().optional(),
  // null or "" clears the note (an empty box used to send nothing, so the old note stayed)
  notes: z.string().max(2000).nullable().optional(),
  lastReviewAt: z.string().optional(),
  nextReviewAt: z.string().optional(),
  familyCode: z.string().max(60).nullable().optional(),
  familyCategory: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).nullable().optional(),
  reviewFrequency: z.enum(["monthly", "quarterly", "half_yearly", "annual"]).nullable().optional(),
  firstMeetingDate: z.string().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) => {
      if (!(await loadViewableFamily(tx, session, id))) return null;
      return (await tx.select().from(families).where(and(eq(families.id, id), eq(families.tenantId, session.tenantId))).limit(1))[0] ?? null;
    });
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
    // Same rule as create — the RM who services the household may edit it.
    // (DELETE below stays at .edit.all: removing a household touches every
    // client linked to it.)
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      await assertFamilyEditable(tx, session, id);
      const before = (await tx.select().from(families).where(and(eq(families.id, id), eq(families.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      // The head must be a live member of THIS family — the API accepted any
      // uuid, and a head who isn't a member made the page and the health card
      // disagree about who leads the family.
      if (parse.data.primaryInvestorId) {
        const [m] = await tx
          .select({ id: investors.id })
          .from(investors)
          .where(and(
            eq(investors.id, parse.data.primaryInvestorId),
            eq(investors.familyId, id),
            sql`${investors.deletedAt} IS NULL AND ${investors.mergedIntoId} IS NULL`,
          ))
          .limit(1);
        if (!m) return "bad_head" as const;
      }

      // A reassigned RM must be a user in this firm (a stray uuid would orphan
      // the household under someone outside the tenant).
      if (parse.data.rmId && parse.data.rmId !== before.rmId) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, parse.data.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return "bad_rm" as const;
      }

      // Coerce ISO date strings → Date objects. Drizzle timestamp columns call
      // value.toISOString() on assignment, so a raw string throws ("toISOString
      // is not a function") → the 500 the user saw when saving with a review
      // date present. Unparseable → null.
      const patch: any = { ...parse.data };
      if (patch.notes === "") patch.notes = null;
      for (const k of ["lastReviewAt", "nextReviewAt", "firstMeetingDate"] as const) {
        if (typeof patch[k] === "string") {
          const d = new Date(patch[k]);
          patch[k] = isNaN(d.getTime()) ? null : d;
        }
      }

      // Family-level fields (primary, RM, review dates) feed the health score —
      // recompute from the post-patch family + its current members.
      const merged: any = { ...before, ...patch };

      // If the cadence inputs changed (and the caller didn't set nextReviewAt
      // explicitly), re-derive nextReviewAt: from the first meeting's schedule,
      // else one cadence after the last review, else after creation. With no
      // frequency the current date is kept rather than blanked.
      // A new "last review" date moves the next one too — saving today's review
      // used to leave the old next date in the past, so the family stayed
      // "review due".
      const lastReviewMoved =
        parse.data.lastReviewAt !== undefined &&
        String(parse.data.lastReviewAt ?? "") !== (before.lastReviewAt ? new Date(before.lastReviewAt).toISOString() : "");
      const cadenceTouched =
        parse.data.reviewFrequency !== undefined || parse.data.firstMeetingDate !== undefined || lastReviewMoved;
      let recomputedNextReview: Date | undefined;
      if (cadenceTouched && parse.data.nextReviewAt === undefined) {
        const next = nextFamilyReview({
          frequency: merged.reviewFrequency,
          firstMeeting: merged.firstMeetingDate,
          lastReview: merged.lastReviewAt,
          since: before.createdAt,
        });
        if (next) {
          recomputedNextReview = next;
          merged.nextReviewAt = next;
        } else if (lastReviewMoved && merged.lastReviewAt && merged.nextReviewAt && new Date(merged.nextReviewAt) <= new Date(merged.lastReviewAt)) {
          // No cadence to derive from, and the old next date is already behind
          // the review just recorded — drop it rather than show "overdue".
          patch.nextReviewAt = null;
          merged.nextReviewAt = null;
        }
      }

      // A new head carries the head role, and only they do.
      if (parse.data.primaryInvestorId && parse.data.primaryInvestorId !== before.primaryInvestorId) {
        await tx.execute(sql`
          UPDATE investors SET family_role = 'other', updated_at = now()
           WHERE family_id = ${id}::uuid AND id <> ${parse.data.primaryInvestorId}::uuid
             AND family_role IN ('self', 'head', 'primary')
        `);
        await tx.update(investors).set({ familyRole: HEAD_ROLE, updatedAt: new Date() } as any).where(eq(investors.id, parse.data.primaryInvestorId));
      }

      const members = await tx.select().from(investors).where(eq(investors.familyId, id));
      const health = familyHealthFields(merged as any, members as any);

      const after = await tx
        .update(families)
        .set({
          ...patch,
          ...(recomputedNextReview !== undefined ? { nextReviewAt: recomputedNextReview } : {}),
          updatedAt: new Date(),
          ...health,
        } as any)
        .where(and(eq(families.id, id), eq(families.tenantId, session.tenantId)))
        .returning();
      // A new review frequency or a new head: members follow (the family's
      // cadence for everyone, the head's address for the members).
      const headMoved = !!parse.data.primaryInvestorId && parse.data.primaryInvestorId !== before.primaryInvestorId;
      const cadenceMoved = parse.data.reviewFrequency !== undefined && parse.data.reviewFrequency !== before.reviewFrequency;
      if (headMoved || cadenceMoved) {
        await applyFamilySharedDetails(tx, {
          tenantId: session.tenantId,
          familyId: id,
          actorUserId: session.userId,
          reason: headMoved ? "head_changed" : "family_review_changed",
          clientMeta,
        });
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.update",
        entityType: "family",
        entityId: id,
        before: Object.fromEntries(Object.keys(parse.data).map((k) => [k, (before as any)[k] ?? null])) as any,
        after: parse.data as any,
        ...clientMeta,
      });
      return after[0];
    });
    if (result === "bad_rm") return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
    if (result === "bad_head") return NextResponse.json({ error: "The head of the family must be one of its members." }, { status: 400 });
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
    requireAny(session.roles, ["family.delete", "investor.edit.all"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const result = await withTenant(session.tenantId, async (tx) => {
      if (!(await loadViewableFamily(tx, session, id))) return null;
      // Refuse while a live member is linked. Deleted or merged-away records
      // don't count — the page shows them as no one, and a family whose only
      // "members" were deleted could never be removed.
      const count = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM investors
         WHERE family_id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
           AND deleted_at IS NULL AND merged_into_id IS NULL
      `);
      const c = Number((count.rows[0] as any)?.c ?? 0);
      if (c > 0) {
        throw Object.assign(new Error(`Remove the ${c} member${c === 1 ? "" : "s"} first — a family with members can't be deleted.`), { status: 409 });
      }
      // Let go of the dead links first so the family row can go.
      await tx.execute(sql`
        UPDATE investors SET family_id = NULL, family_role = NULL
         WHERE family_id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
      `);
      const before = (await tx.select().from(families).where(and(eq(families.id, id), eq(families.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;

      await tx.delete(families).where(and(eq(families.id, id), eq(families.tenantId, session.tenantId)));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.delete",
        entityType: "family",
        entityId: id,
        before: { headName: before.headName, familyName: before.familyName } as any,
        ...clientMeta,
      });
      return { ok: true };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
