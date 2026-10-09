/**
 * Aina Admin → registrar scheme mappings for every firm (Phase 3I). Platform
 * operators only.
 *
 *   GET  ?status=verified|approved|revoked&rta=…   the platform mappings, with their history
 *   POST { action: "approve", rta, amcCode, schemeCode, amfiSchemeCode, note, changeRef, reason }
 *        FILES a two-person request from the signed-in session (lib/rta/posting/approvals.ts);
 *        a DIFFERENT signed-in operator approves it at POST /api/super-admin/rta-pipeline
 *        { action: "approve", requestId, payloadHash }. No operator id is taken from the body.
 *   POST { action: "revoke", id, reason }
 *   GET  ?view=amc                                  the AMC-identity crosswalk, with its history
 *   POST { action: "approve_amc", rta, amcCode, amfiAmc, role: "primary" | "successor", note, changeRef, reason }  (a request, as above)
 *   POST { action: "revoke_amc", id, reason }
 *
 * The AMC identity (which AMFI AMC a registrar AMC code is, plus documented
 * successor AMCs after a merger) must be recorded before any scheme under it
 * can be approved. Recording it approves no scheme.
 *
 * A registrar code → AMFI scheme relationship is the registrar's, the same for
 * every firm. The system records one when a firm's file proves it by ISIN
 * (status verified). Operators approve one where the registrar prints no ISIN
 * (CAMS): two of them, each in their own signed-in session — one files the
 * request, a DIFFERENT one approves it — with a note saying what evidence was read. One
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
import { revokeAmcIdentity, revokePlatformMapping, SchemeMappingError } from "@/lib/rta/scheme-resolution";
import { requestControlAction } from "@/lib/rta/posting/approvals";
import { ControlError } from "@/lib/rta/posting/controls";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"), rta: z.enum(["cams", "kfintech"]), amcCode: z.string().trim().min(1).max(20), schemeCode: z.string().trim().min(1).max(40),
    amfiSchemeCode: z.string().trim().min(1).max(20), note: z.string().trim().min(10).max(1000),
    changeRef: z.string().trim().min(3).max(200), reason: z.string().trim().min(10).max(1000),
  }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid(), reason: z.string().trim().min(10).max(1000) }),
  z.object({
    action: z.literal("approve_amc"), rta: z.enum(["cams", "kfintech"]), amcCode: z.string().trim().min(1).max(20), amfiAmc: z.string().trim().min(2).max(200),
    role: z.enum(["primary", "successor"]), note: z.string().trim().min(10).max(1000),
    changeRef: z.string().trim().min(3).max(200), reason: z.string().trim().min(10).max(1000),
  }),
  z.object({ action: z.literal("revoke_amc"), id: z.string().uuid(), reason: z.string().trim().min(10).max(1000) }),
]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");
    if (req.nextUrl.searchParams.get("view") === "amc") {
      const rows = await withSystem(async (tx) => (await tx.execute(sql`
        SELECT i.id, i.rta, i.rta_amc_code, i.amfi_amc, i.role, i.basis, i.status, i.evidence_note, i.evidence_isins, i.requested_by, i.approved_by, i.created_at, i.revoked_at, i.revoke_reason,
               (SELECT jsonb_agg(jsonb_build_object('action', e.action, 'at', e.at, 'actor', e.actor, 'secondActor', e.second_actor, 'reason', e.reason) ORDER BY e.at)
                  FROM registrar_amc_identity_events e WHERE e.identity_id = i.id) AS history
          FROM registrar_amc_identity i ORDER BY i.rta, i.rta_amc_code, (i.role = 'primary') DESC, i.created_at`)).rows);
      return NextResponse.json({ rows });
    }
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
    const raw = await req.json().catch(() => null);
    if (raw && typeof raw === "object" && "requestedBy" in raw) {
      return NextResponse.json({ error: "operator identities are taken from the signed-in session, never from the request — file the approval as a request and have a DIFFERENT operator approve it" }, { status: 400 });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues }, { status: 400 });
    const b = parsed.data;
    const me = { userId: session.userId, sid: session.sid ?? null };
    // Approvals are two-person requests: this files one from YOUR session.
    if (b.action === "approve") {
      const request = await requestControlAction(me, { action: "approve_scheme_mapping", rta: b.rta, amcCode: b.amcCode, schemeCode: b.schemeCode, amfiSchemeCode: b.amfiSchemeCode, note: b.note, changeRef: b.changeRef, reason: b.reason });
      return NextResponse.json({ request, next: "a DIFFERENT signed-in operator approves it at POST /api/super-admin/rta-pipeline { action: \"approve\", requestId, payloadHash }" }, { status: 201 });
    }
    if (b.action === "approve_amc") {
      const request = await requestControlAction(me, { action: "approve_amc_identity", rta: b.rta, amcCode: b.amcCode, amfiAmc: b.amfiAmc, role: b.role, note: b.note, changeRef: b.changeRef, reason: b.reason });
      return NextResponse.json({ request, next: "a DIFFERENT signed-in operator approves it at POST /api/super-admin/rta-pipeline { action: \"approve\", requestId, payloadHash }" }, { status: 201 });
    }
    // Revocations are stops: one operator.
    const out = await withSystem(async (tx) => {
      if (b.action === "revoke_amc") return revokeAmcIdentity(tx, { id: b.id, by: session.userId, reason: b.reason });
      return revokePlatformMapping(tx, { id: b.id, by: session.userId, reason: b.reason });
    });
    return NextResponse.json(out);
  } catch (err: any) {
    if (err instanceof SchemeMappingError) return NextResponse.json({ error: err.message }, { status: err.status ?? 409 });
    if (err instanceof ControlError) return NextResponse.json({ error: err.message }, { status: err.status });
    return handleApiError(err);
  }
}
