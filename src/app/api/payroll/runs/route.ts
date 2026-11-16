/**
 * POST /api/payroll/runs { month: "yyyy-mm" } — start (or open) the month's
 * pay run and work everyone out (lib/payroll/run.ts). Needs `payroll.manage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { createRun } from "@/lib/payroll/run";
import { actorOf } from "@/lib/payroll/access";

export const dynamic = "force-dynamic";

const Body = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month") });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "payroll.manage", session.permissions);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: parse.error.issues[0]?.message ?? "Pick a month" }, { status: 400 });
    const id = await withTenant(session.tenantId, (tx) => createRun(tx, actorOf(session), `${parse.data.month}-01`));
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return handleApiError(err);
  }
}
