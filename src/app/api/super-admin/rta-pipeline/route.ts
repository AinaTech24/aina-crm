/**
 * Aina Admin → RTA pipeline controls (Phase 3G). Platform operators only.
 *
 *   GET  ?tenantId=…   a firm's current activation, kill-switch state and history
 *   POST { action: "activate" | "revoke" | "halt" | "release", … }
 *
 * The signed-in operator is the APPROVER. Turning posting on and releasing a
 * kill switch also need a REQUESTER — a different platform operator, named by
 * id and checked here. Nothing in this route switches a firm on by itself, and
 * every change is in the control history and the firm's audit log.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { withSystem } from "@/db/client";
import { activateTenant, controlState, revokeActivation, setPostingHalt, ControlError } from "@/lib/rta/posting/controls";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("activate"), tenantId: z.string().uuid(), mode: z.enum(["off", "shadow", "validate_first"]),
    postingEnabled: z.boolean(), reason: z.string().trim().min(10).max(1000), approvalRef: z.string().trim().max(200).optional(),
    requestedBy: z.string().uuid().optional(), expiresAt: z.string().datetime().optional(),
  }),
  z.object({ action: z.literal("revoke"), tenantId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal("halt"), scope: z.union([z.literal("global"), z.string().uuid()]), reason: z.string().trim().min(10).max(1000) }),
  z.object({ action: z.literal("release"), scope: z.union([z.literal("global"), z.string().uuid()]), reason: z.string().trim().min(10).max(1000), requestedBy: z.string().uuid() }),
]);

/** A requester must be a real, active platform operator — not a tenant user, not the approver. */
async function assertOperator(userId: string, approver: string) {
  if (userId === approver) throw new ControlError("the requester and the approver must be different operators");
  const r = (await withSystem(async (tx) => (await tx.execute(sql`
    SELECT 1 FROM users WHERE id = ${userId}::uuid AND status = 'active' AND roles && ARRAY['platform_admin', 'platform_support']::text[]`)).rows)) as unknown[];
  if (!r.length) throw new ControlError("the requester is not an active platform operator");
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const tenantId = req.nextUrl.searchParams.get("tenantId") ?? "";
    if (!z.string().uuid().safeParse(tenantId).success) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    return NextResponse.json(await controlState(tenantId));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    const b = parsed.data;
    switch (b.action) {
      case "activate":
        if (b.postingEnabled) {
          if (!b.requestedBy) throw new ControlError("enabling posting needs a requester (a different operator)");
          await assertOperator(b.requestedBy, session.userId);
        }
        return NextResponse.json({ activation: await activateTenant({ ...b, approvedBy: session.userId }) });
      case "revoke":
        return NextResponse.json({ activation: await revokeActivation({ tenantId: b.tenantId, revokedBy: session.userId, reason: b.reason }) });
      case "halt":
        await setPostingHalt({ scope: b.scope, halted: true, reason: b.reason, changedBy: session.userId });
        return NextResponse.json({ ok: true });
      case "release":
        await assertOperator(b.requestedBy, session.userId);
        await setPostingHalt({ scope: b.scope, halted: false, reason: b.reason, changedBy: b.requestedBy, approvedBy: session.userId });
        return NextResponse.json({ ok: true });
    }
  } catch (err: any) {
    if (err instanceof ControlError) return NextResponse.json({ error: err.message }, { status: err.status });
    return handleApiError(err);
  }
}
