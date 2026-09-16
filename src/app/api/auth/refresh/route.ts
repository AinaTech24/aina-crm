import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { verifySession, signSession } from "@/lib/auth/jwt";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

/** Refresh the same device family; a revoked device can never acquire a new sid. */
export async function POST(req: NextRequest) {
  try {
    const authz = req.headers.get("authorization");
    const session = authz?.startsWith("Bearer ") ? await verifySession(authz.slice(7).trim()) : null;
    if (!session?.sid || !session.iat) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    const token = await withTenant(session.tenantId, async (tx) => {
      // Hold row locks through signing so account/device revocations serialize with refresh.
      const r = await tx.execute(sql`
        SELECT u.id, u.email, u.name, u.branch_id, u.roles, u.permissions, u.status,
               u.deleted_at, t.deleted_at AS tenant_deleted_at, u.sessions_invalid_after, s.revoked_at
        FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
        JOIN tenants t ON t.id = u.tenant_id
        WHERE s.session_id = ${session.sid} AND u.id = ${session.userId}
          AND u.tenant_id = ${session.tenantId} FOR SHARE OF s, u, t
      `);
      const row = r.rows[0] as {
        id: string; email: string; name: string; branch_id: string | null;
        roles: string[] | null; permissions: string[] | null; status: string;
        deleted_at: string | null; tenant_deleted_at: string | null;
        sessions_invalid_after: string | null; revoked_at: string | null;
      } | undefined;
      if (!row || row.revoked_at || row.status !== "active" || row.deleted_at || row.tenant_deleted_at ||
          (row.sessions_invalid_after && session.iat! * 1000 < new Date(row.sessions_invalid_after).getTime())) return null;
      return signSession({ ...session, branchId: row.branch_id ?? undefined,
        roles: row.roles ?? [], permissions: row.permissions ?? [], name: row.name, email: row.email });
    });
    if (!token) return NextResponse.json({ error: "session revoked" }, { status: 401 });
    return NextResponse.json({ token });
  } catch (err) { return handleApiError(err); }
}
