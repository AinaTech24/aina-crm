/**
 * One client's insurance relationship (§49) — the command centre's client
 * drawer. Loaded THROUGH the dashboard's scope: a client none of whose
 * policies the viewer may see, and who is not the viewer's own client, is
 * simply not found.
 */

import { sql } from "drizzle-orm";
import { CLAIM_OPEN, GROUP_LABEL, inList, LINE_LABEL, POLICY_STATUS_LABEL, STATUS_IN_FORCE } from "@/lib/insurance/book";
import { num, numOrNull, polBase, scopeSql, str, type InsWindow, type Row, type Tx } from "./window";

export type ClientInsurance = {
  investorId: string;
  name: string;
  category: string | null;
  type: string;
  mf: boolean;
  rm: string | null;
  branch: string | null;
  phone: string | null;
  email: string | null;
  inForcePremium: number;
  policies: Array<{
    id: string; plan: string; type: string; group: string; line: string; insurer: string | null; premium: number; frequency: string;
    status: string; statusLabel: string; inForce: boolean; due: string | null; bookedOn: string | null; policyNumber: string | null; documents: number;
  }>;
  claims: Array<{ id: string; status: string; open: boolean; type: string | null; claimed: number; settled: number; intimated: string | null; insurer: string | null }>;
  proposals: Array<{ id: string; number: string; status: string; amount: number | null; validUntil: string | null }>;
  meetings: Array<{ id: string; when: string; category: string; status: string; subject: string | null }>;
  tasks: Array<{ id: string; title: string; due: string | null; status: string }>;
  queries: Array<{ id: string; ticket: string | null; type: string; status: string }>;
  /** Another RM's client, seen through a policy the viewer sold or owns: only THAT work is listed. */
  partial: boolean;
};

export async function loadClientInsurance(tx: Tx, w: InsWindow, investorId: string, opts: { contacts: boolean }): Promise<ClientInsurance | null> {
  const t = w.tenantId;
  const client = (await tx.execute(sql`
    SELECT i.id, i.name, NULLIF(upper(btrim(COALESCE(i.client_category, ''))), '') AS cat, i.investor_category, i.family_id,
           (COALESCE(i.aum, 0)::numeric > 0) AS mf, i.phone, i.email, u.name AS rm, b.name AS branch, i.rm_id,
           EXISTS (SELECT 1 FROM families f WHERE f.tenant_id = ${t}::uuid AND f.primary_investor_id = i.id) AS head
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id LEFT JOIN branches b ON b.id = i.branch_id
     WHERE i.id = ${investorId}::uuid AND i.tenant_id = ${t}::uuid AND i.deleted_at IS NULL
  `)).rows[0] as Row | undefined;
  if (!client) return null;

  const policies = (await tx.execute(sql`
    WITH pol AS (${polBase(w)})
    SELECT pol.*, (${scopeSql(w, "pol")}) AS visible,
           (SELECT jsonb_array_length(COALESCE(p2.documents, '[]'::jsonb)) FROM insurance_policies p2 WHERE p2.id = pol.id) AS docs
      FROM pol WHERE pol.investor_id = ${investorId}::uuid
     ORDER BY (pol.status IN (${inList(STATUS_IN_FORCE)})) DESC, pol.due ASC NULLS LAST, pol.created_at DESC
  `)).rows as Row[];
  const mine = w.scope.kind === "self" && str(client.rm_id) === w.scope.userId;
  if (w.scope.kind !== "firm" && !mine && !policies.some((p) => p.visible === true)) return null;
  // A seller on another RM's client sees the policies they sold or own and their own work
  // on the client — not the rest of the relationship (the RM desk's "nothing from another
  // RM's book").
  const partial = w.scope.kind === "self" && !mine;
  const me = w.scope.kind === "self" ? w.scope.userId : null;
  const shown = partial ? policies.filter((p) => p.visible === true) : policies;
  const only = (column: string) => (partial ? sql`AND ${sql.raw(column)} = ${me}::uuid` : sql``);

  const claims = (await tx.execute(sql`
    SELECT id, claim_status, claim_type, claimed_amount, settled_amount, intimation_date::text AS intimated, insurer
      FROM insurance_claims WHERE tenant_id = ${t}::uuid AND investor_id = ${investorId}::uuid
       ${partial ? sql`AND policy_id IN (${inList(shown.map((x) => String(x.id)))})` : sql``}
     ORDER BY COALESCE(intimation_date, created_at::date) DESC LIMIT 20
  `)).rows as Row[];
  const proposals = (await tx.execute(sql`
    SELECT id, proposal_number, status, total_investment, valid_until::text AS valid_until FROM proposals
     WHERE tenant_id = ${t}::uuid AND investor_id = ${investorId}::uuid
       AND (type = 'insurance' OR products @> '[{"kind": "insurance"}]'::jsonb) ${only("prepared_by_user_id")}
     ORDER BY created_at DESC LIMIT 10
  `)).rows as Row[];
  const meetings = (await tx.execute(sql`
    SELECT id, meeting_date::text AS at, category, status, subject FROM review_meetings
     WHERE tenant_id = ${t}::uuid AND investor_id = ${investorId}::uuid ${only("rm_id")} ORDER BY meeting_date DESC LIMIT 5
  `)).rows as Row[];
  const tasks = (await tx.execute(sql`
    SELECT id, title, due_at::text AS due, status FROM tasks
     WHERE tenant_id = ${t}::uuid AND deleted_at IS NULL AND status IN ('open', 'in_progress', 'blocked')
       AND (related_investor_id = ${investorId}::uuid OR (subject_type = 'investor' AND subject_id = ${investorId}::uuid)) ${only("assignee_id")}
     ORDER BY due_at ASC NULLS LAST LIMIT 10
  `)).rows as Row[];
  const queries = (await tx.execute(sql`
    SELECT id, ticket_no, type, status FROM service_requests
     WHERE tenant_id = ${t}::uuid AND investor_id = ${investorId}::uuid AND status IN ('open', 'in_progress', 'escalated', 'waiting_customer')
       ${only("assigned_to_user_id")}
     ORDER BY created_at DESC LIMIT 10
  `)).rows as Row[];

  const inForce = (s: unknown) => (STATUS_IN_FORCE as readonly string[]).includes(String(s));
  return {
    investorId,
    name: String(client.name ?? "—"),
    category: str(client.cat),
    type: ["corporate", "company", "llp", "partnership", "aop_boi"].includes(String(client.investor_category)) ? "Corporate"
      : client.head === true ? "Family head" : client.family_id ? "Family member" : "Individual",
    mf: client.mf === true,
    rm: str(client.rm),
    branch: str(client.branch),
    phone: opts.contacts ? str(client.phone) : null,
    email: opts.contacts ? str(client.email) : null,
    inForcePremium: shown.filter((p) => inForce(p.status)).reduce((a, p) => a + num(p.premium), 0),
    policies: shown.map((p) => ({
      id: String(p.id), plan: String(p.plan_name ?? ""), type: String(p.policy_type ?? ""), group: GROUP_LABEL[String(p.grp)] ?? String(p.grp),
      line: LINE_LABEL[String(p.line)] ?? String(p.line), insurer: str(p.insurer), premium: num(p.premium), frequency: String(p.freq ?? ""),
      status: String(p.status), statusLabel: POLICY_STATUS_LABEL[String(p.status)] ?? String(p.status), inForce: inForce(p.status),
      due: p.due ? String(p.due).slice(0, 10) : null, bookedOn: p.booked_on ? String(p.booked_on).slice(0, 10) : null,
      policyNumber: str(p.policy_number), documents: num(p.docs),
    })),
    claims: claims.map((c) => ({
      id: String(c.id), status: String(c.claim_status), open: (CLAIM_OPEN as readonly string[]).includes(String(c.claim_status)),
      type: str(c.claim_type), claimed: num(c.claimed_amount), settled: num(c.settled_amount), intimated: str(c.intimated), insurer: str(c.insurer),
    })),
    proposals: proposals.map((p) => ({
      id: String(p.id), number: String(p.proposal_number), status: String(p.status), amount: numOrNull(p.total_investment), validUntil: str(p.valid_until),
    })),
    meetings: meetings.map((m) => ({ id: String(m.id), when: String(m.at), category: String(m.category), status: String(m.status), subject: str(m.subject) })),
    tasks: tasks.map((x) => ({ id: String(x.id), title: String(x.title ?? "Task"), due: str(x.due), status: String(x.status) })),
    queries: queries.map((q) => ({ id: String(q.id), ticket: str(q.ticket_no), type: String(q.type ?? ""), status: String(q.status) })),
    partial,
  };
}
