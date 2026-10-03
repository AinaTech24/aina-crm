import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/sub-distributors/lookup?q= — the sub-distributor PICKER's source.
 *
 * The register's list endpoint (GET /api/sub-distributors) is compliance-only
 * and returns whole records — PAN, bank details, licences. The new-lead form's
 * Sub-distributor field called it, so for an RM or back-office user it got a
 * 403 and showed "No sub-distributors match" whatever they typed: a lookup
 * that looked like a dead text box. This returns only what a picker shows
 * (name, code, ARN, city) of ACTIVE sub-distributors, to anyone who may create
 * or edit leads.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { subDistributors } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["lead.edit.all", "lead.edit.assigned", "compliance.edit"], session.permissions);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);

    const rows = await withTenant(session.tenantId, async (tx) => {
      const where = [eq(subDistributors.tenantId, session.tenantId), eq(subDistributors.status, "active" as any)];
      if (q) {
        where.push(
          or(
            ilike(subDistributors.name, `%${q}%`),
            ilike(subDistributors.code, `%${q}%`),
            ilike(subDistributors.arnNumber, `%${q}%`),
            ilike(subDistributors.city, `%${q}%`),
          )!,
        );
      }
      return tx
        .select({
          id: subDistributors.id,
          name: subDistributors.name,
          code: subDistributors.code,
          arnNumber: subDistributors.arnNumber,
          city: subDistributors.city,
        })
        .from(subDistributors)
        .where(and(...where))
        .orderBy(asc(subDistributors.name))
        .limit(50);
    });

    return NextResponse.json({ subDistributors: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}
