import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/search?q=…
 *
 * Cross-module fuzzy search over investors (name/PAN/phone/email),
 * folios (folio_number), leads, SIPs (scheme name), service requests
 * (ticket_no/subject), complaints, documents. Returns up to 5 per group.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { leadScopeSql } from "@/lib/leads/access";
import { captureError } from "@/lib/observability/capture";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ groups: [] });

    const like = `%${q}%`;
    const likeUpper = `%${q.toUpperCase()}%`;

    const results = await withTenant(session.tenantId, async (tx) => {
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
        try {
          return (await tx.transaction(async (sp) => sp.execute(q))).rows;
        } catch (err) {
          captureError("search.group_failed", err, { group: name, tenantId: session.tenantId });
          return [];
        }
      };

      const investors = await group("investors", sql`
          SELECT id, name, pan, phone, email, segment_tag
          FROM investors
          WHERE tenant_id = ${session.tenantId}::uuid AND ${listScope} AND deleted_at IS NULL AND (name ILIKE ${like} OR pan ILIKE ${likeUpper}
             OR phone ILIKE ${like} OR email ILIKE ${like})
          LIMIT 5
        `);
      const leads = await group("leads", sql`
          SELECT id, name, phone, email, stage, source
          FROM leads
          WHERE tenant_id = ${session.tenantId}::uuid AND ${leadScope} AND lost_reason IS DISTINCT FROM '__deleted__' AND (name ILIKE ${like} OR phone ILIKE ${like} OR email ILIKE ${like})
            AND converted_investor_id IS NULL
          LIMIT 5
        `);
      const folios = await group("folios", sql`
          SELECT f.id, f.folio_number, f.amc_name, f.aum, i.name AS investor_name, i.id AS investor_id
          FROM folios f LEFT JOIN investors i ON i.id = f.investor_id
          WHERE f.tenant_id = ${session.tenantId}::uuid AND ${invScope} AND i.deleted_at IS NULL AND f.folio_number ILIKE ${like}
          LIMIT 5
        `);
      const sips = await group("sips", sql`
          SELECT s.id, s.scheme_name, s.amount, s.status, i.name AS investor_name, i.id AS investor_id
          FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
          WHERE s.tenant_id = ${session.tenantId}::uuid AND ${invScope} AND i.deleted_at IS NULL AND (s.scheme_name ILIKE ${like} OR s.scheme_code ILIKE ${like})
          LIMIT 5
        `);
      const serviceRequests = await group("serviceRequests", sql`
          SELECT sr.id, sr.ticket_no, sr.subject, sr.type, sr.status, i.name AS investor_name
          FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
          WHERE sr.tenant_id = ${session.tenantId}::uuid AND ${requestScope}
            AND (sr.investor_id IS NULL OR (${invScope} AND i.deleted_at IS NULL))
            AND (sr.ticket_no ILIKE ${like} OR sr.subject ILIKE ${like})
          LIMIT 5
        `);
      const documents = await group("documents", sql`
          SELECT d.id, d.name, d.category, d.created_at
          FROM compliance_documents d
          WHERE d.tenant_id = ${session.tenantId}::uuid AND ${docScope} AND d.name ILIKE ${like}
          LIMIT 5
        `);

      return { investors, leads, folios, sips, serviceRequests, documents };
    });

    return NextResponse.json({ q, ...results });
  } catch (err: any) {
    return handleApiError(err);
  }
}
