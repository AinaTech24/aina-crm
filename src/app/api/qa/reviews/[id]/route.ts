/**
 * POST /api/qa/reviews/[id]   { result: "pass" | "fail", reason?, note? }
 *
 * The checker's verdict on a QA check (lib/qa/sampling.ts): closes the check,
 * stamps the task checked and, on a Fail, gives the doer a correction task.
 * Only the check's assignee (or an owner) may record it, and they need to be
 * able to edit their tasks.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { QA_FAIL_REASONS, recordQaResult } from "@/lib/qa/sampling";

export const dynamic = "force-dynamic";

const Body = z.object({
  result: z.enum(["pass", "fail"]),
  reason: z.enum(QA_FAIL_REASONS).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const session = await requireSession();
    // Recording a verdict completes a task assigned to you.
    requireAny(session.roles, ["task.edit.all", "task.edit.assigned"], session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "Pick Pass or Fail (and a reason for a fail)." }, { status: 400 });
    const out = await withTenant(session.tenantId, (tx) =>
      recordQaResult(tx, { tenantId: session.tenantId, userId: session.userId, roles: session.roles }, id, parse.data),
    );
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
