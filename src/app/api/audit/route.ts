import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/audit?entityType=investor&entityId=…  — per-record change history
 * (Sanchay "Change Log" parity). Reads the append-only audit_log, RLS-scoped,
 * newest first. Powers the ChangeLog drawer on detail pages.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { stripRiskKeys } from "@/lib/investors/guardian-link";
import { minorSql } from "@/lib/risk-profile/own-assessment";

export const dynamic = "force-dynamic";

// Entity histories that expose privileged config / PII / compliance evidence.
// Reading these requires a management role; ordinary record histories
// (investor/lead/task/…) stay open to any internal user for the ChangeLog drawer.
const SENSITIVE_ENTITY_TYPES = new Set([
  "user",
  "tenant",
  "tenant_integration",
  "integration",
  "compliance_document",
  "ddq_checklist",
  "consent",
  "sop",
  "audit_log",
  "license",
]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const entityType = (sp.get("entityType") ?? "").trim();
    const entityId = (sp.get("entityId") ?? "").trim();
    if (!entityType || !entityId) return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) return NextResponse.json({ error: "entityId must be an id" }, { status: 400 });

    // Privileged histories are gated; everyone else can read normal record logs.
    if (SENSITIVE_ENTITY_TYPES.has(entityType)) {
      const privileged = session.roles.some((r: string) => ["owner", "compliance", "branch_head"].includes(r));
      if (!privileged) {
        return NextResponse.json({ error: "forbidden — management roles only for this record type" }, { status: 403 });
      }
    }

    const rows = await withTenant(session.tenantId, async (tx) => {
      // A client's history carries the whole record in before / after, so it
      // follows the client's own access (the firm's data wall) — otherwise any
      // id, e.g. a minor's hidden guardian's, opened the full record (G-1).
      let hideRisk = false;
      if (entityType === "investor") {
        const scope = await investorScopeSql(tx, session, "i");
        const seen = await tx.execute(sql`
          SELECT ${minorSql("i")} AS minor FROM investors i
           WHERE i.id = ${entityId}::uuid AND i.tenant_id = ${session.tenantId}::uuid AND ${scope} LIMIT 1`);
        if (!seen.rows.length) return null;
        hideRisk = (seen.rows[0] as { minor: boolean }).minor === true;
      }
      const r = await tx.execute(sql`
        SELECT a.id, a.action, a.actor_type, a.at, a.before, a.after, a.reason,
               u.name AS actor_name
        FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.entity_type = ${entityType}
          AND a.entity_id = ${entityId}::uuid
        ORDER BY a.at DESC
        LIMIT 200
      `);
      const entries = r.rows as any[];
      if (!hideRisk) return entries;
      // A minor's history rows carry migration 0234's copies of whichever
      // guardian was linked at the time — not the minor's information. The
      // minor's own assessments are in the risk profile history instead.
      const strip = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? stripRiskKeys(o as Record<string, unknown>) : o);
      return entries.map((e) => ({ ...e, before: strip(e.before), after: strip(e.after) }));
    });
    if (rows === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ entries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}
