/**
 * GET   /api/notifications?unreadOnly=1   — list for the current user
 * POST  /api/notifications/mark-read       — mark some/all as read
 *
 * Notifications are user-scoped (not just tenant-scoped). RLS allows
 * users to read only their own rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { notifications } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "1";

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conditions = [eq(notifications.userId, session.userId)];
      if (unreadOnly) conditions.push(isNull(notifications.readAt));
      const list = await tx
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
      const unreadCount = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM notifications
        WHERE user_id = ${session.userId} AND read_at IS NULL AND archived_at IS NULL
      `);
      return { list, unreadCount: Number((unreadCount.rows[0] as any)?.c ?? 0) };
    });

    return NextResponse.json({ notifications: rows.list, unreadCount: rows.unreadCount });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
