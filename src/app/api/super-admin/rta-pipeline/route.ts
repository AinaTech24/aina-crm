/**
 * Aina Admin → RTA pipeline controls. Platform operators only.
 *
 *   GET  ?tenantId=…              a firm's current activation, kill-switch state and history
 *   GET  ?view=requests[&status=] two-person control requests (pending first)
 *   POST { action: "request", control: { action: "activate" | "release" | "reverse" | "undo", … } }
 *   POST { action: "approve", requestId, payloadHash, note? }
 *   POST { action: "reject", requestId, note }
 *   POST { action: "pause" | "revoke", tenantId, reason }       one operator (a stop)
 *   POST { action: "halt", scope, reason }                      one operator (a stop)
 *   POST { action: "cancel_import", tenantId, importId, reason } one operator (a stop)
 *
 * Every START is a two-person control request (lib/rta/posting/approvals.ts,
 * migration 0243): the REQUESTER is the signed-in session that files it, and
 * the APPROVER is a different signed-in session that approves exactly what it
 * reviewed (the payload hash). No operator id is ever taken from the request
 * body — a body naming one is refused. The old one-call "activate" / "release"
 * (which trusted a requester id in the body) answer 410.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { activateTenant, controlState, revokeActivation, setPostingHalt, ControlError } from "@/lib/rta/posting/controls";
import { approveControlAction, listControlRequests, rejectControlAction, requestControlAction, type ControlRequestInput } from "@/lib/rta/posting/approvals";
import { cancelParkedImport } from "@/lib/rta/posting/cancel-import";
import { reprocessHeldTransactions } from "@/lib/rta/posting/reprocess";

export const dynamic = "force-dynamic";

const scope = z.union([z.literal("global"), z.literal("emergency"), z.string().uuid()]);
const common = { changeRef: z.string().trim().min(3).max(200), reason: z.string().trim().min(10).max(1000), ttlMinutes: z.number().int().min(1).max(1440).optional() };
const Control = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("activate"), tenantId: z.string().uuid(), mode: z.enum(["off", "shadow", "validate_first"]), postingEnabled: z.boolean(),
    registrars: z.array(z.enum(["cams", "kfintech"])).min(1).max(2).optional(), reportCodes: z.array(z.string().trim().min(2).max(10)).min(1).max(10).optional(),
    expiresAt: z.string().datetime().optional(), ...common,
  }).strict(),
  z.object({ action: z.literal("release"), scope, ...common }).strict(),
  z.object({ action: z.literal("reverse"), tenantId: z.string().uuid(), batchId: z.string().uuid(), ...common }).strict(),
  z.object({ action: z.literal("undo"), tenantId: z.string().uuid(), reversalId: z.string().uuid(), ...common }).strict(),
]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), control: Control }).strict(),
  z.object({ action: z.literal("approve"), requestId: z.string().uuid(), payloadHash: z.string().regex(/^[0-9a-f]{64}$/), note: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal("reject"), requestId: z.string().uuid(), note: z.string().trim().min(5).max(1000) }).strict(),
  z.object({ action: z.literal("pause"), tenantId: z.string().uuid(), reason: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal("revoke"), tenantId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }).strict(),
  z.object({ action: z.literal("halt"), scope, reason: z.string().trim().min(10).max(1000) }).strict(),
  z.object({ action: z.literal("cancel_import"), tenantId: z.string().uuid(), importId: z.string().uuid(), reason: z.string().trim().min(10).max(1000) }).strict(),
]);

/** The signed-in operator, from the verified server session only. */
const operatorOf = (s: { userId: string; sid?: string }) => ({ userId: s.userId, sid: s.sid ?? null });

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    if (req.nextUrl.searchParams.get("view") === "requests") {
      const status = req.nextUrl.searchParams.get("status") ?? undefined;
      return NextResponse.json({ requests: await listControlRequests(operatorOf(session), { status: status || undefined }) });
    }
    const tenantId = req.nextUrl.searchParams.get("tenantId") ?? "";
    if (!z.string().uuid().safeParse(tenantId).success) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    return NextResponse.json(await controlState(tenantId));
  } catch (err: any) {
    if (err instanceof ControlError) return NextResponse.json({ error: err.message }, { status: err.status });
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const raw = await req.json().catch(() => null);
    if (raw && typeof raw === "object" && (raw.action === "activate" || raw.action === "release")) {
      return NextResponse.json({ error: "this one-call start is withdrawn: file a two-person request ({ action: \"request\", control: { … } }) from your session, then a DIFFERENT signed-in operator approves it ({ action: \"approve\", requestId, payloadHash })" }, { status: 410 });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid input — operator identities are taken from the signed-in session, never from the request", issues: parsed.error.issues }, { status: 400 });
    const b = parsed.data;
    const me = operatorOf(session);
    switch (b.action) {
      case "request":
        return NextResponse.json({ request: await requestControlAction(me, b.control as ControlRequestInput) }, { status: 201 });
      case "approve": {
        const request = await approveControlAction(me, { requestId: b.requestId, payloadHash: b.payloadHash, note: b.note });
        // A scheme approval can release transactions held on the code in each firm.
        // Re-evaluate them now; a firm whose posting is paused keeps them for resume.
        let postingPendingFirms = 0;
        const released = request.action === "approve_scheme_mapping" ? (request.result as { key?: { rta: string; amcCode: string; schemeCode: string }; tenantIds?: string[] } | null) : null;
        if (released?.key) {
          for (const t of released.tenantIds ?? []) {
            try { await reprocessHeldTransactions(t, { schemeKeys: [released.key], userId: session.userId }); }
            catch (e: any) { if (e?.name !== "PostingGateError") throw e; postingPendingFirms++; }
          }
        }
        return NextResponse.json({ request, postingPendingFirms });
      }
      case "reject":
        return NextResponse.json({ request: await rejectControlAction(me, { requestId: b.requestId, note: b.note }) });
      case "pause":
        return NextResponse.json({ activation: await activateTenant({ tenantId: b.tenantId, mode: "paused", postingEnabled: false, reason: b.reason, approvedBy: session.userId }) });
      case "revoke":
        return NextResponse.json({ activation: await revokeActivation({ tenantId: b.tenantId, revokedBy: session.userId, reason: b.reason }) });
      case "halt":
        await setPostingHalt({ scope: b.scope, halted: true, reason: b.reason, changedBy: session.userId, actorSource: "session" });
        return NextResponse.json({ ok: true });
      case "cancel_import":
        return NextResponse.json({ import: await cancelParkedImport(me, { tenantId: b.tenantId, importId: b.importId, reason: b.reason }) });
    }
  } catch (err: any) {
    // Control, recovery and scheme-mapping refusals carry their own 4xx status and a message for the operator.
    if (err instanceof Error && typeof (err as any).status === "number" && (err as any).status >= 400 && (err as any).status < 500 && !(err as any).cause) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return handleApiError(err);
  }
}
