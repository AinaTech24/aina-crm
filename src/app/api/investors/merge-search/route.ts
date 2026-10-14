/**
 * GET /api/investors/merge-search?q=…
 * GET /api/investors/merge-search?ids=<uuid>,<uuid>[,…]   (up to 10)
 *
 * Free-text client lookup for the manual merge picker: name / PAN / email /
 * mobile / address. The duplicate detector groups only on exact-ish keys, so an
 * operator who can SEE that two records are the same person — different
 * spellings, a typo'd PAN, one record with no identifiers at all — had no way to
 * act on it. This is that path. `ids=` returns the same rows for records
 * already picked — the Clients list's "Merge" bulk action.
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
import { loadMergeCandidatesByIds, searchMergeCandidates } from "@/lib/investors/merged";
import { investorScopeSql } from "@/lib/investors/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The merge dialog compares records side by side; past ten it is unreadable. */
const MAX_IDS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    const ctx = { userId: session.userId, branchId: session.branchId, roles: session.roles };
    const idsParam = req.nextUrl.searchParams.get("ids");
    if (idsParam !== null) {
      const ids = [...new Set(idsParam.split(",").map((x) => x.trim()).filter(Boolean))];
      if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => UUID.test(id))) {
        return NextResponse.json({ error: `Pick between 1 and ${MAX_IDS} clients.` }, { status: 400 });
      }
      const results = await withTenant(
        session.tenantId,
        async (tx) => loadMergeCandidatesByIds(tx, ids, await investorScopeSql(tx, session, "i")),
        ctx
      );
      return NextResponse.json({ results });
    }

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const results = await withTenant(
      session.tenantId,
      // Data scope: only clients in the viewer's book (branch / own book).
      async (tx) => searchMergeCandidates(tx, q, 25, await investorScopeSql(tx, session, "i")),
      ctx
    );
    return NextResponse.json({ results });
  } catch (e) {
    return handleApiError(e);
  }
}
