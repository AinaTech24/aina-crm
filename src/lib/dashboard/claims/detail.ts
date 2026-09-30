/**
 * One claim, for the Claims Control Centre's drawer (§55–58): the claim as
 * the set defines it, its policy (Policy 360), the client and their other
 * claims (Client 360), the lifecycle timeline with exact times, the
 * communication log and the audit trail.
 *
 * The claim is loaded THROUGH the claim set, so an id outside the viewer's
 * scope is simply not found, and every derived field (pending with, SLA,
 * documents) reads exactly as it does on the dashboard.
 */

import { sql } from "drizzle-orm";
import { CLAIM_STATUS_LABEL } from "@/lib/insurance/claims-book";
import { DOC_LABEL } from "@/lib/insurance/claim-checklist";
import { loadClaimSet, type ClaimRec } from "./set";
import { num, str, type ClaimWindow, type Row, type Tx } from "./window";

export type TimelineStage = { key: string; label: string; at: string | null; exact: boolean; state: "done" | "current" | "todo" | "none" };
export type LogEvent = { at: string; kind: "registered" | "status" | "edit" | "remark" | "document" | "task" | "task_done" | "contact" | "message"; label: string; by: string | null; detail: string | null };

export type ClaimDetail = {
  claim: ClaimRec;
  documents: Array<{ name: string; type: string | null; url: string | null; uploadedAt: string | null }>;
  policy: {
    id: string; number: string | null; insurer: string | null; plan: string | null; type: string | null; status: string | null;
    start: string | null; end: string | null; sumAssured: number | null; premium: number | null; frequency: string | null; nextDue: string | null;
  } | null;
  policyClaims: Array<{ id: string; status: string; claimed: number; settled: number; openedOn: string }>;
  client: { id: string; name: string; category: string | null; rm: string | null; branch: string | null; phone: string | null; email: string | null } | null;
  otherClaims: Array<{ id: string; status: string; claimed: number; settled: number; openedOn: string; insurer: string | null }>;
  stages: TimelineStage[];
  log: LogEvent[];
  tasks: Array<{ id: string; title: string; due: string | null; status: string; assignee: string | null }>;
  audit: {
    createdBy: string | null; createdAt: string | null; lastUpdatedBy: string | null; lastUpdatedAt: string | null;
    closedBy: string | null; closedAt: string | null;
  };
  names: { owner: string | null; clientRm: string | null; actionWith: string | null; branch: string | null };
};

const iso = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const dateAt = (d: string | null) => (d ? `${d}T00:00:00+05:30` : null);
const earliest = (xs: Array<string | null | undefined>) => (xs.filter(Boolean) as string[]).sort()[0] ?? null;
const statusLabel = (s: unknown) => (s ? CLAIM_STATUS_LABEL[String(s)] ?? String(s) : "not set");

export async function loadClaimDetail(tx: Tx, w: ClaimWindow, id: string, opts: { contacts: boolean }): Promise<ClaimDetail | null> {
  const [claim] = await loadClaimSet(tx, w, "1900-01-01", { id });
  if (!claim) return null;
  const t = w.tenantId;

  const docRow = (await tx.execute(sql`SELECT documents FROM insurance_claims WHERE id = ${id}::uuid AND tenant_id = ${t}::uuid`)).rows[0] as Row | undefined;
  const documents = ((docRow?.documents ?? []) as Array<Record<string, unknown>>).map((d) => ({
    name: String(d.name ?? "Document"), type: str(d.docType), url: str(d.url), uploadedAt: str(d.uploadedAt),
  }));

  const policyRow = claim.policyId ? (await tx.execute(sql`
    SELECT id::text, policy_number, insurer, plan_name, policy_type, status, COALESCE(risk_cover_start_date, policy_start_date)::text AS start,
           maturity_date::text AS end_date, sum_assured, annual_premium, premium_frequency, next_premium_due_date::text AS next_due
      FROM insurance_policies WHERE id = ${claim.policyId}::uuid AND tenant_id = ${t}::uuid
  `)).rows[0] as Row | undefined : undefined;
  const policyClaims = claim.policyId ? ((await tx.execute(sql`
    SELECT id::text, claim_status, COALESCE(claimed_amount, 0) AS claimed, COALESCE(settled_amount, 0) AS settled,
           COALESCE(intimation_date, (created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS opened_on
      FROM insurance_claims WHERE tenant_id = ${t}::uuid AND policy_id = ${claim.policyId}::uuid AND id <> ${id}::uuid
     ORDER BY opened_on DESC LIMIT 20
  `)).rows as Row[]) : [];

  const clientRow = claim.investorId ? (await tx.execute(sql`
    SELECT i.id::text, i.name, NULLIF(upper(btrim(COALESCE(i.client_category, ''))), '') AS cat, i.phone, i.email,
           u.name AS rm, b.name AS branch
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id LEFT JOIN branches b ON b.id = i.branch_id
     WHERE i.id = ${claim.investorId}::uuid AND i.tenant_id = ${t}::uuid
  `)).rows[0] as Row | undefined : undefined;
  const otherClaims = claim.investorId ? ((await tx.execute(sql`
    SELECT c.id::text, c.claim_status, COALESCE(c.claimed_amount, 0) AS claimed, COALESCE(c.settled_amount, 0) AS settled,
           COALESCE(c.intimation_date, (c.created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS opened_on, c.insurer
      FROM insurance_claims c WHERE c.tenant_id = ${t}::uuid AND c.investor_id = ${claim.investorId}::uuid AND c.id <> ${id}::uuid
     ORDER BY opened_on DESC LIMIT 20
  `)).rows as Row[]) : [];

  const audits = (await tx.execute(sql`
    SELECT a.at, a.action, u.name AS actor, a.before, a.after
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.tenant_id = ${t}::uuid AND a.entity_type = 'insurance_claim' AND a.entity_id = ${id}::uuid
     ORDER BY a.at ASC LIMIT 500
  `)).rows as Row[];

  const taskRows = (await tx.execute(sql`
    SELECT tk.id::text, tk.title, tk.due_at, tk.status, tk.created_at, tk.completed_at, u.name AS assignee, cu.name AS creator
      FROM tasks tk LEFT JOIN users u ON u.id = tk.assignee_id LEFT JOIN users cu ON cu.id = tk.created_by_id
     WHERE tk.tenant_id = ${t}::uuid AND tk.deleted_at IS NULL AND tk.meta->>'claimId' = ${id}
     ORDER BY tk.created_at DESC LIMIT 50
  `)).rows as Row[];

  const contacts = claim.investorId ? ((await tx.execute(sql`
    SELECT * FROM (
      SELECT ac.occurred_at AS at, ac.kind AS what, NULLIF(btrim(COALESCE(ac.subject, ac.notes, '')), '') AS note, u.name AS by, 'contact' AS src
        FROM activities ac LEFT JOIN users u ON u.id = ac.owner_user_id
       WHERE ac.tenant_id = ${t}::uuid AND ac.subject_type = 'investor' AND ac.subject_id = ${claim.investorId}::uuid
         AND ac.occurred_at >= ${claim.openedOn}::date
      UNION ALL
      SELECT m.sent_at, m.channel, NULL, NULL, 'message'
        FROM communications m
       WHERE m.tenant_id = ${t}::uuid AND m.investor_id = ${claim.investorId}::uuid AND m.sent_at IS NOT NULL
         AND m.sent_at >= ${claim.openedOn}::date
    ) z ORDER BY at DESC LIMIT 30
  `)).rows as Row[]) : [];

  const names = (await tx.execute(sql`
    SELECT
      (SELECT name FROM users WHERE id = ${claim.ownerId ?? null}::uuid) AS owner,
      (SELECT name FROM users WHERE id = ${claim.clientRmId ?? null}::uuid) AS client_rm,
      (SELECT name FROM users WHERE id = ${claim.nextAction?.assigneeId ?? null}::uuid) AS action_with,
      (SELECT name FROM branches WHERE id = ${claim.branchId ?? null}::uuid) AS branch
  `)).rows[0] as Row;

  /* ── the log (§36) and the audit trail (§58) ── */
  const log: LogEvent[] = [];
  let lastRemark: string | null = null;
  let closedBy: string | null = null;
  let closedAt: string | null = null;
  for (const a of audits) {
    const at = iso(a.at) ?? new Date(0).toISOString();
    const by = str(a.actor);
    const before = (a.before ?? {}) as Record<string, unknown>;
    const after = (a.after ?? {}) as Record<string, unknown>;
    if (a.action === "insurance_claim.create") {
      log.push({ at, kind: "registered", label: "Claim registered", by, detail: after.claimStatus ? `Status ${statusLabel(after.claimStatus)}` : null });
      lastRemark = null;
      continue;
    }
    if (a.action !== "insurance_claim.update") continue;
    const moved = "claimStatus" in after && before.claimStatus !== after.claimStatus;
    if (moved) {
      log.push({ at, kind: "status", label: `${statusLabel(before.claimStatus)} → ${statusLabel(after.claimStatus)}`, by, detail: null });
      if (["settled_fully", "settled_partially", "rejected", "withdrawn"].includes(String(after.claimStatus))) {
        closedBy = by;
        closedAt = at;
      }
    }
    const remark = typeof after.comments === "string" ? after.comments.trim() : null;
    if (remark && remark !== lastRemark) log.push({ at, kind: "remark", label: "Remarks updated", by, detail: remark.slice(0, 400) });
    if (remark != null) lastRemark = remark || null;
    if (Array.isArray(after.documents)) log.push({ at, kind: "document", label: `Documents updated · ${after.documents.length} on file`, by, detail: null });
    const others = Object.keys(after).filter((k) => !["claimStatus", "comments", "documents"].includes(k));
    if (!moved && !remark && !Array.isArray(after.documents) && others.length) log.push({ at, kind: "edit", label: "Claim edited", by, detail: null });
  }
  for (const d of documents) if (d.uploadedAt) log.push({ at: d.uploadedAt, kind: "document", label: `Document added: ${d.name}`, by: null, detail: d.type ? DOC_LABEL[d.type] ?? d.type : null });
  for (const tk of taskRows) {
    const created = iso(tk.created_at);
    if (created) log.push({ at: created, kind: "task", label: `Follow-up scheduled: ${String(tk.title)}`, by: str(tk.creator), detail: str(tk.assignee) ? `With ${tk.assignee}` : null });
    const done = iso(tk.completed_at);
    if (done) log.push({ at: done, kind: "task_done", label: `Follow-up completed: ${String(tk.title)}`, by: str(tk.assignee), detail: null });
  }
  for (const c of contacts) {
    const at = iso(c.at);
    if (!at) continue;
    const what = String(c.what ?? "");
    log.push(c.src === "message"
      ? { at, kind: "message", label: `${what === "whatsapp" ? "WhatsApp" : what === "sms" ? "SMS" : what === "email" ? "Email" : what} sent to the client`, by: null, detail: null }
      : { at, kind: "contact", label: `Client ${what || "contact"} logged`, by: str(c.by), detail: str(c.note) });
  }
  log.sort((a, b) => b.at.localeCompare(a.at));

  /* ── the lifecycle timeline (§37) ── */
  const h = claim.hist;
  const f = (...s: string[]) => earliest(s.map((k) => h[k]?.f));
  const closedStatus = ["settled_fully", "settled_partially", "rejected", "withdrawn"].includes(claim.status);
  const raw: Array<{ key: string; label: string; at: string | null; exact: boolean; na?: boolean }> = [
    { key: "intimation", label: "Intimation", at: dateAt(claim.intimationDate), exact: false },
    { key: "registration", label: "Registered in the CRM", at: iso(audits.find((a) => a.action === "insurance_claim.create")?.at) ?? `${claim.createdOn}T00:00:00+05:30`, exact: audits.some((a) => a.action === "insurance_claim.create") },
    { key: "documents", label: "Documents / file received", at: f("file_received"), exact: true },
    { key: "submission", label: "Submitted to insurer", at: dateAt(claim.submissionDate) ?? f("query", "add_info_awaited", "query_replied", "under_process"), exact: !claim.submissionDate },
    { key: "assessment", label: "Query / assessment", at: f("query", "add_info_awaited", "query_replied", "under_process"), exact: true },
    { key: "approval", label: "Approval", at: null, exact: false, na: true },
    { key: "settlement", label: "Settlement", at: dateAt(claim.settlementDate) ?? f("settled_fully", "settled_partially"), exact: !claim.settlementDate },
  ];
  if (claim.status === "rejected" || claim.status === "withdrawn") {
    raw.push({ key: claim.status, label: claim.status === "rejected" ? "Rejected" : "Withdrawn", at: f(claim.status) ?? dateAt(claim.closedOn), exact: !!f(claim.status) });
  }
  const lastDone = [...raw].reverse().findIndex((s) => s.at);
  const lastIdx = lastDone === -1 ? -1 : raw.length - 1 - lastDone;
  const stages: TimelineStage[] = raw.map((s, i) => ({
    key: s.key, label: s.label, at: s.at, exact: s.exact,
    state: s.na ? "none" : s.at ? (i === lastIdx && !closedStatus ? "current" : "done") : "todo",
  }));

  const createdAudit = audits.find((a) => a.action === "insurance_claim.create");
  const lastAudit = audits[audits.length - 1];
  return {
    claim,
    documents,
    policy: policyRow ? {
      id: String(policyRow.id), number: str(policyRow.policy_number), insurer: str(policyRow.insurer), plan: str(policyRow.plan_name),
      type: str(policyRow.policy_type), status: str(policyRow.status), start: str(policyRow.start), end: str(policyRow.end_date),
      sumAssured: policyRow.sum_assured == null ? null : num(policyRow.sum_assured), premium: policyRow.annual_premium == null ? null : num(policyRow.annual_premium),
      frequency: str(policyRow.premium_frequency), nextDue: str(policyRow.next_due),
    } : null,
    policyClaims: policyClaims.map((r) => ({ id: String(r.id), status: String(r.claim_status), claimed: num(r.claimed), settled: num(r.settled), openedOn: String(r.opened_on) })),
    client: clientRow ? {
      id: String(clientRow.id), name: String(clientRow.name ?? claim.client), category: str(clientRow.cat), rm: str(clientRow.rm), branch: str(clientRow.branch),
      phone: opts.contacts ? str(clientRow.phone) : null, email: opts.contacts ? str(clientRow.email) : null,
    } : null,
    otherClaims: otherClaims.map((r) => ({ id: String(r.id), status: String(r.claim_status), claimed: num(r.claimed), settled: num(r.settled), openedOn: String(r.opened_on), insurer: str(r.insurer) })),
    stages,
    log: log.slice(0, 80),
    tasks: taskRows.map((r) => ({ id: String(r.id), title: String(r.title ?? "Follow-up"), due: iso(r.due_at), status: String(r.status), assignee: str(r.assignee) })),
    audit: {
      createdBy: str(createdAudit?.actor), createdAt: iso(createdAudit?.at),
      lastUpdatedBy: str(lastAudit?.actor), lastUpdatedAt: iso(lastAudit?.at) ?? claim.updatedAt,
      closedBy, closedAt,
    },
    names: { owner: str(names.owner), clientRm: str(names.client_rm), actionWith: str(names.action_with), branch: str(names.branch) },
  };
}
