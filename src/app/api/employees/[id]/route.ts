import { handleApiError } from "@/lib/api/error-handler";
/**
 * PATCH /api/employees/[id]
 *   Update the HR / Module-19 fields on a team member.
 *
 * DELETE /api/employees/[id]
 *   Soft-offboard (status='offboarded', offboarded_at=now()).
 *
 * GET /api/employees/[id]
 *   Read one employee + key counts.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().nullable(),
  roles: z.array(z.string()).min(1).optional(),
  department: z
    .enum([
      "sales",
      "operations",
      "back_office",
      "compliance",
      "marketing",
      "advisory",
      "support",
      "leadership",
      "other",
    ])
    .nullable()
    .optional(),
  joiningDate: z.string().nullable().optional(), // ISO date "YYYY-MM-DD"
  reportingManagerId: z.string().uuid().nullable().optional(),
  annualTarget: z.number().nonnegative().nullable().optional(),
  sipMonthlyTarget: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  euin: z.string().max(40).nullable().optional(),
  nismCertificateNo: z.string().max(80).nullable().optional(),
  nismExpiryAt: z.string().nullable().optional(),
  status: z.enum(["invited", "active", "suspended", "offboarding", "offboarded"]).optional(),
  branchId: z.string().uuid().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const data = await withTenant(session.tenantId, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, id));
    if (!u) return null;

    // Counts used in detail view
    const stats = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS active_clients,
        (SELECT COALESCE(SUM(aum::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_aum,
        (SELECT COALESCE(SUM(active_sip_amount::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_sip,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress')) AS open_tasks,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress') AND due_at < now()) AS overdue_tasks,
        (SELECT COUNT(*)::int FROM review_meetings WHERE rm_id = ${id}::uuid AND status IN ('scheduled','confirmed') AND meeting_date >= now()) AS upcoming_meetings
    `);
    return { user: u, stats: stats.rows[0] };
  });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users");
    const { id } = await params;

    const parse = PatchBody.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const updated = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.id, id));
      if (!existing) return null;

      const patch: any = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = body.name;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.roles !== undefined) patch.roles = body.roles;
      if (body.department !== undefined) patch.department = body.department;
      if (body.joiningDate !== undefined) patch.joiningDate = body.joiningDate;
      if (body.reportingManagerId !== undefined) patch.reportingManagerId = body.reportingManagerId;
      if (body.annualTarget !== undefined) patch.annualTarget = body.annualTarget?.toString() ?? null;
      if (body.sipMonthlyTarget !== undefined) patch.sipMonthlyTarget = body.sipMonthlyTarget?.toString() ?? null;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.euin !== undefined) patch.euin = body.euin;
      if (body.nismCertificateNo !== undefined) patch.nismCertificateNo = body.nismCertificateNo;
      if (body.nismExpiryAt !== undefined) patch.nismExpiryAt = body.nismExpiryAt;
      if (body.branchId !== undefined) patch.branchId = body.branchId;
      if (body.status !== undefined) {
        patch.status = body.status;
        if (body.status === "offboarded") patch.offboardedAt = new Date();
      }

      const [next] = await tx.update(users).set(patch).where(eq(users.id, id)).returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.update",
        entityType: "user",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ user: updated });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "settings.users");
    const { id } = await params;
    const meta = clientMetaFromHeaders(req.headers);

    const updated = await withTenant(session.tenantId, async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.id, id));
      if (!existing) return null;
      const [next] = await tx
        .update(users)
        .set({ status: "offboarded", offboardedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "employee.offboard",
        entityType: "user",
        entityId: id,
        before: existing,
        after: next,
        ...meta,
      });
      return next;
    });

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ user: updated });
  } catch (err: any) {
    return handleApiError(err);
  }
}
