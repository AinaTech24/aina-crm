import { handleApiError } from "@/lib/api/error-handler";
/**
 * Business Closing Entries collection.
 *
 *   GET  /api/business-entries   — list (filters: q, productType, status, rm, from, to)
 *   POST /api/business-entries   — create a header + scheme sub-form lines
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isClientVisible, visibleClientOrOwnSql } from "@/lib/transactions/client-scope";
import { assertActiveLicense } from "@/lib/auth/license";
import { clientMetaFromHeaders } from "@/lib/audit";
import { businessEntries, investors, users } from "@/db/schema";
import { EntryInput } from "@/lib/business/entry-input";
import { insertBusinessEntry } from "@/lib/business/create-entry";

export const dynamic = "force-dynamic";

const MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const canManage = (roles: string[]) => roles.some((r) => MANAGE_ROLES.includes(r));

/** Who sees the WHOLE firm's business book vs only their own bookings. Owner /
 *  back-office / ops / compliance / branch-head manage the register; an RM sees
 *  the entries they booked. */
const seesAllEntries = (s: { roles: string[]; permissions?: string[] | null }) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "reports.business", s.permissions);

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") ?? "").trim();
    const productType = (sp.get("productType") ?? "").split(",").filter(Boolean);
    const status = (sp.get("status") ?? "").split(",").filter(Boolean);
    const rm = (sp.get("rm") ?? "").split(",").filter(Boolean);
    const from = sp.get("from");
    const to = sp.get("to");
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 100));

    const rows = await withTenant(session.tenantId, async (tx) => {
      const conds: any[] = [eq(businessEntries.tenantId, session.tenantId)];
      // RMs see only the entries they booked; managers/ops see the whole firm.
      if (!seesAllEntries(session)) conds.push(eq(businessEntries.rmId, session.userId));
      // Viewer scope: their own bookings, or entries on clients they may see.
      conds.push(await visibleClientOrOwnSql(tx, session, businessEntries.investorId, businessEntries.rmId));
      if (q) conds.push(or(ilike(businessEntries.clientName, `%${q}%`), ilike(businessEntries.amcName, `%${q}%`))!);
      if (productType.length) conds.push(inArray(businessEntries.productType, productType as any));
      if (status.length) conds.push(inArray(businessEntries.status, status as any));
      if (rm.length) conds.push(inArray(businessEntries.rmId, rm as any));
      if (from) conds.push(gte(businessEntries.businessDate, from));
      if (to) conds.push(lte(businessEntries.businessDate, to));
      return tx
        .select({
          entry: businessEntries,
          rmName: users.name,
          lineCount: sql<number>`(SELECT count(*)::int FROM business_entry_lines l WHERE l.entry_id = ${businessEntries.id})`,
        })
        .from(businessEntries)
        .leftJoin(users, eq(users.id, businessEntries.rmId))
        .where(and(...conds))
        .orderBy(desc(businessEntries.businessDate), desc(businessEntries.createdAt))
        .limit(limit);
    });
    return NextResponse.json({ entries: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canManage(session.roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = EntryInput.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const b = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      if (b.investorId) {
        const [inv] = await tx
          .select({ id: investors.id })
          .from(investors)
          .where(and(eq(investors.id, b.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        // …and is a client this viewer may see.
        if (!inv || !(await isClientVisible(tx, session, b.investorId))) return { kind: "no_client" as const };
      }
      // One implementation for the form and for financial tasks
      // (lib/business/create-entry). The form registers SIP lines at once.
      const r = await insertBusinessEntry(
        tx,
        { tenantId: session.tenantId, userId: session.userId, clientMeta: meta },
        b,
        { registerSips: true },
      );
      return { kind: "ok" as const, entryId: r.entryId };
    });

    if (outcome.kind === "no_client") return NextResponse.json({ error: "client not found in this firm" }, { status: 400 });
    return NextResponse.json({ id: outcome.entryId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
