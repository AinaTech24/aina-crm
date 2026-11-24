import { handleApiError } from "@/lib/api/error-handler";
/**
 * PUT /api/targets — set a team member's sales + meeting targets.
 *
 * Owners / branch heads can set targets for any member of their firm; everyone
 * else may set only their own.
 *
 * `fyTargets` (Settings → Targets & quota) is the person's FY targets for the dashboard's
 * "My target tracker": one annual figure per metric in `kra_targets`, the table the tracker reads
 * (lib/targets/personal-targets.ts). A blank clears it. The older users-row fields (annual_target,
 * sip_monthly_target, new_meetings_monthly_target, renewal_meetings_monthly_target) are still
 * accepted — the mobile app and the quota ring read them — but the settings screen no longer asks for them.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { users } from "@/db/schema";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { currentFiscalYear } from "@/lib/business/sif-status";
import { cleanPersonalTargets } from "@/lib/targets/personal-targets";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  userId: z.string().uuid(),
  annualTarget: z.number().min(0).max(1e13).nullable().optional(),
  sipMonthlyTarget: z.number().min(0).max(1e11).nullable().optional(),
  newMeetingsMonthlyTarget: z.number().int().min(0).max(1000).nullable().optional(),
  renewalMeetingsMonthlyTarget: z.number().int().min(0).max(1000).nullable().optional(),
  /** The tracker's seven metrics, keyed as in PERSONAL_TARGET_METRICS; blank / null clears one. */
  fyTargets: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const b = parse.data;

    // Non-managers may only edit their own targets.
    if (!isManager(session.roles) && b.userId !== session.userId) {
      return NextResponse.json({ error: "You can only set your own targets." }, { status: 403 });
    }

    const meta = clientMetaFromHeaders(req.headers);
    const set: Record<string, unknown> = {};
    if (b.annualTarget !== undefined) set.annualTarget = b.annualTarget == null ? null : String(b.annualTarget);
    if (b.sipMonthlyTarget !== undefined) set.sipMonthlyTarget = b.sipMonthlyTarget == null ? null : String(b.sipMonthlyTarget);
    if (b.newMeetingsMonthlyTarget !== undefined) set.newMeetingsMonthlyTarget = b.newMeetingsMonthlyTarget;
    if (b.renewalMeetingsMonthlyTarget !== undefined) set.renewalMeetingsMonthlyTarget = b.renewalMeetingsMonthlyTarget;
    const fy = b.fyTargets ? cleanPersonalTargets(b.fyTargets) : null;
    if (fy && Object.keys(fy.errors).length) {
      return NextResponse.json({ error: Object.values(fy.errors)[0], errors: fy.errors }, { status: 400 });
    }
    if (Object.keys(set).length === 0 && !fy) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const updated = await withTenant(session.tenantId, async (tx) => {
      // RLS + explicit tenant predicate guarantee the target user is in-firm.
      const r = Object.keys(set).length
        ? await tx
            .update(users)
            .set(set as any)
            .where(and(eq(users.id, b.userId), eq(users.tenantId, session.tenantId)))
            .returning({ id: users.id })
        : await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, b.userId), eq(users.tenantId, session.tenantId)))
            .limit(1);
      if (r.length === 0) throw Object.assign(new Error("member not found"), { status: 404 });

      if (fy) {
        const fiscalYear = currentFiscalYear();
        for (const [metricKey, value] of Object.entries(fy.set)) {
          await tx.execute(sql`
            INSERT INTO kra_targets (tenant_id, user_id, fiscal_year, metric_key, annual_target, updated_by)
            VALUES (${session.tenantId}::uuid, ${b.userId}::uuid, ${fiscalYear}, ${metricKey}, ${value}, ${session.userId}::uuid)
            ON CONFLICT (tenant_id, user_id, fiscal_year, metric_key)
            DO UPDATE SET annual_target = excluded.annual_target, updated_by = excluded.updated_by, updated_at = now()
          `);
        }
        if (fy.clear.length) {
          await tx.execute(sql`
            DELETE FROM kra_targets
             WHERE tenant_id = ${session.tenantId}::uuid AND user_id = ${b.userId}::uuid AND fiscal_year = ${fiscalYear}
               AND metric_key IN (${sql.join(fy.clear.map((k) => sql`${k}`), sql`, `)})
          `);
        }
        set.fyTargets = { fiscalYear, set: fy.set, cleared: fy.clear };
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "target.update",
        entityType: "user",
        entityId: b.userId,
        after: set as any,
        ...meta,
      });
      return r[0];
    });

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err: any) {
    return handleApiError(err);
  }
}
