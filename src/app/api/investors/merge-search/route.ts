/**
 * GET /api/investors/merge-search?q=…
 *
 * Free-text client lookup for the manual merge picker: name / PAN / email /
 * mobile / address. The duplicate detector groups only on exact-ish keys, so an
 * operator who can SEE that two records are the same person — different
 * spellings, a typo'd PAN, one record with no identifiers at all — had no way to
 * act on it. This is that path.
 *
 * Read-only, but it returns PAN and contact details, so it carries the same
 * capability requirement as viewing a client, and merge itself stays restricted
 * to owners / branch heads at the merge endpoint.
 */

import { handleApiError } from "@/lib/api/error-handler";
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { searchMergeCandidates } from "@/lib/investors/merged";
import { investorScopeSql } from "@/lib/investors/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const results = await withTenant(
      session.tenantId,
      // Data scope: only clients in the viewer's book (branch / own book).
      async (tx) => searchMergeCandidates(tx, q, 25, await investorScopeSql(tx, session, "i")),
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    return NextResponse.json({ results });
  } catch (e) {
    return handleApiError(e);
  }
}
