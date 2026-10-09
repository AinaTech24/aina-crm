import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/search?q=…
 *
 * The Ctrl+K palette's record search, one group per kind of record: clients
 * (name / PAN / phone / email), leads, families, tasks, meetings, service
 * requests, policies, folios, SIPs and documents. Up to 5 rows per group, each
 * row carrying the group's full match count (`total`) so the palette can offer
 * "See all" on the list page.
 *
 * Work about a person is found by the PERSON's name too: searching "Bhavesh"
 * lists Bhavesh's tasks, meetings, service requests and policies, not only
 * records with "Bhavesh" in their own title. A task reaches its client through
 * either related_investor_id or subject_type/subject_id (CLAUDE.md, "A task
 * reaches a client through TWO links"), so both are read.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { captureError } from "@/lib/observability/capture";
import { displayPan, isMinorKey } from "@/lib/investors/pan-display";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ groups: [] });

    const like = `%${q}%`;
    const likeUpper = `%${q.toUpperCase()}%`;
    // Names that START with what was typed rank first.
    const prefix = `${q}%`;

    const results = await withTenant(session.tenantId, async (tx) => {
      // Search answers as you type. A lookup that cannot finish in a few
      // seconds is useless and, at the pool-wide 30 s limit, held a database
      // connection for minutes across its eleven groups while the database
      // was struggling (2026-10-08). Fail fast instead; the group says nothing.
      await tx.execute(sql`SET LOCAL statement_timeout = '4s'`);
      const cap = (name: Parameters<typeof can>[1]) => can(session.roles, name, session.permissions);
      const investorAllowed = cap("investor.view.all") || cap("investor.view.assigned");
      const leadAllowed = cap("lead.view.all") || cap("lead.view.assigned");
      const invScope = investorAllowed ? await investorScopeSql(tx, session, "i") : sql`FALSE`;
      const listScope = investorAllowed ? await investorScopeSql(tx, session, "investors") : sql`FALSE`;
      const leadScope = leadAllowed ? leadScopeSql(session) : sql`FALSE`;
      const requestScope = cap("service_request.view.all") ? sql`TRUE`
        : cap("service_request.view.assigned") ? sql`sr.assigned_to_user_id = ${session.userId}` : sql`FALSE`;
      const docScope = cap("document.view") ? sql`(
        (d.related_entity_type = 'investor' AND EXISTS (SELECT 1 FROM investors i
          WHERE i.id = d.related_entity_id AND i.deleted_at IS NULL AND ${invScope})) OR
        (d.related_entity_type = 'lead' AND EXISTS (SELECT 1 FROM leads
          WHERE leads.id = d.related_entity_id AND leads.lost_reason IS DISTINCT FROM '__deleted__' AND ${leadScope})) OR
        (d.related_entity_type IS DISTINCT FROM 'investor' AND d.related_entity_type IS DISTINCT FROM 'lead'
          AND ${cap("compliance.view")})
      )` : sql`FALSE`;
      // One group failing must not take the other five down. Each runs in a
      // savepoint (nested tx) so a bad statement can't poison the transaction
      // for the rest, and the failure is captured with the group name — this
      // route is six hand-written queries the schema guard cannot check.
      const group = async (name: string, q: SQL): Promise<unknown[]> => {
        // The person typed on: the browser dropped this search, so stop here.
        if (req.signal.aborted) return [];
        try {
          return (await tx.transaction(async (sp) => sp.execute(q))).rows;
        } catch (err) {
          captureError("search.group_failed", err, { group: name, tenantId: session.tenantId });
          return [];
        }
      };

      const investors = await group("investors", sql`
          SELECT investors.id, investors.name, investors.pan, investors.phone, investors.email, investors.segment_tag,
                 investors.aum, investors.client_category, investors.status, u.name AS rm_name,
                 COUNT(*) OVER () AS total
          FROM investors LEFT JOIN users u ON u.id = investors.rm_id
          WHERE investors.tenant_id = ${session.tenantId}::uuid AND ${listScope} AND investors.deleted_at IS NULL
            AND investors.merged_into_id IS NULL
            AND (investors.name ILIKE ${like} OR investors.pan ILIKE ${likeUpper}
             OR investors.phone ILIKE ${like} OR investors.email ILIKE ${like})
          ORDER BY (investors.name ILIKE ${prefix}) DESC, investors.aum DESC NULLS LAST, investors.name
          LIMIT 5
        `);
      const leads = await group("leads", sql`
          SELECT leads.id, leads.name, leads.phone, leads.email, leads.stage, leads.source, u.name AS owner_name,
                 COUNT(*) OVER () AS total
          FROM leads LEFT JOIN users u ON u.id = leads.owner_id
          WHERE leads.tenant_id = ${session.tenantId}::uuid AND ${leadScope} AND leads.lost_reason IS DISTINCT FROM '__deleted__'
            AND (leads.name ILIKE ${like} OR leads.phone ILIKE ${like} OR leads.email ILIKE ${like})
            AND leads.converted_investor_id IS NULL
          ORDER BY (leads.name ILIKE ${prefix}) DESC, leads.created_at DESC
          LIMIT 5
        `);
      const folios = await group("folios", sql`
          SELECT f.id, f.folio_number, f.amc_name, f.aum, i.name AS investor_name, i.id AS investor_id, COUNT(*) OVER () AS total
          FROM folios f LEFT JOIN investors i ON i.id = f.investor_id
          WHERE f.tenant_id = ${session.tenantId}::uuid AND ${invScope} AND i.deleted_at IS NULL AND f.folio_number ILIKE ${like}
          LIMIT 5
        `);
      const sips = await group("sips", sql`
          SELECT s.id, s.scheme_name, s.amount, s.status, i.name AS investor_name, i.id AS investor_id, COUNT(*) OVER () AS total
          FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
          WHERE s.tenant_id = ${session.tenantId}::uuid AND ${invScope} AND i.deleted_at IS NULL AND (s.scheme_name ILIKE ${like} OR s.scheme_code ILIKE ${like})
          LIMIT 5
        `);
      const serviceRequests = await group("serviceRequests", sql`
          SELECT sr.id, sr.ticket_no, sr.subject, sr.type, sr.status, i.name AS investor_name, COUNT(*) OVER () AS total
          FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
          WHERE sr.tenant_id = ${session.tenantId}::uuid AND ${requestScope}
            AND (sr.investor_id IS NULL OR (${invScope} AND i.deleted_at IS NULL))
            AND (sr.ticket_no ILIKE ${like} OR sr.subject ILIKE ${like} OR i.name ILIKE ${like})
          ORDER BY sr.created_at DESC
          LIMIT 5
        `);
      const documents = await group("documents", sql`
          SELECT d.id, d.name, d.category, d.created_at, COUNT(*) OVER () AS total
          FROM compliance_documents d
          WHERE d.tenant_id = ${session.tenantId}::uuid AND ${docScope} AND d.name ILIKE ${like}
          LIMIT 5
        `);
      // A family is visible when the caller can see a client inside it — the
      // same scope the Clients list uses, so search can't reveal a branch or
      // an RM's book through the family name.
      const families = await group("families", sql`
          SELECT f.id, f.family_name, f.family_code, f.head_name, f.family_category, COUNT(*) OVER () AS total
          FROM families f
          WHERE f.tenant_id = ${session.tenantId}::uuid
            AND ${cap("family.view") ? sql`TRUE` : sql`FALSE`}
            AND EXISTS (
              SELECT 1 FROM investors i
              WHERE i.family_id = f.id AND i.deleted_at IS NULL AND ${invScope}
            )
            AND (f.family_name ILIKE ${like} OR f.family_code ILIKE ${like} OR f.head_name ILIKE ${like})
          LIMIT 5
        `);
      const policies = await group("policies", sql`
          SELECT p.id, p.policy_number, p.policy_type, p.insurer, p.status,
                 i.name AS investor_name, i.id AS investor_id, COUNT(*) OVER () AS total
          FROM insurance_policies p LEFT JOIN investors i ON i.id = p.investor_id
          WHERE p.tenant_id = ${session.tenantId}::uuid
            AND ${cap("insurance.view") ? sql`TRUE` : sql`FALSE`}
            AND (p.investor_id IS NULL OR (${invScope} AND i.deleted_at IS NULL))
            AND (p.policy_number ILIKE ${like} OR p.insurer ILIKE ${like} OR p.plan_name ILIKE ${like} OR i.name ILIKE ${like})
          LIMIT 5
        `);
      const taskScope = cap("task.view.all")
        ? sql`TRUE`
        : cap("task.view.assigned")
          ? sql`(t.assignee_id = ${session.userId} OR t.created_by_id = ${session.userId})`
          : sql`FALSE`;
      // A task about a client / lead outside the caller's book still shows (task
      // scope is the tasks module's), but never that person's name — and is not
      // found by it.
      const taskLeadScope = leadAllowed ? leadScopeSql(session, "l") : sql`FALSE`;
      const tasks = await group("tasks", sql`
          SELECT t.id, t.title, t.status, t.priority, t.due_at,
                 COALESCE(CASE WHEN ${invScope} THEN i.name END, CASE WHEN ${taskLeadScope} THEN l.name END) AS investor_name,
                 u.name AS assignee_name,
                 COUNT(*) OVER () AS total
          FROM tasks t
          LEFT JOIN investors i ON i.id = COALESCE(t.related_investor_id,
            CASE WHEN t.subject_type = 'investor' THEN t.subject_id END)
          LEFT JOIN leads l ON l.id = CASE WHEN t.subject_type = 'lead' THEN t.subject_id END
          LEFT JOIN users u ON u.id = t.assignee_id
          WHERE t.tenant_id = ${session.tenantId}::uuid AND ${taskScope}
            -- The name arms look the matching clients / leads up first (their
            -- own trigram indexes) instead of filtering every task's joined
            -- row, and lower(title) is what tasks_title_trgm_idx is built on.
            AND t.deleted_at IS NULL AND (lower(t.title) ILIKE ${like}
                 OR COALESCE(t.related_investor_id, CASE WHEN t.subject_type = 'investor' THEN t.subject_id END) IN (
                      SELECT i.id FROM investors i
                       WHERE i.tenant_id = ${session.tenantId}::uuid AND i.name ILIKE ${like} AND ${invScope})
                 OR (t.subject_type = 'lead' AND t.subject_id IN (
                      SELECT l.id FROM leads l
                       WHERE l.tenant_id = ${session.tenantId}::uuid AND l.name ILIKE ${like} AND ${taskLeadScope})))
          ORDER BY (t.status IN ('open', 'in_progress', 'blocked')) DESC, t.due_at ASC NULLS LAST
          LIMIT 5
        `);
      // Meetings: the caller's own, or about a client or lead they may see
      // (the same client and lead scopes as those lists).
      const meetings = await group("meetings", sql`
          SELECT m.id, m.subject, m.category, m.meeting_type, m.status, m.meeting_date,
                 COALESCE(i.name, leads.name) AS person_name, u.name AS rm_name,
                 COUNT(*) OVER () AS total
          FROM review_meetings m
          LEFT JOIN investors i ON i.id = m.investor_id AND i.deleted_at IS NULL
          LEFT JOIN leads ON leads.id = m.lead_id
          LEFT JOIN users u ON u.id = m.rm_id
          WHERE m.tenant_id = ${session.tenantId}::uuid
            AND (m.rm_id = ${session.userId}::uuid
                 OR (i.id IS NOT NULL AND ${invScope})
                 OR (leads.id IS NOT NULL AND ${leadScope}))
            AND (i.name ILIKE ${like} OR leads.name ILIKE ${like} OR m.subject ILIKE ${like})
          ORDER BY (m.meeting_date >= now()) DESC,
                   CASE WHEN m.meeting_date >= now() THEN m.meeting_date END ASC,
                   m.meeting_date DESC
          LIMIT 5
        `);

      // The pan column can hold an import key (MINOR:<guardian PAN>:<NAME>);
      // what leaves the server is the masked own PAN, as on the Clients list.
      const investorsOut = (investors as Array<Record<string, unknown>>).map(({ pan, ...r }) => ({
        ...r, pan_display: displayPan(pan as string | null), minor: isMinorKey(pan as string | null),
      }));

      return { investors: investorsOut, leads, families, folios, sips, policies, tasks, meetings, serviceRequests, documents };
    });

    return NextResponse.json({ q, ...results });
  } catch (err: any) {
    return handleApiError(err);
  }
}
