/**
 * GET  /api/equity/brokerage-days?month=YYYY-MM → that month's trading days + recent month totals
 * POST /api/equity/brokerage-days → add a day { tradeDate, brokerage, turnover?, activeClients?, notes? }
 * Equity desk (We Care, 2026-11-20) — lib/equity/brokerage-days.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";
import { assertEquityDesk } from "@/lib/equity/access";
import { brokerageMonths, createBrokerageDay, listBrokerageDays } from "@/lib/equity/brokerage-days";

export const dynamic = "force-dynamic";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertEquityDesk(session);
    const m = req.nextUrl.searchParams.get("month");
    const month = m && /^\d{4}-\d{2}$/.test(m) ? m : today().slice(0, 7);
    const data = await withTenant(session.tenantId, async (tx) => ({
      month,
      days: await listBrokerageDays(tx, session.tenantId, month),
      months: await brokerageMonths(tx, session.tenantId, 13),
    }));
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  brokerage: z.number().min(0).max(1e12),
  turnover: z.number().min(0).max(1e15).nullish(),
  activeClients: z.number().int().min(0).max(1e7).nullish(),
  notes: z.string().max(500).nullish(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await assertEquityDesk(session);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    if (parsed.data.tradeDate > today()) return NextResponse.json({ error: "A trading day cannot be in the future." }, { status: 400 });
    const row = await withTenant(session.tenantId, async (tx) => createBrokerageDay(tx, session.tenantId, session.userId, parsed.data));
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
