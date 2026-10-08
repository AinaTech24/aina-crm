/**
 * Aina Admin → registrar scheme mappings for every firm (Phase 3I). Platform
 * operators only.
 *
 *   GET  ?status=verified|approved|revoked&rta=…   the platform mappings, with their history
 *   POST { action: "approve", rta, amcCode, schemeCode, amfiSchemeCode, note, requestedBy }
 *   POST { action: "revoke", id, reason }
 *
 * A registrar code → AMFI scheme relationship is the registrar's, the same for
 * every firm. The system records one when a firm's file proves it by ISIN
 * (status verified). Operators approve one where the registrar prints no ISIN
 * (CAMS): two of them — the signed-in operator approves, a different active
 * operator is the requester — with a note saying what evidence was read. One
 * operator may revoke. Every change is an append-only event, and every firm
 * holding the code is re-decided at once.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/error-handler";
import { withSystem } from "@/db/client";
import { approvePlatformMapping, revokePlatformMapping, SchemeMappingError } from "@/lib/rta/scheme-resolution";
import { reprocessHeldTransactions } from "@/lib/rta/posting/reprocess";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"), rta: z.enum(["cams", "kfintech"]), amcCode: z.string().trim().min(1).max(20), schemeCode: z.string().trim().min(1).max(40),
    amfiSchemeCode: z.string().trim().min(1).max(20), note: z.string().trim().min(10).max(1000), requestedBy: z.string().uuid(),
  }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid(), reason: z.string().trim().min(10).max(1000) }),
]);

async function assertOperator(tx: any, userId: string, approver: string) {
  if (userId === approver) throw new SchemeMappingError("the requester and the approver must be different operators");
  const r = (await tx.execute(sql`
    SELECT 1 FROM users WHERE id = ${userId}::uuid AND status = 'active' AND roles && ARRAY['platform_admin', 'platform_support']::text[]`)).rows;
  if (!r.length) throw new SchemeMappingError("the requester is not an active platform operator");
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    const status = req.nextUrl.searchParams.get("status");
    const rta = req.nextUrl.searchParams.get("rta");
    const rows = await withSystem(async (tx) => (await tx.execute(sql`
      SELECT g.id, g.rta, g.rta_amc_code, g.rta_scheme_code, g.amfi_scheme_code, n.scheme_name AS amfi_name, n.amc_name AS amfi_amc,
             g.basis, g.status, g.evidence_isin, g.isin_column, g.evidence_note, g.requested_by, g.approved_by, g.verified_at, g.revoked_at, g.revoke_reason,
             (SELECT count(DISTINCT c.tenant_id)::int FROM scheme_rta_codes c WHERE c.rta = g.rta AND c.rta_amc_code = g.rta_amc_code AND c.rta_scheme_code = g.rta_scheme_code) AS firms,
             (SELECT jsonb_agg(jsonb_build_object('action', e.action, 'at', e.at, 'actor', e.actor, 'secondActor', e.second_actor, 'reason', e.reason) ORDER BY e.at)
                FROM scheme_registrar_map_events e WHERE e.map_id = g.id) AS history
        FROM scheme_registrar_map g LEFT JOIN scheme_nav n ON n.scheme_code = g.amfi_scheme_code
       WHERE (${status}::text IS NULL OR g.status = ${status}) AND (${rta}::text IS NULL OR g.rta = ${rta})
       ORDER BY g.rta, g.rta_amc_code, g.rta_scheme_code, g.verified_at DESC
       LIMIT 2000`)).rows);
    return NextResponse.json({ rows });
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
    const out = await withSystem(async (tx) => {
      if (b.action === "approve") {
        await assertOperator(tx, b.requestedBy, session.userId);
        return approvePlatformMapping(tx, { ...b, approvedBy: session.userId });
      }
      return revokePlatformMapping(tx, { id: b.id, by: session.userId, reason: b.reason });
    });
    // An approval can release transactions held on the code in each firm.
    // Re-evaluate them now; a firm whose posting is paused keeps them for resume.
    const pending: string[] = [];
    const released = b.action === "approve" ? (out as Awaited<ReturnType<typeof approvePlatformMapping>>) : null;
    if (released?.key) {
      for (const t of released.tenantIds) {
        try { await reprocessHeldTransactions(t, { schemeKeys: [released.key], userId: session.userId }); }
        catch (e: any) { if (e?.name !== "PostingGateError") throw e; pending.push(t); }
      }
    }
    return NextResponse.json({ ...out, postingPendingFirms: pending.length });
  } catch (err: any) {
    if (err instanceof SchemeMappingError) return NextResponse.json({ error: err.message }, { status: err.status ?? 409 });
    return handleApiError(err);
  }
}
