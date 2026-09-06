import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/investors/merge/auto — "Client Merged By System".
 *
 * Merges every exact-PAN duplicate group in the firm without a per-pair review:
 * a PAN is one legal person, so two live records with the same PAN are the same
 * client by definition. Phone / email / address matches are NOT touched here —
 * a household shares those, and merging on them unattended is how a husband
 * gets folded into his wife.
 *
 * Body: { dryRun?: boolean }
 *   dryRun → counts + a sample, for the confirmation dialog. Nothing changes.
 *   else   → merges, source 'system', reason 'Same PAN <pan>'. Every merge is
 *            logged in investor_merges and reversible from "Differ Clients".
 *
 * Owner / branch-head only. Capped per call so one click can't lock the book
 * for minutes — the response says how many groups remain.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { clientMetaFromHeaders } from "@/lib/audit";
import { loadExactPanGroups, mergeInvestors } from "@/lib/investors/merge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const isManager = (roles: string[]) => roles.some((r) => ["owner", "branch_head"].includes(r));
const MAX_MERGES_PER_CALL = 200;

const Body = z.object({ dryRun: z.boolean().optional() });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!isManager(session.roles)) {
      return NextResponse.json({ error: "only owners / branch heads can run a system merge" }, { status: 403 });
    }
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const dryRun = !!parse.data.dryRun;
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(
      session.tenantId,
      async (tx) => {
        const groups = await loadExactPanGroups(tx, session.tenantId);
        const totalLosers = groups.reduce((n, g) => n + g.losers.length, 0);

        if (dryRun) {
          return {
            dryRun: true as const,
            groups: groups.length,
            clients: totalLosers,
            sample: groups.slice(0, 5).map((g) => ({
              pan: g.pan,
              keep: g.survivorName,
              merge: g.losers.map((l) => l.name),
            })),
          };
        }

        let merged = 0;
        let budget = MAX_MERGES_PER_CALL;
        const failed: Array<{ loserId: string; name: string; error: string }> = [];
        let groupsDone = 0;
        for (const g of groups) {
          if (budget <= 0) break;
          for (const loser of g.losers) {
            if (budget <= 0) break;
            budget--;
            const r = await mergeInvestors(tx, {
              tenantId: session.tenantId,
              survivorId: g.survivorId,
              loserId: loser.id,
              byUserId: session.userId,
              source: "system",
              reason: `Same PAN ${g.pan}`,
              auditMeta: meta as any,
            });
            if ("error" in r) failed.push({ loserId: loser.id, name: loser.name, error: r.error });
            else merged++;
          }
          groupsDone++;
        }
        return {
          dryRun: false as const,
          groups: groups.length,
          groupsDone,
          merged,
          failed,
          remaining: Math.max(0, totalLosers - merged - failed.length),
        };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
