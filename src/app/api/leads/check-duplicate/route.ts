import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/check-duplicate
 *   Body: { phone?, email?, pan? }
 *   Returns: { matches: Array<{ id, name, stage, source, createdAt, matchedOn }>,
 *              clients: Array<{ id, name, rmName, matchedOn, openOpportunities } | { outsideBook: true, matchedOn }> }
 *
 * Used by the "New lead" form to warn the RM before creating a duplicate.
 * Match priority: phone (last 10 digits) → email (case-insensitive) → PAN.
 *
 * `clients` is the same check against EXISTING CLIENTS. A client who wants
 * another product is an opportunity on their record, not a new lead — a lead
 * would duplicate the person and fail at conversion on the PAN. A client
 * outside the viewer's book is reported only as "already a client", with no
 * name or RM, so the check never widens what someone may see.
 */

import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  pan: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const { phone, email, pan } = parsed.data;

    // Need at least one field
    if (!phone && !email && !pan) return NextResponse.json({ matches: [] });

    const last10 = phone ? phone.replace(/\D/g, "").slice(-10) : null;
    const emailLower = email ? email.trim().toLowerCase() : null;
    const panUpper = pan ? pan.trim().toUpperCase() : null;

    // Match on the INDEXED columns the schema maintains for exactly this:
    // phone_normalized / email_normalized (leads_phone_norm_idx / _email_norm_idx)
    // and the real `pan` column (leads_pan_idx). The old code matched PAN inside
    // free-text `notes` (never selected → never matched) and used unindexable
    // expressions on raw phone/email, full-scanning on every keystroke.
    const conds: any[] = [];
    if (last10) conds.push(sql`leads.phone_normalized = ${last10}`);
    if (emailLower) conds.push(sql`leads.email_normalized = ${emailLower}`);
    if (panUpper) conds.push(sql`upper(coalesce(leads.pan, '')) = ${panUpper}`);
    const where = sql.join(conds, sql` OR `);

    const rows = await withTenant(session.tenantId, async (tx) => {
      return tx.execute(sql`
        SELECT id, name, stage, source, phone, email, pan,
               phone_normalized, email_normalized, created_at
        FROM leads
        WHERE (${where})
        ORDER BY created_at DESC
        LIMIT 5
      `);
    });

    const matches = (rows.rows as any[]).map((r) => {
      const matchedOn: string[] = [];
      if (last10 && r.phone_normalized === last10) matchedOn.push("phone");
      if (emailLower && (r.email_normalized ?? "") === emailLower) matchedOn.push("email");
      if (panUpper && (r.pan ?? "").toUpperCase() === panUpper) matchedOn.push("pan");
      return {
        id: r.id,
        name: r.name,
        stage: r.stage,
        source: r.source,
        phone: r.phone,
        email: r.email,
        createdAt: r.created_at,
        matchedOn,
      };
    });

    // Existing clients with the same phone, email or PAN.
    const iconds: any[] = [];
    if (last10) iconds.push(sql`right(regexp_replace(COALESCE(i.phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}`);
    if (emailLower) iconds.push(sql`lower(btrim(COALESCE(i.email, ''))) = ${emailLower}`);
    if (panUpper) iconds.push(sql`upper(i.pan) = ${panUpper}`);
    const clientRows = await withTenant(session.tenantId, async (tx) => {
      const visible = canSeeClients(session) ? await investorScopeSql(tx, session, "i") : sql`FALSE`;
      return (await tx.execute(sql`
        SELECT i.id, i.name, i.phone, i.email, i.pan, u.name AS rm_name, (${visible}) AS visible,
               (SELECT count(*)::int FROM client_opportunities o
                 WHERE o.investor_id = i.id AND o.status = 'open') AS open_opps
          FROM investors i LEFT JOIN users u ON u.id = i.rm_id
         WHERE i.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
           AND (${sql.join(iconds, sql` OR `)})
         ORDER BY i.aum DESC NULLS LAST
         LIMIT 3
      `)).rows as any[];
    });
    const clients = clientRows.map((r) => {
      const matchedOn: string[] = [];
      if (last10 && String(r.phone ?? "").replace(/\D/g, "").slice(-10) === last10) matchedOn.push("phone");
      if (emailLower && String(r.email ?? "").trim().toLowerCase() === emailLower) matchedOn.push("email");
      if (panUpper && String(r.pan ?? "").toUpperCase() === panUpper) matchedOn.push("pan");
      return r.visible
        ? { id: r.id as string, name: r.name as string, rmName: r.rm_name ? String(r.rm_name).replace(/\s*\([^)]*\)\s*$/, "") : null, matchedOn, openOpportunities: Number(r.open_opps ?? 0) }
        : { outsideBook: true as const, matchedOn };
    });

    return NextResponse.json({ matches, clients });
  } catch (err: any) {
    return handleApiError(err);
  }
}

/** investorScopeSql throws for a role with no client access (marketing creates leads too). */
function canSeeClients(session: { roles: string[]; permissions?: string[] | null }) {
  return can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "investor.view.assigned", session.permissions);
}
