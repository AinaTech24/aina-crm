/**
 * The transaction detail drawer (§43) with its client context (§44) and audit
 * trail (§49). One request, everything Operations needs to act on it without
 * leaving the dashboard — and nothing more: no portfolio, no AUM (§44), a
 * masked PAN, contact details only where the viewer may already see them, and
 * the status-change audit only for the roles that hold the audit log.
 *
 * The item is loaded THROUGH opsBase, so a request outside the viewer's scope
 * simply is not found.
 */

import { sql } from "drizzle-orm";
import { humanise } from "@/lib/format";
import { feedTypeLabel } from "./exceptions";
import {
  KIND_LABEL, num, numOrNull, opsBase, PENDING_LABEL, PRIORITY_LABEL, STATUS_LABEL, str, type OpsWindow, type Row, type Tx,
} from "./window";

export type OpsItemDetail = {
  id: string;
  title: string;
  kind: string;
  kindLabel: string;
  amount: number | null;
  mode: string | null;
  product: string | null;
  receivedAt: string;
  assigneeId: string | null;
  assignee: string | null;
  createdBy: string | null;
  status: string;
  statusLabel: string;
  priorityLabel: string;
  slaDue: string | null;
  slaState: string;
  ageDays: number;
  pendingWith: string | null;
  remarks: string | null;
  approvalNote: string | null;
  lastUpdated: string;
  lastUpdatedBy: string | null;
  completedAt: string | null;
  nextAction: string;
  documents: Array<{ name: string; at: string }>;
  comments: Array<{ at: string; by: string | null; body: string }>;
  audit: Array<{ at: string; by: string | null; action: string; detail: string | null }> | null;
  client: {
    id: string | null;
    name: string | null;
    rm: string | null;
    branch: string | null;
    panMasked: string | null;
    phone: string | null;
    email: string | null;
    openTasks: number;
    openQueries: number;
    transactions: Array<{ date: string | null; type: string; scheme: string | null; amount: number | null; status: string }>;
  } | null;
};

export async function loadOpsItemDetail(
  tx: Tx, w: OpsWindow, id: string, opts: { audit: boolean; contacts: boolean },
): Promise<OpsItemDetail | null> {
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT o.*, rmu.name AS rm_name, b.name AS branch_name,
           i.pan, i.phone, i.email,
           t.meta->>'boParticular' AS bo_particular
      FROM ops o
      JOIN tasks t ON t.id = o.id
      LEFT JOIN investors i ON i.id = o.investor_id
      LEFT JOIN users rmu ON rmu.id = o.rm_id
      LEFT JOIN branches b ON b.id = o.branch_id
     WHERE o.id = ${id}::uuid
  `)).rows[0] as Row | undefined;
  if (!r) return null;

  const comments = (await tx.execute(sql`
    SELECT c.created_at, u.name AS by, c.body
      FROM task_comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.task_id = ${id}::uuid AND c.deleted_at IS NULL
     ORDER BY c.created_at DESC LIMIT 20
  `)).rows as Row[];
  const docs = (await tx.execute(sql`
    SELECT a.file_name AS name, a.created_at FROM task_attachments a
     WHERE a.tenant_id = ${w.tenantId}::uuid AND a.task_id = ${id}::uuid AND a.deleted_at IS NULL
     ORDER BY a.created_at DESC LIMIT 10
  `)).rows as Row[];
  const audit = opts.audit ? (await tx.execute(sql`
    SELECT a.at, u.name AS by, a.action, a.before, a.after
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.tenant_id = ${w.tenantId}::uuid AND a.entity_type = 'task' AND a.entity_id = ${id}::uuid
     ORDER BY a.at DESC LIMIT 20
  `)).rows as Row[] : null;

  const investorId = str(r.investor_id);
  const client = investorId || r.client ? await (async () => {
    const counts = investorId ? (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM tasks tk WHERE tk.tenant_id = ${w.tenantId}::uuid AND tk.deleted_at IS NULL
           AND tk.status IN ('open', 'in_progress', 'blocked')
           AND (tk.related_investor_id = ${investorId}::uuid
                OR (tk.subject_type = 'investor' AND tk.subject_id = ${investorId}::uuid)))::int AS tasks,
        (SELECT COUNT(*) FROM service_requests sr WHERE sr.tenant_id = ${w.tenantId}::uuid
           AND sr.investor_id = ${investorId}::uuid AND sr.status IN ('open', 'in_progress', 'escalated', 'waiting_customer'))::int AS queries
    `)).rows[0] as Row | undefined : undefined;
    const txns = investorId ? (await tx.execute(sql`
      SELECT t.order_date::text AS date, t.type, t.scheme_name, t.amount::numeric AS amount, t.status
        FROM transactions t WHERE t.tenant_id = ${w.tenantId}::uuid AND t.investor_id = ${investorId}::uuid
       ORDER BY t.order_date DESC NULLS LAST LIMIT 5
    `)).rows as Row[] : [];
    const pan = str(r.pan);
    return {
      id: investorId,
      name: str(r.client),
      rm: str(r.rm_name),
      branch: str(r.branch_name),
      panMasked: pan ? (pan.length >= 10 ? `${pan.slice(0, 3)}••••${pan.slice(-2)}` : "••••••") : null,
      phone: opts.contacts ? str(r.phone) : null,
      email: opts.contacts ? str(r.email) : null,
      openTasks: num(counts?.tasks),
      openQueries: num(counts?.queries),
      transactions: txns.map((x) => ({
        date: str(x.date), type: feedTypeLabel(String(x.type)), scheme: str(x.scheme_name),
        amount: numOrNull(x.amount), status: humanise(String(x.status)),
      })),
    };
  })() : null;

  const status = r.approval_status === "pending" ? "awaiting_approval" : String(r.status);
  const lastComment = comments[0];
  const nextAction = !r.is_open ? "Nothing — this request is closed."
    : r.assignee_id == null ? "Assign it to someone in the team."
    : r.approval_status === "pending" ? "Approve or return it for correction."
    : r.status === "blocked" ? "Chase the dependency named in the remarks, then move it back to In process."
    : r.sla_state === "breached" ? "Past SLA — finish it or record why it is held up."
    : r.status === "open" ? "Start processing it."
    : "Complete it, or record what it is waiting on.";

  return {
    id: String(r.id),
    title: String(r.title ?? "Request"),
    kind: String(r.kind),
    kindLabel: KIND_LABEL[String(r.kind)] ?? "Other",
    amount: numOrNull(r.value),
    mode: str(r.mode),
    product: r.kind === "pms" || r.kind === "aif" || r.kind === "sif" || r.kind === "liquid" ? KIND_LABEL[String(r.kind)] : null,
    receivedAt: String(r.created_at),
    assigneeId: str(r.assignee_id),
    assignee: str(r.assignee),
    createdBy: str(r.created_by),
    status,
    statusLabel: STATUS_LABEL[status] ?? status,
    priorityLabel: PRIORITY_LABEL[String(r.priority ?? "normal")] ?? String(r.priority),
    slaDue: str(r.sla_due_at),
    slaState: String(r.sla_state),
    ageDays: num(r.age_days),
    pendingWith: r.pending_with ? PENDING_LABEL[String(r.pending_with)] ?? String(r.pending_with) : null,
    remarks: str(r.remarks),
    approvalNote: str(r.approval_note),
    lastUpdated: String(r.last_touch),
    lastUpdatedBy: lastComment && String(lastComment.created_at) >= String(r.updated_at) ? str(lastComment.by) : null,
    completedAt: str(r.completed_at),
    nextAction,
    documents: docs.map((d) => ({ name: String(d.name ?? "Document"), at: String(d.created_at) })),
    comments: comments.map((c) => ({ at: String(c.created_at), by: str(c.by), body: String(c.body ?? "") })),
    audit: audit ? audit.map((a) => ({
      at: String(a.at), by: str(a.by), action: String(a.action).replace(/^task\./, "").replace(/_/g, " "),
      detail: describeChange(a.before, a.after),
    })) : null,
    client,
  };
}

function describeChange(before: unknown, after: unknown): string | null {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (a.status && a.status !== b.status) parts.push(`status ${b.status ? `${String(b.status).replace(/_/g, " ")} → ` : ""}${String(a.status).replace(/_/g, " ")}`);
  if (a.assigneeId && a.assigneeId !== b.assigneeId) parts.push("reassigned");
  if (a.approvalAction) parts.push(`approval: ${String(a.approvalAction)}`);
  if (a.priority && a.priority !== b.priority) parts.push(`priority → ${String(a.priority)}`);
  return parts.length ? parts.join(" · ") : null;
}
