import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/risk-profiles/bulk-assign
 *
 * Assign a PROVISIONAL risk category to many clients at once, derived from
 * their age. Body:
 *   { dryRun?: boolean, bands?: AgeBand[], refreshProvisional?: boolean, saveBands?: boolean }
 *
 *   dryRun  → the plan only (counts per category + what would be skipped, with
 *             reasons). Nothing is written. This is what the dialog previews.
 *   else    → writes the plan and returns the assigned investor ids, so the UI
 *             can offer to email exactly those clients.
 *
 * Never overwrites a profile the client actually answered — see
 * src/lib/risk-profile/bulk-age-assign.ts. Owners / branch heads only, and an
 * RM-scoped user only ever plans over their own book.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { AgeBandsSchema, resolveAgeBands } from "@/lib/risk-profile/age-bands";
import { planAgeAssignment, applyAgeAssignment } from "@/lib/risk-profile/bulk-age-assign";
import { investorScopeSql } from "@/lib/investors/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One call labels at most this many clients — keeps the request bounded. */
const MAX_PER_CALL = 500;

const Body = z.object({
  dryRun: z.boolean().optional(),
  bands: AgeBandsSchema.optional(),
  refreshProvisional: z.boolean().optional(),
  /** Persist these bands as the firm's default for next time. */
  saveBands: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "risk_profile.manage", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { dryRun, refreshProvisional } = parsed.data;
    const seesAll = can(session.roles, "investor.view.all", session.permissions);
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        // Bands: the ones supplied, else the firm's saved set, else the defaults.
        let bands = parsed.data.bands;
        if (!bands) {
          const row = (await tx.execute(sql`
            SELECT risk_age_bands FROM tenants WHERE id = ${session.tenantId}::uuid LIMIT 1
          `)).rows[0] as any;
          bands = resolveAgeBands(row?.risk_age_bands);
        }

        const plan = await planAgeAssignment(tx, {
          tenantId: session.tenantId,
          bands,
          rmId: seesAll ? undefined : session.userId,
          // Data scope: only clients in the viewer's book (branch / own book).
          scope: await investorScopeSql(tx, session, "i"),
          refreshProvisional,
        });

        if (dryRun) {
          return {
            dryRun: true as const,
            bands,
            counts: plan.counts,
            byCategory: plan.byCategory,
            capped: plan.assign.length > MAX_PER_CALL,
            limit: MAX_PER_CALL,
            // A short sample so the dialog can show real names, not just counts.
            sample: plan.assign.slice(0, 8).map((r) => ({ name: r.name, age: r.age, next: r.next })),
            noDobSample: plan.skipped.filter((s) => s.skip === "no_dob").slice(0, 8).map((r) => r.name),
          };
        }

        if (parsed.data.bands && parsed.data.saveBands) {
          await tx.execute(sql`
            UPDATE tenants SET risk_age_bands = ${JSON.stringify(parsed.data.bands)}::jsonb, updated_at = now()
             WHERE id = ${session.tenantId}::uuid
          `);
        }

        const { assigned, failed } = await applyAgeAssignment(tx, {
          tenantId: session.tenantId,
          plan,
          userId: session.userId,
          limit: MAX_PER_CALL,
        });

        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "risk_profile.bulk_assign_by_age",
          entityType: "investor",
          entityId: null,
          after: {
            bands,
            assigned: assigned.length,
            failed: failed.length,
            skipped: plan.counts,
            provisional: true,
          } as any,
          ...meta,
        });

        return {
          dryRun: false as const,
          bands,
          assigned,
          assignedCount: assigned.length,
          failed,
          counts: plan.counts,
          byCategory: plan.byCategory,
          remaining: Math.max(0, plan.assign.length - assigned.length - failed.length),
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
