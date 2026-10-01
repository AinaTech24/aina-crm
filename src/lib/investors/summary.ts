/**
 * The Client 360 summary (RM brief §40) — the relationship at a glance, above
 * the tabs: who the client is, who looks after them, what they hold, and what
 * is open with them right now.
 *
 * Same honesty rules as the dashboards: a blank field is a record gap, never a
 * fact about the client. No completed meeting reads "No meeting recorded", a
 * missing risk profile reads "Not completed", no policy on file reads "No CRM
 * record" — never "needs cover".
 */

import { sql } from "drizzle-orm";
import type { withTenant } from "@/db/client";
import { asInList, num, PROPOSAL_LIVE, SR_CLOSED, TASK_DEAD, taskIsAbout } from "@/lib/dashboard/my/window";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export type ClientSummary = {
  family: string | null;
  familyId: string | null;
  category: string | null;
  rm: string | null;
  aum: number;
  sipBook: number;
  lastMeeting: string | null;
  nextReview: string | null;
  risk: "Completed" | "Provisional" | "Due for review" | "Not completed";
  /** The profile itself — conservative / moderate / aggressive — when one is on file. */
  riskCategory: string | null;
  riskSigned: string | null;
  openTasks: number;
  openQueries: number;
  pendingProposals: number;
  pendingProposalValue: number;
  policies: number;
  nextRenewal: string | null;
  openClaims: number;
};

/** Claim states after which nothing is left to chase. */
const CLAIM_DONE = ["settled_fully", "settled_partially", "rejected", "withdrawn"] as const;

export async function loadClientSummary(tx: Tx, tenantId: string, investorId: string): Promise<ClientSummary | null> {
  const r = (await tx.execute(sql`
    SELECT i.family_id,
           COALESCE(NULLIF(btrim(f.family_name), ''), f.head_name)                     AS family,
           upper(NULLIF(btrim(i.client_category), ''))                                 AS category,
           u.name                                                                      AS rm,
           i.aum::numeric AS aum, i.active_sip_amount::numeric AS sip, i.next_review_at,
           i.risk_profile, i.risk_profile_signed_at,
           COALESCE(i.risk_profile_provisional, false)                                 AS provisional,
           (SELECT MAX(m.meeting_date) FROM review_meetings m
             WHERE m.investor_id = i.id AND m.status = 'completed')                    AS last_meeting,
           (SELECT COUNT(*)::int FROM tasks tk
             WHERE ${taskIsAbout("tk", sql`i.id`)} AND tk.deleted_at IS NULL
               AND tk.status NOT IN (${asInList(TASK_DEAD)}))                          AS open_tasks,
           (SELECT COUNT(*)::int FROM service_requests sr
             WHERE sr.investor_id = i.id AND sr.status NOT IN (${asInList(SR_CLOSED)})) AS open_queries,
           (SELECT COUNT(*)::int FROM proposals p
             WHERE p.investor_id = i.id AND p.status IN (${asInList(PROPOSAL_LIVE)}))  AS props,
           (SELECT COALESCE(SUM(p.total_investment::numeric), 0) FROM proposals p
             WHERE p.investor_id = i.id AND p.status IN (${asInList(PROPOSAL_LIVE)}))  AS props_value,
           (SELECT COUNT(*)::int FROM insurance_policies ip
             WHERE ip.investor_id = i.id AND ip.status = 'active')                     AS policies,
           (SELECT MIN(ip.next_premium_due_date) FROM insurance_policies ip
             WHERE ip.investor_id = i.id AND ip.status = 'active'
               AND ip.next_premium_due_date >= current_date)                           AS next_renewal,
           (SELECT COUNT(*)::int FROM insurance_claims c
             WHERE c.investor_id = i.id AND c.claim_status NOT IN (${asInList(CLAIM_DONE)})) AS open_claims
      FROM investors i
      LEFT JOIN families f ON f.id = i.family_id
      LEFT JOIN users u    ON u.id = i.rm_id
     WHERE i.id = ${investorId}::uuid AND i.tenant_id = ${tenantId}::uuid
  `)).rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;

  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  const signed = str(r.risk_profile_signed_at);
  // A signed profile is re-done a year after signing — the same rule as the
  // dashboards' "Due for review".
  const stale = signed != null && Date.parse(signed) < Date.now() - 365 * 864e5;
  const risk: ClientSummary["risk"] = r.risk_profile == null ? "Not completed"
    : r.provisional === true ? "Provisional"
    : stale ? "Due for review"
    : "Completed";

  return {
    family: str(r.family),
    familyId: str(r.family_id),
    category: str(r.category),
    rm: str(r.rm),
    aum: num(r.aum),
    sipBook: num(r.sip),
    lastMeeting: str(r.last_meeting),
    nextReview: str(r.next_review_at),
    risk,
    riskCategory: str(r.risk_profile),
    riskSigned: signed,
    openTasks: num(r.open_tasks),
    openQueries: num(r.open_queries),
    pendingProposals: num(r.props),
    pendingProposalValue: num(r.props_value),
    policies: num(r.policies),
    nextRenewal: str(r.next_renewal),
    openClaims: num(r.open_claims),
  };
}
