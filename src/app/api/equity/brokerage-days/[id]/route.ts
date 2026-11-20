/**
 * PATCH  /api/equity/brokerage-days/[id] → correct a trading day
 * DELETE /api/equity/brokerage-days/[id] → remove it (the month is re-summed)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { assertEquityDesk } from "@/lib/equity/access";
import { deleteBrokerageDay, updateBrokerageDay } from "@/lib/equity/brokerage-days";

export const dynamic = "force-dynamic";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const Patch = z.object({
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  brokerage: z.number().min(0).max(1e12).optional(),
  turnover: z.number().min(0).max(1e15).nullish(),
  activeClients: z.number().int().min(0).max(1e7).nullish(),
  notes: z.string().max(500).nullish(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    await assertEquityDesk(session);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    if (parsed.data.tradeDate && parsed.data.tradeDate > today()) return NextResponse.json({ error: "A trading day cannot be in the future." }, { status: 400 });
    const ok = await withTenant(session.tenantId, async (tx) => updateBrokerageDay(tx, session.tenantId, id, parsed.data));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["reports.business", "reports.manage"], session.permissions);
    await assertEquityDesk(session);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ok = await withTenant(session.tenantId, async (tx) => deleteBrokerageDay(tx, session.tenantId, id));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    return handleApiError(err);
  }
}
