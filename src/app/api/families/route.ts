import { handleApiError } from "@/lib/api/error-handler";
/**
 * Families collection.
 *
 *   GET  /api/families        — list all families with member counts
 *   POST /api/families        — create a new family group
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { families, users } from "@/db/schema";
import { familyHealthFields } from "@/lib/families/health";
import { computeFamilyNextReview } from "@/lib/families/cadence";

export const dynamic = "force-dynamic";

const Body = z.object({
  headName: z.string().min(2).max(120),
  familyName: z.string().min(2).max(120).optional(),
  primaryInvestorId: z.string().uuid().optional(),
  rmId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  familyCode: z.string().max(60).optional(),
  familyCategory: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  reviewFrequency: z.enum(["monthly", "quarterly", "half_yearly", "annual"]).optional(),
  firstMeetingDate: z.string().optional(), // YYYY-MM-DD
});

export async function GET() {
  try {
    const session = await requireSession();
    // Households carry client PII (member names, PAN via search, AUM rollup).
    // Require an investor-view capability (was open to any role) and scope
    // non-managers to families they own.
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const rows = await withTenant(session.tenantId, async (tx) => {
      const q = tx.select().from(families).orderBy(desc(families.createdAt));
      return canViewAll
        ? q
        : tx.select().from(families).where(eq(families.rmId, session.userId)).orderBy(desc(families.createdAt));
    });
    return NextResponse.json({ families: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "investor.edit.all");
    await assertActiveLicense(session.tenantId, session.roles);

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });

    const id = uuid();
    const clientMeta = clientMetaFromHeaders(req.headers);
    // Auto-derive the next household review from the cadence + first meeting.
    const nextReviewAt = computeFamilyNextReview(
      parse.data.firstMeetingDate ?? null,
      parse.data.reviewFrequency ?? null
    );
    const outcome = await withTenant(session.tenantId, async (tx) => {
      // An explicit RM must be a user in THIS firm — otherwise the household
      // would be owned by an out-of-tenant uuid.
      if (parse.data.rmId) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, parse.data.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return "bad_rm" as const;
      }
      await tx.insert(families).values({
        id,
        tenantId: session.tenantId,
        branchId: session.branchId,
        headName: parse.data.headName,
        familyName: parse.data.familyName ?? parse.data.headName,
        primaryInvestorId: parse.data.primaryInvestorId ?? null,
        rmId: parse.data.rmId ?? session.userId,
        notes: parse.data.notes,
        familyCode: parse.data.familyCode ?? null,
        familyCategory: parse.data.familyCategory ?? null,
        reviewFrequency: parse.data.reviewFrequency ?? null,
        firstMeetingDate: parse.data.firstMeetingDate ?? null,
        nextReviewAt: nextReviewAt ?? null,
        // Initial health (no members yet ⇒ reflects the setup backlog).
        ...familyHealthFields(
          {
            primaryInvestorId: parse.data.primaryInvestorId ?? null,
            rmId: parse.data.rmId ?? session.userId,
            lastReviewAt: null,
            nextReviewAt: nextReviewAt ?? null,
          },
          []
        ),
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "family.create",
        entityType: "family",
        entityId: id,
        after: {
          headName: parse.data.headName,
          familyName: parse.data.familyName,
        },
        ...clientMeta,
      });
      return "ok" as const;
    });
    if (outcome === "bad_rm") return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
