/**
 * Aina Admin → Inbound Mail. Every message the RTA mailback poller has touched —
 * routed or not — with its per-attachment classification verdict.
 *
 * This is the "is forwarding actually working?" screen. Before it, a routed mail
 * left only a timestamp and an unroutable one sat in a table with no UI, so the
 * only way to answer that question was to SSH in and grep the worker log.
 *
 * Platform-admin only: unroutable mail has no tenant by definition, so this
 * necessarily spans firms.
 */
import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { withPlatformAdmin } from "@/db/client";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set([
  "imported",
  "duplicate",
  "confirmation",
  "no_attachment",
  "unroutable",
  "error",
]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.settings.manage");

    const sp = req.nextUrl.searchParams;
    const outcome = sp.get("outcome");
    const q = (sp.get("q") ?? "").trim();
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 300);

    const data = await withPlatformAdmin(session.userId, async (tx) => {
      const where = [sql`1 = 1`];
      if (outcome && OUTCOMES.has(outcome)) where.push(sql`m.outcome = ${outcome}`);
      if (q) {
        const like = `%${q}%`;
        where.push(
          sql`(m.subject ILIKE ${like} OR m.from_address ILIKE ${like} OR m.to_address ILIKE ${like} OR t.name ILIKE ${like})`
        );
      }
      const whereSql = sql.join(where, sql` AND `);

      const rows = await tx.execute(sql`
        SELECT m.id, m.tenant_id, t.name AS tenant_name,
               m.message_id, m.from_address, m.from_name, m.to_address,
               m.subject, m.body_snippet, m.received_at, m.created_at,
               m.outcome, m.reason,
               m.attachment_count, m.queued_count, m.duplicate_count, m.attachments
        FROM rta_inbound_messages m
        LEFT JOIN tenants t ON t.id = m.tenant_id
        WHERE ${whereSql}
        ORDER BY COALESCE(m.received_at, m.created_at) DESC
        LIMIT ${limit}
      `);

      // Outcome tallies over the last 30 days — the at-a-glance health strip.
      const counts = await tx.execute(sql`
        SELECT outcome, COUNT(*)::int AS n
        FROM rta_inbound_messages
        WHERE created_at > now() - interval '30 days'
        GROUP BY outcome
      `);

      return { rows: rows.rows, counts: counts.rows };
    });

    const summary: Record<string, number> = {};
    for (const c of data.counts as any[]) summary[c.outcome] = Number(c.n) || 0;

    return NextResponse.json({
      messages: (data.rows as any[]).map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        messageId: r.message_id,
        fromAddress: r.from_address,
        fromName: r.from_name,
        toAddress: r.to_address,
        subject: r.subject,
        bodySnippet: r.body_snippet,
        receivedAt: r.received_at,
        createdAt: r.created_at,
        outcome: r.outcome,
        reason: r.reason,
        attachmentCount: r.attachment_count,
        queuedCount: r.queued_count,
        duplicateCount: r.duplicate_count,
        attachments: r.attachments ?? [],
      })),
      summary,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
