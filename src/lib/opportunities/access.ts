/**
 * Who may open and move opportunities. Reading follows the client: anyone
 * who can see the client (lib/investors/access.ts) sees its opportunities.
 * Working one needs a selling or servicing capability — the client's RM,
 * the insurance team for an insurance ask, back office and branch heads.
 * Marketing and compliance read but do not work them.
 */

import type { SessionUser } from "@/lib/auth/session";
import type { Tx } from "@/db/client";
import { can } from "@/lib/auth/rbac";
import { loadViewableInvestor } from "@/lib/investors/access";
import { clientOpportunities } from "@/db/schema";
import { and, eq } from "drizzle-orm";

const WORK_CAPS = ["investor.edit.all", "investor.edit.assigned", "insurance.write", "lead.edit.all", "lead.edit.assigned"] as const;

export function canWorkOpportunities(session: SessionUser): boolean {
  return WORK_CAPS.some((c) => can(session.roles, c, session.permissions));
}

export function requireWorkOpportunities(session: SessionUser) {
  if (!canWorkOpportunities(session)) {
    throw Object.assign(new Error("You don't have permission to work on opportunities."), { status: 403 });
  }
}

/** The opportunity, if the viewer can see its client — else a 404 (never a 403, so ids don't leak). */
export async function loadViewableOpportunity(tx: Tx, session: SessionUser, id: string) {
  const [opp] = await tx.select().from(clientOpportunities)
    .where(and(eq(clientOpportunities.tenantId, session.tenantId), eq(clientOpportunities.id, id))).limit(1);
  if (!opp) throw Object.assign(new Error("Opportunity not found"), { status: 404 });
  const inv = await loadViewableInvestor(tx, session, opp.investorId);
  if (!inv) throw Object.assign(new Error("Opportunity not found"), { status: 404 });
  return opp;
}
