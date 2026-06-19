/**
 * Calendar aggregation — the single source of truth for "what's on the
 * calendar" across tasks, lead follow-ups, client reviews, SIP debits,
 * campaigns and compliance expiries.
 *
 * Both the in-app calendar page and the ICS subscription feed call this so the
 * two can never drift (they previously duplicated six near-identical queries
 * with different windows + filters). SERVER-ONLY (runs inside a withTenant tx).
 *
 * Scoping: non-managers only see their OWN book — own tasks (assignee/creator),
 * own leads (owner), own clients (rm). RLS isolates by tenant; this layer adds
 * the per-user slice the rest of the app enforces. Managers (the relevant
 * *.view.all capability) see the whole firm.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type CalendarKind = "task" | "follow_up" | "review" | "sip" | "campaign" | "compliance";

export type CalendarItem = {
  /** Stable id (source row id, namespaced) — drives a deterministic ICS UID. */
  id: string;
  kind: CalendarKind;
  /** YYYY-MM-DD (for the month grid + all-day ICS events). */
  date: string;
  /** ISO datetime when the event has a real clock time; null = all-day. */
  at: string | null;
  title: string;
  meta?: string;
  href: string;
  description?: string;
  subjectType?: "investor" | "lead";
  subjectId?: string;
  avatarUrl?: string | null;
  personName?: string;
};

export type CalendarScope = {
  userId: string;
  /** can(roles, "task.view.all") */
  tasksAll: boolean;
  /** can(roles, "lead.view.all") */
  leadsAll: boolean;
  /** can(roles, "investor.view.all") — also gates compliance (NISM/KYC). */
  investorsAll: boolean;
};

/** Normalise a pg date/timestamp value to YYYY-MM-DD. */
const ymd = (v: any): string =>
  typeof v === "string" ? v.slice(0, 10) : v ? new Date(v).toISOString().slice(0, 10) : "";

/** Normalise to an ISO datetime string, or null. */
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);

export async function getCalendarItems(
  tx: Tx,
  opts: { fromIso: string; toIso: string; scope: CalendarScope }
): Promise<CalendarItem[]> {
  const { fromIso, toIso, scope } = opts;

  // Per-source ownership predicates (empty for managers).
  const taskScope = scope.tasksAll
    ? sql``
    : sql` AND (assignee_id = ${scope.userId}::uuid OR created_by_id = ${scope.userId}::uuid)`;
  const leadScope = scope.leadsAll ? sql`` : sql` AND owner_id = ${scope.userId}::uuid`;
  const invScope = scope.investorsAll ? sql`` : sql` AND rm_id = ${scope.userId}::uuid`;
  const sipScope = scope.investorsAll ? sql`` : sql` AND i.rm_id = ${scope.userId}::uuid`;
  const nismScope = scope.investorsAll ? sql`` : sql` AND id = ${scope.userId}::uuid`;
  const kycScope = scope.investorsAll ? sql`` : sql` AND rm_id = ${scope.userId}::uuid`;

  const [tasks, leads, reviews, sips, campaigns, compliance] = await Promise.all([
    tx.execute(sql`
      SELECT id, title, description, due_at, due_at::date AS d, priority
      FROM tasks
      WHERE due_at IS NOT NULL
        AND due_at::date >= ${fromIso} AND due_at::date <= ${toIso}
        AND status NOT IN ('completed', 'cancelled')${taskScope}
      ORDER BY due_at ASC LIMIT 500
    `),
    tx.execute(sql`
      SELECT id, name, avatar_url, next_follow_up_at::date AS d, stage
      FROM leads
      WHERE next_follow_up_at IS NOT NULL
        AND next_follow_up_at::date >= ${fromIso} AND next_follow_up_at::date <= ${toIso}
        AND converted_investor_id IS NULL AND stage NOT IN ('lost')${leadScope}
      LIMIT 500
    `),
    tx.execute(sql`
      SELECT id, name, avatar_url, next_review_at::date AS d, segment_tag
      FROM investors
      WHERE next_review_at IS NOT NULL
        AND next_review_at::date >= ${fromIso} AND next_review_at::date <= ${toIso}${invScope}
      LIMIT 500
    `),
    tx.execute(sql`
      SELECT s.id, s.scheme_name, s.amount, s.next_installment_at::date AS d,
             i.id AS investor_id, i.name AS investor_name, i.avatar_url AS investor_avatar_url
      FROM sips s LEFT JOIN investors i ON i.id = s.investor_id
      WHERE s.status = 'active' AND s.next_installment_at IS NOT NULL
        AND s.next_installment_at::date >= ${fromIso} AND s.next_installment_at::date <= ${toIso}${sipScope}
      LIMIT 500
    `),
    tx.execute(sql`
      SELECT id, name, scheduled_at, scheduled_at::date AS d, channel, status
      FROM campaigns
      WHERE scheduled_at IS NOT NULL
        AND scheduled_at::date >= ${fromIso} AND scheduled_at::date <= ${toIso}
      LIMIT 200
    `),
    tx.execute(sql`
      SELECT 'arn' AS ckind, t.id::text AS id, t.arn AS who, t.arn_expiry_at AS d
      FROM tenants t WHERE t.arn_expiry_at IS NOT NULL
        AND t.arn_expiry_at >= ${fromIso}::date AND t.arn_expiry_at <= ${toIso}::date
      UNION ALL
      SELECT 'nism', id::text, name, nism_expiry_at::date
      FROM users WHERE nism_expiry_at IS NOT NULL
        AND nism_expiry_at::date >= ${fromIso} AND nism_expiry_at::date <= ${toIso}${nismScope}
      UNION ALL
      SELECT 'kyc', id::text, name, ckyc_expiry_at
      FROM investors WHERE ckyc_expiry_at IS NOT NULL
        AND ckyc_expiry_at >= ${fromIso}::date AND ckyc_expiry_at <= ${toIso}::date${kycScope}
      LIMIT 200
    `),
  ]);

  const out: CalendarItem[] = [];

  for (const r of tasks.rows as any[]) {
    out.push({
      id: `task-${r.id}`, kind: "task", date: ymd(r.d), at: iso(r.due_at),
      title: r.title, meta: r.priority, href: "/dashboard/tasks",
      description: r.description ?? undefined,
    });
  }
  for (const r of leads.rows as any[]) {
    out.push({
      id: `follow_up-${r.id}`, kind: "follow_up", date: ymd(r.d), at: null,
      title: `Follow up: ${r.name}`, meta: r.stage, href: `/dashboard/leads/${r.id}`,
      description: `Stage: ${r.stage}`,
      subjectType: "lead", subjectId: r.id, avatarUrl: r.avatar_url ?? null, personName: r.name,
    });
  }
  for (const r of reviews.rows as any[]) {
    out.push({
      id: `review-${r.id}`, kind: "review", date: ymd(r.d), at: null,
      title: `Review: ${r.name}`, meta: r.segment_tag ?? "", href: `/dashboard/investors/${r.id}`,
      description: `Segment: ${r.segment_tag ?? "—"}`,
      subjectType: "investor", subjectId: r.id, avatarUrl: r.avatar_url ?? null, personName: r.name,
    });
  }
  for (const r of sips.rows as any[]) {
    out.push({
      id: `sip-${r.id}`, kind: "sip", date: ymd(r.d), at: null,
      title: `SIP · ${r.investor_name ?? "—"}`, meta: `₹${r.amount} · ${r.scheme_name ?? ""}`,
      href: "/dashboard/sips", description: `Amount: ₹${r.amount}\nScheme: ${r.scheme_name ?? "—"}`,
      subjectType: "investor", subjectId: r.investor_id ?? undefined,
      avatarUrl: r.investor_avatar_url ?? null, personName: r.investor_name ?? undefined,
    });
  }
  for (const r of campaigns.rows as any[]) {
    out.push({
      id: `campaign-${r.id}`, kind: "campaign", date: ymd(r.d), at: iso(r.scheduled_at),
      title: r.name, meta: `${r.channel} · ${r.status}`, href: `/dashboard/campaigns/${r.id}`,
      description: `Channel: ${r.channel} · Status: ${r.status}`,
    });
  }
  for (const r of compliance.rows as any[]) {
    out.push({
      id: `compliance-${r.ckind}-${r.id}`, kind: "compliance", date: ymd(r.d), at: null,
      title: `${String(r.ckind).toUpperCase()} expiry: ${r.who}`, href: "/dashboard/compliance",
      description: `Compliance renewal alert for ${r.who}`,
    });
  }

  return out;
}
