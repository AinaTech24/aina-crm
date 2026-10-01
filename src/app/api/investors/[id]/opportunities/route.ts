/**
 * An existing client's opportunities — another product they want.
 *
 *   GET  /api/investors/[id]/opportunities   open first, then recently closed
 *   POST /api/investors/[id]/opportunities   start one
 *        { product, expectedValue?, investmentMode?, source?, notes?, ownerId?, coOwnerId?, sourceLeadId? }
 *        201 { opportunity, created: true } — or 200 { created: false } with
 *        the open one when the client already has it for this product.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { loadViewableInvestor } from "@/lib/investors/access";
import { canWorkOpportunities, requireWorkOpportunities } from "@/lib/opportunities/access";
import { createOpportunity, listOpportunities } from "@/lib/opportunities/journey";
import { isOpportunityProduct, OPPORTUNITY_SOURCES } from "@/lib/opportunities/products";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid();

const Body = z.object({
  product: z.string().refine(isOpportunityProduct, "Unknown product"),
  expectedValue: z.coerce.number().positive().max(1e12).nullish(),
  investmentMode: z.enum(["sip", "lumpsum"]).nullish(),
  source: z.enum(OPPORTUNITY_SOURCES).optional(),
  notes: z.string().max(2000).nullish(),
  ownerId: uuid.nullish(),
  coOwnerId: uuid.nullish(),
  sourceLeadId: uuid.nullish(),
});

const ctx = (session: Awaited<ReturnType<typeof requireSession>>) => ({
  userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles,
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const canWork = canWorkOpportunities(session);
    const { items, staff } = await withTenant(session.tenantId, async (tx) => {
      if (!(await loadViewableInvestor(tx, session, id))) throw Object.assign(new Error("Not found"), { status: 404 });
      const items = await listOpportunities(tx, session.tenantId, { investorId: id });
      // Who can own or co-own one — only for someone who can start one.
      const staff = canWork
        ? ((await tx.execute(sql`
            SELECT id, name, roles FROM users
             WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active'
               AND roles && ARRAY['rm', 'branch_head', 'insurance_team', 'back_office', 'ops', 'owner']::text[]
             ORDER BY name LIMIT 300`)).rows as Array<{ id: string; name: string; roles: string[] }>)
            .map((u) => ({ id: u.id, name: u.name.replace(/\s*\([^)]*\)\s*$/, ""), insurance: (u.roles ?? []).includes("insurance_team") }))
        : [];
      return { items, staff };
    }, ctx(session));
    return NextResponse.json({ items, staff, canWork });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireWorkOpportunities(session);
    const { id } = await params;
    if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const result = await withTenant(session.tenantId, async (tx) => {
      if (!(await loadViewableInvestor(tx, session, id))) throw Object.assign(new Error("Not found"), { status: 404 });
      for (const u of [parsed.data.ownerId, parsed.data.coOwnerId]) {
        if (!u) continue;
        const ok = (await tx.execute(
          sql`SELECT 1 FROM users WHERE id = ${u}::uuid AND tenant_id = ${session.tenantId}::uuid AND status = 'active'`,
        )).rows.length;
        if (!ok) throw Object.assign(new Error("The chosen owner is not an active user in this firm."), { status: 400 });
      }
      const r = await createOpportunity(tx, { tenantId: session.tenantId, userId: session.userId }, {
        investorId: id, ...parsed.data,
      });
      const [view] = await listOpportunities(tx, session.tenantId, { ids: [r.opportunity.id] });
      return { opportunity: view, created: r.created };
    }, ctx(session));
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
