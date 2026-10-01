import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/tasks/[id]/related — the records a task is about, for its Related
 * section.
 *
 * A task reaches a client or lead through TWO links (CLAUDE.md): the explicit
 * related_* columns the task form and this section set, and the legacy
 * subject_type / subject_id that automations write (SIP rejections,
 * onboarding, documents). The section used to read only related_investor_id,
 * so every automation task said "No entities linked" although it was about a
 * client. Both are read here; a link that comes from the subject is `fixed`,
 * because the automation that made the task is keyed to it.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { taskChecklist } from "@/db/schema";

export const dynamic = "force-dynamic";

// Not exported: a route.ts may export only HTTP verbs and config.
type RelatedLink = {
  kind: "client" | "lead" | "meeting" | "request";
  id: string;
  name: string;
  sub?: string | null;
  href: string;
  /** From subject_type / subject_id — set by the automation, not removable here. */
  fixed: boolean;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);
    const canEditAll = can(session.roles, "task.edit.all", session.permissions);
    const canEditOwn = can(session.roles, "task.edit.assigned", session.permissions);

    const out = await withTenant(session.tenantId, async (tx) => {
      const t = (await tx.execute(sql`
        SELECT t.id, t.assignee_id, t.created_by_id, t.meta, t.subject_type, t.subject_id,
               t.related_investor_id, t.related_lead_id, t.related_meeting_id, t.related_service_request_id
          FROM tasks t
         WHERE t.id = ${id}::uuid AND t.tenant_id = ${session.tenantId}::uuid AND t.deleted_at IS NULL
      `)).rows[0] as Record<string, any> | undefined;
      if (!t) return null;
      const own = t.assignee_id === session.userId || t.created_by_id === session.userId;
      const sub = taskChecklist(t.meta).some((c) => c.assigneeId === session.userId);
      if (!canViewAll && !own && !sub) return null;

      const subjectClient = t.subject_type === "investor" ? t.subject_id : null;
      const subjectLead = t.subject_type === "lead" ? t.subject_id : null;
      const clientIds = [...new Set([t.related_investor_id, subjectClient].filter(Boolean))] as string[];
      const leadIds = [...new Set([t.related_lead_id, subjectLead].filter(Boolean))] as string[];

      const links: RelatedLink[] = [];
      for (const cid of clientIds) {
        const r = (await tx.execute(sql`
          SELECT i.name, i.client_category, u.name AS rm_name FROM investors i LEFT JOIN users u ON u.id = i.rm_id
           WHERE i.id = ${cid}::uuid AND i.tenant_id = ${session.tenantId}::uuid
        `)).rows[0] as Record<string, any> | undefined;
        links.push({
          kind: "client", id: cid, name: r?.name ?? "Client no longer on record",
          sub: [r?.client_category ? `Cat ${r.client_category}` : null, r?.rm_name ? `RM ${r.rm_name}` : null].filter(Boolean).join(" · ") || null,
          href: `/dashboard/investors/${cid}`,
          fixed: cid === subjectClient && cid !== t.related_investor_id,
        });
      }
      for (const lid of leadIds) {
        const r = (await tx.execute(sql`
          SELECT name, stage FROM leads WHERE id = ${lid}::uuid AND tenant_id = ${session.tenantId}::uuid
        `)).rows[0] as Record<string, any> | undefined;
        links.push({
          kind: "lead", id: lid, name: r?.name ?? "Lead no longer on record", sub: r?.stage ?? null,
          href: `/dashboard/leads/${lid}`,
          fixed: lid === subjectLead && lid !== t.related_lead_id,
        });
      }
      if (t.related_meeting_id) {
        const r = (await tx.execute(sql`
          SELECT m.subject, m.category, m.meeting_date, COALESCE(i.name, l.name) AS person
            FROM review_meetings m
            LEFT JOIN investors i ON i.id = m.investor_id
            LEFT JOIN leads l ON l.id = m.lead_id
           WHERE m.id = ${t.related_meeting_id}::uuid AND m.tenant_id = ${session.tenantId}::uuid
        `)).rows[0] as Record<string, any> | undefined;
        links.push({
          kind: "meeting", id: t.related_meeting_id,
          name: r ? r.subject || `Meeting with ${r.person ?? "—"}` : "Meeting no longer on record",
          sub: r?.meeting_date ? new Date(r.meeting_date).toISOString() : null,
          href: `/dashboard/review-meetings/${t.related_meeting_id}`, fixed: false,
        });
      }
      if (t.related_service_request_id) {
        const r = (await tx.execute(sql`
          SELECT ticket_no, subject FROM service_requests
           WHERE id = ${t.related_service_request_id}::uuid AND tenant_id = ${session.tenantId}::uuid
        `)).rows[0] as Record<string, any> | undefined;
        links.push({
          kind: "request", id: t.related_service_request_id,
          name: r?.subject ?? "Service request no longer on record", sub: r?.ticket_no ?? null,
          href: `/dashboard/service-requests/${t.related_service_request_id}`, fixed: false,
        });
      }
      return { links, canEdit: canEditAll || (canEditOwn && (own || sub)) };
    });
    if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(out);
  } catch (err) {
    return handleApiError(err);
  }
}
