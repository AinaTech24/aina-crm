import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/attendee-search?q=…
 *
 * The meeting Attendees lookup: clients, leads and team members whose name
 * (or, for clients and leads, phone / email / PAN) matches. Clients and leads
 * go through the same access scope as their list pages, so the lookup can
 * never reveal a record the viewer could not open. Up to 6 of each.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import type { AttendeeHit } from "@/lib/review-meetings/attendee-kinds";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", branch_head: "Branch head", rm: "RM", ops: "Operations", back_office: "Back office",
  compliance: "Compliance", marketing: "Marketing", insurance_team: "Insurance", service_team: "Service",
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ hits: [] });
    const like = `%${q}%`;
    const prefix = `${q}%`;
    const cap = (name: Parameters<typeof can>[1]) => can(session.roles, name, session.permissions);

    const hits = await withTenant(
      session.tenantId,
      async (tx) => {
        const clientScope = cap("investor.view.all") || cap("investor.view.assigned")
          ? await investorScopeSql(tx, session, "i") : sql`FALSE`;
        const leadScope = cap("lead.view.all") || cap("lead.view.assigned")
          ? leadScopeSql(session, "l") : sql`FALSE`;

        const [clients, leadRows, team] = await Promise.all([
          tx.execute(sql`
            SELECT i.id::text AS id, i.name, COALESCE(i.phone, i.email) AS detail
              FROM investors i
             WHERE i.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL AND ${clientScope}
               AND (i.name ILIKE ${like} OR i.phone ILIKE ${like} OR i.email ILIKE ${like} OR i.pan ILIKE ${like.toUpperCase()})
             ORDER BY (i.name ILIKE ${prefix}) DESC, i.name
             LIMIT 6
          `),
          tx.execute(sql`
            SELECT l.id::text AS id, l.name, COALESCE(l.phone, l.email) AS detail
              FROM leads l
             WHERE l.tenant_id = ${session.tenantId}::uuid AND l.converted_investor_id IS NULL
               AND l.lost_reason IS DISTINCT FROM '__deleted__' AND ${leadScope}
               AND (l.name ILIKE ${like} OR l.phone ILIKE ${like} OR l.email ILIKE ${like})
             ORDER BY (l.name ILIKE ${prefix}) DESC, l.name
             LIMIT 6
          `),
          tx.execute(sql`
            SELECT u.id::text AS id, u.name, u.roles
              FROM users u
             WHERE u.tenant_id = ${session.tenantId}::uuid AND u.deleted_at IS NULL AND u.status = 'active'
               AND NOT ('platform_admin' = ANY(u.roles))
               AND u.name ILIKE ${like}
             ORDER BY (u.name ILIKE ${prefix}) DESC, u.name
             LIMIT 6
          `),
        ]);
        const out: AttendeeHit[] = [
          ...(team.rows as any[]).map((r) => ({
            kind: "user" as const, id: r.id, name: r.name,
            detail: (Array.isArray(r.roles) ? r.roles : []).map((x: string) => ROLE_LABEL[x] ?? x).slice(0, 2).join(", ") || null,
          })),
          ...(clients.rows as any[]).map((r) => ({ kind: "client" as const, id: r.id, name: r.name, detail: r.detail ?? null })),
          ...(leadRows.rows as any[]).map((r) => ({ kind: "lead" as const, id: r.id, name: r.name, detail: r.detail ?? null })),
        ];
        return out;
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles },
    );
    return NextResponse.json({ hits });
  } catch (err: any) {
    return handleApiError(err);
  }
}
