import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/review-meetings/team — the firm's active team members, for the
 * "Assign to" picker on a meeting's next actions (each one becomes a task).
 * The same list the meeting page's own Action items use, for the pop-ups that
 * complete a meeting without opening that page.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const team = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT u.id::text AS id, u.name
          FROM users u
         WHERE u.tenant_id = ${session.tenantId}::uuid AND u.deleted_at IS NULL AND u.status = 'active'
           AND NOT ('platform_admin' = ANY(u.roles))
         ORDER BY u.name
      `);
      return r.rows as Array<{ id: string; name: string }>;
    });
    return NextResponse.json({ team, me: session.userId });
  } catch (err: any) {
    return handleApiError(err);
  }
}
