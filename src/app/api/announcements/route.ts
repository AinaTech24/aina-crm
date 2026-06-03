import { handleApiError } from "@/lib/api/error-handler";
/**
 * Announcements — internal team notice board (Sanchay parity).
 *
 *   GET  /api/announcements           — active notices for the viewer
 *   GET  /api/announcements?manage=1  — all notices (managers; for admin list)
 *   POST /api/announcements           — post a notice (owner / branch_head)
 *
 * "Active" = published, not expired, audience role matches, branch matches.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { ANNOUNCEMENT_CATEGORIES, announcements } from "@/db/schema";

export const dynamic = "force-dynamic";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));

const Body = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(1).max(8000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default("general"),
  audienceRoles: z.array(z.string()).max(12).default([]),
  branchId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().default(false),
  publishNow: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const manage = req.nextUrl.searchParams.get("manage") === "1" && isManager(session.roles);

    const rows = await withTenant(session.tenantId, async (tx) => {
      if (manage) {
        const r = await tx.execute(sql`
          SELECT a.*, u.name AS created_by_name
          FROM announcements a LEFT JOIN users u ON u.id = a.created_by_user_id
          WHERE a.tenant_id = ${session.tenantId}::uuid
          ORDER BY a.is_pinned DESC, COALESCE(a.published_at, a.created_at) DESC
          LIMIT 200
        `);
        return r.rows;
      }
      const rolesJson = JSON.stringify(session.roles);
      const r = await tx.execute(sql`
        SELECT a.id, a.title, a.body, a.category, a.is_pinned, a.published_at, a.expires_at,
               u.name AS created_by_name
        FROM announcements a LEFT JOIN users u ON u.id = a.created_by_user_id
        WHERE a.tenant_id = ${session.tenantId}::uuid
          AND a.published_at IS NOT NULL AND a.published_at <= now()
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND (a.branch_id IS NULL OR a.branch_id = ${session.branchId ?? null})
          AND (
            a.audience_roles IS NULL
            OR jsonb_array_length(a.audience_roles) = 0
            OR a.audience_roles ?| array(SELECT jsonb_array_elements_text(${rolesJson}::jsonb))
          )
        ORDER BY a.is_pinned DESC, a.published_at DESC
        LIMIT 100
      `);
      return r.rows;
    });
    return NextResponse.json({ announcements: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) return NextResponse.json({ error: "only owners / branch heads can post announcements" }, { status: 403 });
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);
    const id = uuid();

    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(announcements).values({
        id,
        tenantId: session.tenantId,
        title: b.title,
        body: b.body,
        category: b.category,
        audienceRoles: b.audienceRoles,
        branchId: b.branchId ?? null,
        isPinned: b.isPinned,
        publishedAt: b.publishNow ? new Date() : null,
        expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
        createdByUserId: session.userId,
      } as any);
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "announcement.create",
        entityType: "announcement",
        entityId: id,
        after: { title: b.title, category: b.category } as any,
        ...meta,
      });
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
