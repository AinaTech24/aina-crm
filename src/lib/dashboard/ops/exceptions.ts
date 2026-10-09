/**
 * Exceptions and dependencies (§13–16, §23–24, §28–35): documentation,
 * pending-with, external dependencies, rejected transactions, high-value
 * pending, client queries, data quality, unassigned and no-update records,
 * rework and quality indicators.
 *
 * Where the CRM has no field for something the brief asks about (a document
 * status, an internal-error reason, a rework flag), the loader returns null
 * and the page says so — it never counts an absent field as zero.
 */

import { sql } from "drizzle-orm";
import {
  assigneeFilter, clientScope, FINANCIAL_KINDS, inList, istDay, KIND_LABEL, num, numOrNull, opsBase, opsFilter, PENDING_LABEL,
  selfOnly, STATUS_LABEL, str, type OpsWindow, type Row, type Tx,
  rejectedInstructionKey,
} from "./window";

const SIP_OPEN = sql`('pending', 'client_contacted', 'bank_issue', 'mandate_issue')`;
const OPEN_SR = sql`('open', 'in_progress', 'escalated', 'waiting_customer')`;

const SR_TYPE_LABEL = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const FEED_TYPE_LABEL: Record<string, string> = {
  purchase: "Purchase", lumpsum: "Lumpsum", redemption: "Redemption", switch: "Switch", sip: "SIP instalment",
  sip_stop: "SIP stop", sip_pause: "SIP pause", stp: "STP", swp: "SWP",
  dividend_payout: "Dividend payout", dividend_reinvest: "Dividend reinvestment",
};
export const feedTypeLabel = (t: string) => FEED_TYPE_LABEL[t] ?? SR_TYPE_LABEL(t);

/* ───────────────────────────── §13 documentation ───────────────────────────── */

export type DocRow = { id: string; client: string | null; investorId: string | null; document: string; requested: string; pendingFrom: string | null; ageDays: number; assignee: string | null; breached: boolean };
export type DocDesk = { pending: number; receivedToday: number; beyondSla: number; rows: DocRow[]; more: number };

export async function loadDocs(tx: Tx, w: OpsWindow, limit = 20): Promise<DocDesk> {
  const c = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND kind = 'documentation')
    SELECT COUNT(*) FILTER (WHERE is_open)::int AS pending,
           COUNT(*) FILTER (WHERE status = 'completed' AND completed_day = ${w.today}::date)::int AS rec_today,
           COUNT(*) FILTER (WHERE is_open AND sla_state = 'breached')::int AS beyond
      FROM f
  `)).rows[0] as Row | undefined;
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT id, client, investor_id, title, created_at, pending_with, age_days, assignee, (sla_state = 'breached') AS breached,
           COUNT(*) OVER () AS total
      FROM ops WHERE ${opsFilter(w)} AND kind = 'documentation' AND is_open
     ORDER BY (sla_state = 'breached') DESC, created_at ASC LIMIT ${limit}
  `)).rows as Row[];
  return {
    pending: num(c?.pending), receivedToday: num(c?.rec_today), beyondSla: num(c?.beyond),
    rows: rows.map((r) => ({
      id: String(r.id), client: str(r.client), investorId: str(r.investor_id), document: String(r.title ?? "Document"),
      requested: String(r.created_at), pendingFrom: r.pending_with ? PENDING_LABEL[String(r.pending_with)] ?? null : null,
      ageDays: num(r.age_days), assignee: str(r.assignee), breached: r.breached === true,
    })),
    more: Math.max(0, (rows.length ? num(rows[0].total) : 0) - rows.length),
  };
}

/* ───────────────────────────── §14 pending-with · §32 external ───────────────────────────── */

export type PendingRow = { key: string; label: string; count: number; value: number | null; avgAgeDays: number | null; source: string; external: boolean };

export async function loadPendingWith(tx: Tx, w: OpsWindow): Promise<PendingRow[]> {
  const self = selfOnly(w);
  const ops = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT pending_with AS k, COUNT(*)::int AS n, SUM(value) AS v, COUNT(value)::int AS c, AVG(age_days) AS age
      FROM ops WHERE ${opsFilter(w)} AND is_open GROUP BY 1
  `)).rows as Row[];
  const sr = (await tx.execute(sql`
    SELECT (sr.status = 'waiting_customer') AS client, COUNT(*)::int AS n,
           AVG(${w.today}::date - ${istDay(sql`sr.created_at`)}) AS age
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
     WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status IN ${OPEN_SR} AND ${clientScope(w)}
       ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``}
     GROUP BY 1
  `)).rows as Row[];
  const sip = (await tx.execute(sql`
    SELECT s.recovery_status AS k, COUNT(*)::int AS n, COALESCE(SUM(s.rejection_amount::numeric), 0) AS v,
           AVG(${w.today}::date - s.rejection_date) AS age
      FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status IN ${SIP_OPEN} AND ${clientScope(w)}
       ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``}
     GROUP BY 1
  `)).rows as Row[];
  const feed = self ? undefined : (await tx.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(t.amount::numeric), 0) AS v,
           AVG(${w.today}::date - COALESCE(t.order_date, t.created_at::date)) AS age
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('pending', 'submitted')
  `)).rows[0] as Row | undefined;

  const o = (k: string) => ops.find((x) => x.k === k);
  const s = (k: string) => sip.find((x) => x.k === k);
  const avg = (parts: Array<{ n: number; age: number | null }>) => {
    const n = parts.reduce((a, p) => a + (p.age == null ? 0 : p.n), 0);
    return n > 0 ? parts.reduce((a, p) => a + (p.age == null ? 0 : p.n * p.age), 0) / n : null;
  };
  const srOps = sr.find((x) => x.client !== true);
  const srClient = sr.find((x) => x.client === true);
  const rows: PendingRow[] = [
    {
      key: "operations", label: "Operations", source: "requests held by the team, open service requests", external: false,
      count: num(o("operations")?.n) + num(srOps?.n), value: o("operations")?.v == null ? null : num(o("operations")?.v),
      avgAgeDays: avg([{ n: num(o("operations")?.n), age: numOrNull(o("operations")?.age) }, { n: num(srOps?.n), age: numOrNull(srOps?.age) }]),
    },
    {
      key: "rm", label: "Relationship manager", source: "requests held by an RM, unworked SIP rejections", external: false,
      count: num(o("rm")?.n) + num(s("pending")?.n),
      value: (o("rm")?.v == null ? 0 : num(o("rm")?.v)) + num(s("pending")?.v) || null,
      avgAgeDays: avg([{ n: num(o("rm")?.n), age: numOrNull(o("rm")?.age) }, { n: num(s("pending")?.n), age: numOrNull(s("pending")?.age) }]),
    },
    {
      key: "client", label: "Client", source: "service requests waiting on the client, SIP rejections with the client contacted", external: true,
      count: num(srClient?.n) + num(s("client_contacted")?.n), value: num(s("client_contacted")?.v) || null,
      avgAgeDays: avg([{ n: num(srClient?.n), age: numOrNull(srClient?.age) }, { n: num(s("client_contacted")?.n), age: numOrNull(s("client_contacted")?.age) }]),
    },
    {
      key: "platform", label: "AMC / platform", source: "feed transactions still pending or submitted", external: true,
      count: num(feed?.n), value: feed ? num(feed.v) : null, avgAgeDays: numOrNull(feed?.age),
    },
    {
      key: "bank", label: "Bank", source: "SIP rejections with a bank or mandate issue", external: true,
      count: num(s("bank_issue")?.n) + num(s("mandate_issue")?.n), value: num(s("bank_issue")?.v) + num(s("mandate_issue")?.v) || null,
      avgAgeDays: avg([{ n: num(s("bank_issue")?.n), age: numOrNull(s("bank_issue")?.age) }, { n: num(s("mandate_issue")?.n), age: numOrNull(s("mandate_issue")?.age) }]),
    },
    {
      key: "blocked", label: "Blocked — outside the team", source: "requests marked blocked (the reason is in the remarks)", external: true,
      count: num(o("blocked")?.n), value: o("blocked")?.v == null ? null : num(o("blocked")?.v), avgAgeDays: numOrNull(o("blocked")?.age),
    },
    {
      key: "approval", label: "Awaiting approval", source: "requests submitted and not yet signed off", external: false,
      count: num(o("approval")?.n), value: o("approval")?.v == null ? null : num(o("approval")?.v), avgAgeDays: numOrNull(o("approval")?.age),
    },
    {
      key: "other_team", label: "Another team", source: "requests held by someone outside operations and not an RM", external: false,
      count: num(o("other_team")?.n), value: o("other_team")?.v == null ? null : num(o("other_team")?.v), avgAgeDays: numOrNull(o("other_team")?.age),
    },
    {
      key: "unassigned", label: "Not assigned", source: "requests with nobody on them", external: false,
      count: num(o("unassigned")?.n), value: o("unassigned")?.v == null ? null : num(o("unassigned")?.v), avgAgeDays: numOrNull(o("unassigned")?.age),
    },
  ];
  return rows;
}

export type ExternalGroup = { key: string; label: string; count: number; amount: number | null; avgAgeDays: number | null; oldest: { label: string; days: number } | null };

export async function loadExternal(tx: Tx, w: OpsWindow): Promise<{ groups: ExternalGroup[]; platforms: Array<{ name: string; count: number; amount: number }> }> {
  const self = selfOnly(w);
  if (self) return { groups: [], platforms: [] };
  const feed = (await tx.execute(sql`
    SELECT COALESCE(t.exchange, 'Not recorded') AS platform, COUNT(*)::int AS n, COALESCE(SUM(t.amount::numeric), 0) AS v,
           AVG(${w.today}::date - COALESCE(t.order_date, t.created_at::date)) AS age,
           MAX(${w.today}::date - COALESCE(t.order_date, t.created_at::date))::int AS oldest,
           (ARRAY_AGG(i.name || ' · ' || COALESCE(t.scheme_name, t.type) ORDER BY COALESCE(t.order_date, t.created_at::date) ASC))[1] AS oldest_label
      FROM transactions t JOIN investors i ON i.id = t.investor_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('pending', 'submitted')
     GROUP BY 1 ORDER BY 2 DESC
  `)).rows as Row[];
  const bank = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(s.rejection_amount::numeric), 0) AS v,
           AVG(${w.today}::date - s.rejection_date) AS age, MAX(${w.today}::date - s.rejection_date)::int AS oldest,
           (ARRAY_AGG(i.name ORDER BY s.rejection_date ASC))[1] AS oldest_label
      FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status IN ('bank_issue', 'mandate_issue') AND ${clientScope(w)}
  `)).rows[0] as Row | undefined;
  const mand = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n, AVG(${w.today}::date - m.created_at::date) AS age,
           MAX(${w.today}::date - m.created_at::date)::int AS oldest,
           (SELECT COUNT(*) FROM mandates m2 WHERE m2.tenant_id = ${w.tenantId}::uuid)::int AS any_n
      FROM mandates m JOIN investors i ON i.id = m.investor_id
     WHERE m.tenant_id = ${w.tenantId}::uuid AND m.status = 'pending' AND ${clientScope(w)}
  `)).rows[0] as Row | undefined;
  const blocked = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT COUNT(*)::int AS n, SUM(value) AS v, AVG(age_days) AS age, MAX(age_days)::int AS oldest,
           (ARRAY_AGG(title ORDER BY created_at ASC))[1] AS oldest_label
      FROM ops WHERE ${opsFilter(w)} AND is_open AND pending_with = 'blocked'
  `)).rows[0] as Row | undefined;
  const feedN = feed.reduce((a, r) => a + num(r.n), 0);
  const feedOld = feed.reduce<Row | null>((a, r) => (a == null || num(r.oldest) > num(a.oldest) ? r : a), null);
  return {
    groups: [
      {
        key: "platform", label: "Pending with AMC / platform", count: feedN,
        amount: feedN ? feed.reduce((a, r) => a + num(r.v), 0) : null,
        avgAgeDays: feedN ? feed.reduce((a, r) => a + num(r.n) * num(r.age), 0) / feedN : null,
        oldest: feedOld ? { label: String(feedOld.oldest_label ?? ""), days: num(feedOld.oldest) } : null,
      },
      {
        key: "bank", label: "Pending with bank (SIP bounce)", count: num(bank?.n), amount: num(bank?.n) ? num(bank?.v) : null,
        avgAgeDays: numOrNull(bank?.age), oldest: num(bank?.n) ? { label: String(bank?.oldest_label ?? ""), days: num(bank?.oldest) } : null,
      },
      {
        key: "mandate", label: "Mandate registration pending", count: num(mand?.n), amount: null,
        avgAgeDays: numOrNull(mand?.age), oldest: num(mand?.n) ? { label: "Oldest mandate", days: num(mand?.oldest) } : null,
      },
      {
        key: "other", label: "Other dependency (blocked requests)", count: num(blocked?.n),
        amount: blocked?.v == null ? null : num(blocked.v), avgAgeDays: numOrNull(blocked?.age),
        oldest: num(blocked?.n) ? { label: String(blocked?.oldest_label ?? ""), days: num(blocked?.oldest) } : null,
      },
    ].filter((g) => g.key !== "mandate" || num(mand?.any_n) > 0),
    platforms: feed.map((r) => ({ name: String(r.platform), count: num(r.n), amount: num(r.v) })),
  };
}

/* ───────────────────────────── §15 rejected transactions ───────────────────────────── */

export type RejectedRow = {
  id: string; investorId: string; client: string; rm: string | null; branch: string | null; type: string;
  scheme: string | null; amount: number | null; reason: string | null; date: string | null;
  resolution: string | null; assignedTo: string | null;
  /** The instruction this leg belongs to (a short opaque reference) and how many rejected legs it has — 2 for an STP. */
  instructionRef: string; legsInInstruction: number; direction: string | null;
};
export type RejectedDesk = {
  /** Rejected LEGS (one per transaction row) and their gross amount — an STP's two legs are two legs. */
  total: number; purchase: number; sip: number; redemption: number; other: number; value: number; reasonMissing: number;
  /** Unique rejected INSTRUCTIONS: an STP's source and destination legs are one instruction (rejectedInstructionKey). */
  instructions: number; instructionValue: number;
  rows: RejectedRow[]; more: number;
};

export async function loadRejected(tx: Tx, w: OpsWindow, limit = 25): Promise<RejectedDesk | null> {
  if (selfOnly(w)) return null;
  const where = sql`t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('rejected', 'failed')
                    AND t.order_date BETWEEN ${w.from}::date AND ${w.to}::date`;
  const c = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE t.type IN ('purchase', 'lumpsum'))::int AS purchase,
           COUNT(*) FILTER (WHERE t.type = 'sip')::int AS sip,
           COUNT(*) FILTER (WHERE t.type = 'redemption')::int AS redemption,
           COALESCE(SUM(t.amount::numeric), 0) AS v,
           COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(t.reason_description, '')), '') IS NULL)::int AS no_reason
      FROM transactions t JOIN investors i ON i.id = t.investor_id WHERE ${where}
  `)).rows[0] as Row | undefined;
  const ins = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(v), 0) AS v FROM (
      SELECT ${rejectedInstructionKey("t")} AS k, MAX(abs(t.amount::numeric)) AS v
        FROM transactions t JOIN investors i ON i.id = t.investor_id WHERE ${where} GROUP BY 1) x
  `)).rows[0] as Row | undefined;
  const rows = (await tx.execute(sql`
    SELECT t.id, t.investor_id, i.name AS client, rmu.name AS rm, b.name AS branch, t.type, t.scheme_name,
           t.amount::numeric AS amount, NULLIF(btrim(COALESCE(t.reason_description, '')), '') AS reason,
           t.order_date::text AS date, sr.recovery_status, au.name AS assigned_to, t.direction,
           left(md5(${rejectedInstructionKey("t")}), 10) AS iref,
           COUNT(*) OVER (PARTITION BY ${rejectedInstructionKey("t")}) AS legs,
           COUNT(*) OVER () AS total
      FROM transactions t
      JOIN investors i ON i.id = t.investor_id
      LEFT JOIN users rmu ON rmu.id = i.rm_id
      LEFT JOIN branches b ON b.id = i.branch_id
      LEFT JOIN sip_rejections sr ON sr.transaction_id = t.id
      LEFT JOIN users au ON au.id = sr.assigned_rm_id
     WHERE ${where}
     ORDER BY t.order_date DESC NULLS LAST, t.amount DESC NULLS LAST
     LIMIT ${limit}
  `)).rows as Row[];
  const n = num(c?.n);
  const RECOVERY: Record<string, string> = {
    pending: "Not yet worked", client_contacted: "Client contacted", bank_issue: "Bank issue", mandate_issue: "Mandate issue",
    reprocessed: "Repurchase initiated", recovered: "Recovered", not_recoverable: "Not recoverable",
  };
  return {
    total: n, purchase: num(c?.purchase), sip: num(c?.sip), redemption: num(c?.redemption),
    other: n - num(c?.purchase) - num(c?.sip) - num(c?.redemption), value: num(c?.v), reasonMissing: num(c?.no_reason),
    instructions: num(ins?.n), instructionValue: num(ins?.v),
    rows: rows.map((r) => ({
      id: String(r.id), investorId: String(r.investor_id), client: String(r.client ?? "—"), rm: str(r.rm), branch: str(r.branch),
      type: feedTypeLabel(String(r.type)), scheme: str(r.scheme_name), amount: numOrNull(r.amount), reason: str(r.reason),
      date: str(r.date), resolution: r.recovery_status ? RECOVERY[String(r.recovery_status)] ?? String(r.recovery_status) : null,
      assignedTo: str(r.assigned_to), instructionRef: String(r.iref), legsInInstruction: num(r.legs), direction: str(r.direction),
    })),
    more: Math.max(0, (rows.length ? num(rows[0].total) : 0) - rows.length),
  };
}

/* ───────────────────────────── §16 high-value pending ───────────────────────────── */

export type HighValueRow = { key: string; source: string; href: string; client: string | null; investorId: string | null; rm: string | null; what: string; amount: number; entered: string | null; ageDays: number | null; status: string; pendingWith: string };

export async function loadHighValue(tx: Tx, w: OpsWindow, threshold: number): Promise<HighValueRow[]> {
  const self = selfOnly(w);
  const ops = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT o.id, o.client, o.investor_id, rmu.name AS rm, o.title, o.kind, o.value, o.created_at, o.age_days,
           o.status, o.approval_status, o.pending_with
      FROM ops o LEFT JOIN users rmu ON rmu.id = o.rm_id
     WHERE ${opsFilter(w, "o")} AND o.is_open AND o.value >= ${threshold}
  `)).rows as Row[];
  const feed = self ? [] : (await tx.execute(sql`
    SELECT t.id, i.name AS client, t.investor_id, rmu.name AS rm, t.type, t.scheme_name, t.amount::numeric AS amount,
           t.order_date::text AS entered, (${w.today}::date - COALESCE(t.order_date, t.created_at::date))::int AS age, t.status
      FROM transactions t JOIN investors i ON i.id = t.investor_id LEFT JOIN users rmu ON rmu.id = i.rm_id
     WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('pending', 'submitted')
       AND t.amount::numeric >= ${threshold}
  `)).rows as Row[];
  const sip = (await tx.execute(sql`
    SELECT s.id, i.name AS client, s.investor_id, rmu.name AS rm, s.scheme_name, s.rejection_amount::numeric AS amount,
           s.rejection_date::text AS entered, (${w.today}::date - s.rejection_date)::int AS age, s.recovery_status
      FROM sip_rejections s JOIN investors i ON i.id = s.investor_id LEFT JOIN users rmu ON rmu.id = i.rm_id
     WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND s.recovery_status IN ${SIP_OPEN}
       AND s.rejection_amount::numeric >= ${threshold}
       ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``}
  `)).rows as Row[];
  const SIP_WITH: Record<string, string> = { pending: "Relationship manager", client_contacted: "Client", bank_issue: "Bank", mandate_issue: "Bank" };
  const out: HighValueRow[] = [
    ...ops.map((r) => ({
      key: `task:${r.id}`, source: "Request", href: `/dashboard/tasks?task=${r.id}`,
      client: str(r.client), investorId: str(r.investor_id), rm: str(r.rm),
      what: `${KIND_LABEL[String(r.kind)] ?? "Request"} — ${String(r.title ?? "")}`, amount: num(r.value),
      entered: str(r.created_at), ageDays: numOrNull(r.age_days),
      status: STATUS_LABEL[r.approval_status === "pending" ? "awaiting_approval" : String(r.status)] ?? String(r.status),
      pendingWith: r.pending_with ? PENDING_LABEL[String(r.pending_with)] ?? String(r.pending_with) : "—",
    })),
    ...feed.map((r) => ({
      key: `txn:${r.id}`, source: "Feed transaction", href: `/dashboard/investors/${r.investor_id}`,
      client: str(r.client), investorId: str(r.investor_id), rm: str(r.rm),
      what: `${feedTypeLabel(String(r.type))}${r.scheme_name ? ` — ${r.scheme_name}` : ""}`, amount: num(r.amount),
      entered: str(r.entered), ageDays: numOrNull(r.age), status: String(r.status) === "submitted" ? "Submitted" : "Pending",
      pendingWith: "AMC / platform",
    })),
    ...sip.map((r) => ({
      key: `sip:${r.id}`, source: "SIP rejection", href: `/dashboard/sip-rejections?q=${encodeURIComponent(String(r.client ?? ""))}`,
      client: str(r.client), investorId: str(r.investor_id), rm: str(r.rm),
      what: `SIP bounce${r.scheme_name ? ` — ${r.scheme_name}` : ""}`, amount: num(r.amount),
      entered: str(r.entered), ageDays: numOrNull(r.age), status: "Open",
      pendingWith: SIP_WITH[String(r.recovery_status)] ?? "—",
    })),
  ];
  return out.sort((a, b) => b.amount - a.amount).slice(0, 30);
}

/* ───────────────────────────── §23–24 service requests (client queries) ───────────────────────────── */

export type QueryRow = { id: string; ticket: string | null; client: string | null; investorId: string | null; rm: string | null; type: string; created: string; assignee: string | null; ageDays: number; status: string; slaDue: string | null; breached: boolean; remarks: string | null };
export type QueryDesk = {
  receivedToday: number; open: number; solvedToday: number; overdue: number; avgResolutionDays: number | null; oldestDays: number | null;
  rows: QueryRow[]; more: number;
  ageing: Array<{ key: string; label: string; count: number; topType: string | null; owner: string | null }>;
};

export async function loadQueries(tx: Tx, w: OpsWindow, limit = 25): Promise<QueryDesk> {
  const self = selfOnly(w);
  // The executive filter and RM "Me" reach this register too: it records who a request is assigned to.
  const assignee = assigneeFilter(w.filter, sql`sr.assigned_to_user_id`);
  const where = sql`sr.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)}
                    ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``}
                    ${assignee ? sql`AND ${assignee}` : sql``}`;
  const c = (await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${istDay(sql`sr.created_at`)} = ${w.today}::date)::int AS rec_today,
      COUNT(*) FILTER (WHERE sr.status IN ${OPEN_SR})::int AS open_n,
      COUNT(*) FILTER (WHERE sr.resolved_at IS NOT NULL AND ${istDay(sql`sr.resolved_at`)} = ${w.today}::date)::int AS solved_today,
      COUNT(*) FILTER (WHERE sr.status IN ${OPEN_SR} AND sr.sla_resolution_at < now())::int AS overdue,
      AVG(EXTRACT(EPOCH FROM (sr.resolved_at - sr.created_at)) / 86400.0)
        FILTER (WHERE sr.resolved_at IS NOT NULL AND ${istDay(sql`sr.resolved_at`)} BETWEEN ${w.from}::date AND ${w.to}::date) AS avg_days,
      MAX(${w.today}::date - ${istDay(sql`sr.created_at`)}) FILTER (WHERE sr.status IN ${OPEN_SR})::int AS oldest
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id WHERE ${where}
  `)).rows[0] as Row | undefined;
  const rows = (await tx.execute(sql`
    SELECT sr.id, sr.ticket_no, i.name AS client, sr.investor_id, rmu.name AS rm, sr.type, sr.created_at, au.name AS assignee,
           (${w.today}::date - ${istDay(sql`sr.created_at`)})::int AS age, sr.status, sr.sla_resolution_at,
           (sr.sla_resolution_at < now()) AS breached, NULLIF(btrim(COALESCE(sr.remarks, '')), '') AS remarks,
           COUNT(*) OVER () AS total
      FROM service_requests sr
      LEFT JOIN investors i ON i.id = sr.investor_id
      LEFT JOIN users rmu ON rmu.id = i.rm_id
      LEFT JOIN users au ON au.id = sr.assigned_to_user_id
     WHERE ${where} AND sr.status IN ${OPEN_SR}
     ORDER BY (sr.sla_resolution_at < now()) DESC, sr.created_at ASC LIMIT ${limit}
  `)).rows as Row[];
  const age = (await tx.execute(sql`
    SELECT CASE WHEN a <= 0 THEN 'q0' WHEN a <= 2 THEN 'q1' WHEN a <= 5 THEN 'q3' WHEN a <= 7 THEN 'q6' WHEN a <= 15 THEN 'q8' ELSE 'q16' END AS b,
           COUNT(*)::int AS n, MODE() WITHIN GROUP (ORDER BY type) AS top_type, MODE() WITHIN GROUP (ORDER BY assignee) AS owner
      FROM (SELECT (${w.today}::date - ${istDay(sql`sr.created_at`)}) AS a, sr.type, au.name AS assignee
              FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
              LEFT JOIN users au ON au.id = sr.assigned_to_user_id
             WHERE ${where} AND sr.status IN ${OPEN_SR}) x
     GROUP BY 1
  `)).rows as Row[];
  const BUCKETS = [
    { key: "q0", label: "Same day" }, { key: "q1", label: "1–2 days" }, { key: "q3", label: "3–5 days" },
    { key: "q6", label: "6–7 days" }, { key: "q8", label: "8–15 days" }, { key: "q16", label: "Over 15 days" },
  ];
  const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", escalated: "Escalated", waiting_customer: "Waiting on client" };
  return {
    receivedToday: num(c?.rec_today), open: num(c?.open_n), solvedToday: num(c?.solved_today), overdue: num(c?.overdue),
    avgResolutionDays: numOrNull(c?.avg_days), oldestDays: numOrNull(c?.oldest),
    rows: rows.map((r) => ({
      id: String(r.id), ticket: str(r.ticket_no), client: str(r.client), investorId: str(r.investor_id), rm: str(r.rm),
      type: SR_TYPE_LABEL(String(r.type ?? "other")), created: String(r.created_at), assignee: str(r.assignee),
      ageDays: num(r.age), status: STATUS[String(r.status)] ?? String(r.status), slaDue: str(r.sla_resolution_at),
      breached: r.breached === true, remarks: str(r.remarks),
    })),
    more: Math.max(0, (rows.length ? num(rows[0].total) : 0) - rows.length),
    ageing: BUCKETS.map((b) => {
      const r = age.find((x) => x.b === b.key);
      return { key: b.key, label: b.label, count: num(r?.n), topType: r?.top_type ? SR_TYPE_LABEL(String(r.top_type)) : null, owner: str(r?.owner) };
    }),
  };
}

/* ───────────────────────────── §28–30 data quality · unassigned ───────────────────────────── */

export type QualityCard = { key: string; label: string; count: number | null; note: string; href?: string };

export async function loadOpsDataQuality(tx: Tx, w: OpsWindow): Promise<QualityCard[]> {
  const self = selfOnly(w);
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND is_open)
    SELECT
      COUNT(*) FILTER (WHERE NOT has_remarks)::int AS no_remarks,
      COUNT(*) FILTER (WHERE assignee_id IS NULL)::int AS unassigned,
      COUNT(*) FILTER (WHERE kind IN (${inList(FINANCIAL_KINDS)}) AND value IS NULL)::int AS no_amount,
      COUNT(*) FILTER (WHERE kind IN (${inList(FINANCIAL_KINDS)}) AND investor_id IS NULL AND lead_id IS NULL)::int AS no_client,
      COUNT(*) FILTER (WHERE investor_id IS NOT NULL AND rm_id IS NULL)::int AS no_rm,
      COUNT(*) FILTER (WHERE branch_id IS NULL)::int AS no_branch
    FROM f
  `)).rows[0] as Row | undefined;
  const x = self ? undefined : (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM transactions t JOIN investors i ON i.id = t.investor_id
        WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.status IN ('rejected', 'failed')
          AND NULLIF(btrim(COALESCE(t.reason_description, '')), '') IS NULL)::int
      + (SELECT COUNT(*) FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
          WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND s.reason_category IS NULL
            AND NULLIF(btrim(COALESCE(s.rejection_reason, '')), '') IS NULL)::int AS no_reason,
      (SELECT COUNT(*) FROM transactions t JOIN investors i ON i.id = t.investor_id
        WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.order_date IS NULL)::int AS no_date,
      (SELECT COUNT(*) FROM (
         SELECT 1 FROM transactions t JOIN investors i ON i.id = t.investor_id
          WHERE t.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND t.order_date IS NOT NULL
          GROUP BY t.investor_id, t.scheme_code, t.order_date, t.type, t.amount
         HAVING COUNT(*) > 1) d)::int AS dupes
  `)).rows[0] as Row | undefined;
  return [
    { key: "no_remarks", label: "Remarks missing", count: num(r?.no_remarks), note: "Open requests with no remark and no comment.", href: "#queue" },
    { key: "no_reason", label: "Rejection reason missing", count: x ? num(x.no_reason) : null, note: "Feed rejections and SIP bounces with no reason recorded.", href: "#rejected" },
    { key: "unassigned", label: "Assigned to missing", count: num(r?.unassigned), note: "Open requests with nobody assigned.", href: "#unassigned" },
    { key: "no_date", label: "Transaction date missing", count: x ? num(x.no_date) : null, note: "Feed transactions with no order date." },
    { key: "no_amount", label: "Amount not recorded", count: num(r?.no_amount), note: "Open transaction requests with no value on the request." },
    { key: "no_client", label: "Client mapping missing", count: num(r?.no_client), note: "Open transaction requests linked to no client or lead." },
    { key: "no_rm", label: "RM mapping missing", count: num(r?.no_rm), note: "Open requests whose client has no RM." },
    { key: "no_branch", label: "Branch missing", count: num(r?.no_branch), note: "Open requests with no branch on the client or the assignee." },
    { key: "dupes", label: "Possible duplicate feed entries", count: x ? num(x.dupes) : null, note: "Same client, scheme, date, type and amount more than once." },
  ];
}

export type MasterGap = { key: string; label: string; count: number; href: string; required: boolean };

/** §29 — client master fields. Only PAN, mobile, email, DOB and category are required for operations; the rest are listed, not scored. */
export async function loadClientMaster(tx: Tx, w: OpsWindow): Promise<{ clients: number; gaps: MasterGap[] } | null> {
  if (selfOnly(w)) return null;
  const r = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(i.pan, '')), '') IS NULL)::int AS pan,
           COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(i.phone, '')), '') IS NULL)::int AS phone,
           COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(i.email, '')), '') IS NULL)::int AS email,
           COUNT(*) FILTER (WHERE i.dob IS NULL)::int AS dob,
           COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(i.client_category, '')), '') IS NULL)::int AS category,
           COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(i.occupation, '')), '') IS NULL)::int AS occupation,
           COUNT(*) FILTER (WHERE NULLIF(btrim(COALESCE(i.employer_name, '')), '') IS NULL)::int AS employer,
           COUNT(*) FILTER (WHERE i.family_id IS NULL)::int AS family
      FROM investors i
     WHERE i.tenant_id = ${w.tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND i.status <> 'closed' AND ${clientScope(w)}
  `)).rows[0] as Row | undefined;
  const q = (extra: string) => {
    const p = new URLSearchParams(extra);
    if (w.scope.kind === "branch") p.set("branch", w.scope.branchId);
    // The clients list reads a comma-separated branch list too, so its rows are the counted ones.
    if (w.filter.branchIds?.length) p.set("branch", w.filter.branchIds.join(","));
    return `/dashboard/investors?${p.toString()}`;
  };
  return {
    clients: num(r?.n),
    gaps: [
      { key: "pan", label: "PAN missing", count: num(r?.pan), href: q("gaps=pan"), required: true },
      { key: "phone", label: "Mobile missing", count: num(r?.phone), href: q("gaps=phone"), required: true },
      { key: "email", label: "Email missing", count: num(r?.email), href: q("gaps=email"), required: true },
      { key: "dob", label: "Date of birth missing", count: num(r?.dob), href: q("gaps=dob"), required: true },
      { key: "category", label: "Category missing", count: num(r?.category), href: q("category=none"), required: true },
      { key: "occupation", label: "Profession missing", count: num(r?.occupation), href: q("gaps=occupation"), required: false },
      { key: "employer", label: "Company name missing", count: num(r?.employer), href: q("gaps=employer"), required: false },
      { key: "family", label: "Family mapping missing", count: num(r?.family), href: "/dashboard/families/unmapped", required: false },
    ],
  };
}

export type Unassigned = { transactions: number; tasks: number; queries: number; documentation: number; sipRejections: number };

export async function loadUnassigned(tx: Tx, w: OpsWindow): Promise<Unassigned> {
  const self = selfOnly(w);
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)} AND is_open AND assignee_id IS NULL)
    SELECT COUNT(*) FILTER (WHERE kind IN (${inList(FINANCIAL_KINDS)}))::int AS txn,
           COUNT(*) FILTER (WHERE kind NOT IN (${inList(FINANCIAL_KINDS)}) AND kind <> 'documentation')::int AS tasks,
           COUNT(*) FILTER (WHERE kind = 'documentation')::int AS docs
      FROM f
  `)).rows[0] as Row | undefined;
  const x = self ? undefined : (await tx.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id
        WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status IN ${OPEN_SR} AND sr.assigned_to_user_id IS NULL AND ${clientScope(w)})::int AS q,
      (SELECT COUNT(*) FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
        WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status IN ${SIP_OPEN} AND s.assigned_rm_id IS NULL AND ${clientScope(w)})::int AS sip
  `)).rows[0] as Row | undefined;
  return { transactions: num(r?.txn), tasks: num(r?.tasks), documentation: num(r?.docs), queries: num(x?.q), sipRejections: num(x?.sip) };
}

/* ───────────────────────────── §31 no-update records ───────────────────────────── */

const SR_STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", escalated: "Escalated", waiting_customer: "Waiting on client",
};
const SIP_STATUS_LABEL: Record<string, string> = {
  pending: "Not yet worked", client_contacted: "Client contacted", bank_issue: "Bank issue", mandate_issue: "Mandate issue",
};

export type StaleRow = { key: string; record: string; href: string; client: string | null; owner: string | null; status: string; lastUpdated: string; days: number };

export async function loadNoUpdate(tx: Tx, w: OpsWindow, days: number): Promise<{ rows: StaleRow[]; total: number }> {
  const self = selfOnly(w);
  const ops = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT id, title, client, assignee, status, approval_status, last_touch,
           (${w.today}::date - ${istDay(sql`last_touch`)})::int AS d
      FROM ops WHERE ${opsFilter(w)} AND is_open AND last_touch < now() - (${days} || ' days')::interval
  `)).rows as Row[];
  const sr = (await tx.execute(sql`
    SELECT sr.id, COALESCE(sr.ticket_no, 'Service request') || ' — ' || replace(sr.type, '_', ' ') AS title, i.name AS client, au.name AS assignee,
           sr.status, sr.updated_at, (${w.today}::date - ${istDay(sql`sr.updated_at`)})::int AS d
      FROM service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id LEFT JOIN users au ON au.id = sr.assigned_to_user_id
     WHERE sr.tenant_id = ${w.tenantId}::uuid AND sr.status IN ${OPEN_SR} AND ${clientScope(w)}
       AND sr.updated_at < now() - (${days} || ' days')::interval
       ${self ? sql`AND sr.assigned_to_user_id = ${self}::uuid` : sql``}
  `)).rows as Row[];
  const sip = (await tx.execute(sql`
    SELECT s.id, 'SIP bounce' || COALESCE(' — ' || s.scheme_name, '') AS title, i.name AS client, au.name AS assignee,
           s.recovery_status AS status, s.updated_at, (${w.today}::date - ${istDay(sql`s.updated_at`)})::int AS d
      FROM sip_rejections s JOIN investors i ON i.id = s.investor_id LEFT JOIN users au ON au.id = s.assigned_rm_id
     WHERE s.tenant_id = ${w.tenantId}::uuid AND s.recovery_status IN ${SIP_OPEN} AND ${clientScope(w)}
       AND s.updated_at < now() - (${days} || ' days')::interval
       ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``}
  `)).rows as Row[];
  const all: StaleRow[] = [
    ...ops.map((r) => ({
      key: `task:${r.id}`, record: String(r.title ?? "Request"), href: `/dashboard/tasks?task=${r.id}`, client: str(r.client),
      owner: str(r.assignee), status: STATUS_LABEL[r.approval_status === "pending" ? "awaiting_approval" : String(r.status)] ?? String(r.status),
      lastUpdated: String(r.last_touch), days: num(r.d),
    })),
    ...sr.map((r) => ({
      key: `sr:${r.id}`, record: String(r.title), href: `/dashboard/service-requests/${r.id}`, client: str(r.client),
      owner: str(r.assignee), status: SR_STATUS_LABEL[String(r.status)] ?? String(r.status), lastUpdated: String(r.updated_at), days: num(r.d),
    })),
    ...sip.map((r) => ({
      key: `sip:${r.id}`, record: String(r.title), href: `/dashboard/sip-rejections?q=${encodeURIComponent(String(r.client ?? ""))}`,
      client: str(r.client), owner: str(r.assignee), status: SIP_STATUS_LABEL[String(r.status)] ?? String(r.status),
      lastUpdated: String(r.updated_at), days: num(r.d),
    })),
  ].sort((a, b) => b.days - a.days);
  return { rows: all.slice(0, 40), total: all.length };
}

/* ───────────────────────────── §34–35 rework · quality ───────────────────────────── */

export type Rework = {
  returned: number; returnedRows: Array<{ id: string; title: string; reason: string | null; owner: string | null }>;
  reprocessed: number;
};
export type QualityIndicator = { key: string; label: string; value: number | null; definition: string; base: number };

export async function loadRework(tx: Tx, w: OpsWindow): Promise<{ rework: Rework; indicators: QualityIndicator[] }> {
  const self = selfOnly(w);
  const r = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)}), f AS (SELECT * FROM ops WHERE ${opsFilter(w)})
    SELECT
      COUNT(*) FILTER (WHERE approval_note IS NOT NULL AND received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS returned,
      COUNT(*) FILTER (WHERE submitted_at IS NOT NULL AND received_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS submitted,
      COUNT(*) FILTER (WHERE status = 'completed' AND requires_approval AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS appr_done,
      COUNT(*) FILTER (WHERE status = 'completed' AND requires_approval AND approval_note IS NULL
                         AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS first_time,
      COUNT(*) FILTER (WHERE status = 'completed' AND sla_due_at IS NOT NULL AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS sla_base,
      COUNT(*) FILTER (WHERE status = 'completed' AND sla_due_at IS NOT NULL AND completed_at <= sla_due_at
                         AND completed_day BETWEEN ${w.from}::date AND ${w.to}::date)::int AS sla_in,
      COUNT(*) FILTER (WHERE is_open)::int AS open_n,
      COUNT(*) FILTER (WHERE is_open AND has_remarks)::int AS with_remarks
    FROM f
  `)).rows[0] as Row | undefined;
  const rows = (await tx.execute(sql`
    WITH ops AS (${opsBase(w)})
    SELECT id, title, approval_note, assignee FROM ops
     WHERE ${opsFilter(w)} AND approval_note IS NOT NULL AND received_day BETWEEN ${w.from}::date AND ${w.to}::date
     ORDER BY updated_at DESC LIMIT 10
  `)).rows as Row[];
  const rep = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM sip_rejections s JOIN investors i ON i.id = s.investor_id
     WHERE s.tenant_id = ${w.tenantId}::uuid AND ${clientScope(w)} AND s.recovery_status IN ('reprocessed', 'recovered')
       AND ${istDay(sql`COALESCE(s.status_changed_at, s.updated_at)`)} BETWEEN ${w.from}::date AND ${w.to}::date
       ${self ? sql`AND s.assigned_rm_id = ${self}::uuid` : sql``}
  `)).rows[0] as Row | undefined;
  const pct = (a: unknown, b: unknown) => (num(b) > 0 ? num(a) / num(b) : null);
  return {
    rework: {
      returned: num(r?.returned),
      returnedRows: rows.map((x) => ({ id: String(x.id), title: String(x.title ?? "Request"), reason: str(x.approval_note), owner: str(x.assignee) })),
      reprocessed: num(rep?.n),
    },
    indicators: [
      { key: "first_time", label: "First-time processing", value: pct(r?.first_time, r?.appr_done), base: num(r?.appr_done),
        definition: "Requests completed through approval without once being returned for correction ÷ all completed through approval." },
      { key: "sla", label: "SLA compliance", value: pct(r?.sla_in, r?.sla_base), base: num(r?.sla_base),
        definition: "Completed on or before the SLA due time ÷ completed requests that had an SLA." },
      { key: "rework", label: "Rework", value: pct(r?.returned, r?.submitted), base: num(r?.submitted),
        definition: "Returned for correction ÷ submitted for approval, among requests received in the period." },
      { key: "remarks", label: "Records with remarks", value: pct(r?.with_remarks, r?.open_n), base: num(r?.open_n),
        definition: "Open requests carrying a remark or a comment ÷ all open requests." },
    ],
  };
}
