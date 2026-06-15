/**
 * Command Center — the unified, prioritised "what needs me today" worklist.
 *
 * This is the human-facing complement to the automation engine: the
 * daily-ops scanner emits *events* that drive recipes; this reads the
 * *current state* across modules and ranks the open actions a person should
 * work through, newest-pain-first.
 *
 * Scope:
 *   · firm-wide (owner / branch head / compliance) → the whole tenant
 *   · personal (RM / ops)                          → only rows they own
 * Tenant isolation is RLS (withTenant); the personal scope is an extra
 * `<owner column> = :userId` predicate layered on top.
 *
 * Each group is one indexed COUNT-with-preview query (top 5 rows +
 * `count(*) over()` total), so the whole board is ~10 light queries.
 */

import { sql } from "drizzle-orm";

export type Severity = "now" | "today" | "soon";

export type ActionItem = {
  id: string;
  title: string;
  detail?: string;
  href: string;
};

export type ActionGroup = {
  key: string;
  label: string;
  /** lucide icon name — resolved in the client component */
  icon: string;
  severity: Severity;
  /** tone for the count badge */
  tone: "rose" | "amber" | "sky" | "violet" | "emerald";
  count: number;
  /** "view all" link (filtered module route) */
  href: string;
  /** up to 5 preview rows */
  items: ActionItem[];
};

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

/**
 * Build the personal-scope predicate for a given column, or empty for
 * firm-wide. The column is a hardcoded constant from the call sites below
 * (never user input) so sql.raw is safe; the userId is bound as a parameter.
 */
function scope(col: string, userId: string, firmWide: boolean) {
  return firmWide ? sql`` : sql` AND ${sql.raw(col)} = ${userId}`;
}

/** Append mine=1 to a personal-scoped deep link so the module lands pre-filtered. */
function href(base: string, firmWide: boolean, extra = "") {
  const parts = [extra, firmWide ? "" : "mine=1"].filter(Boolean);
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

export async function buildCommandQueue(
  tx: Tx,
  opts: { userId: string; firmWide: boolean; clientId?: string }
): Promise<ActionGroup[]> {
  const { userId, firmWide, clientId } = opts;
  const groups: ActionGroup[] = [];

  // When the board is scoped to a single client, every investor-centric group
  // gets an extra `<investor column> = :clientId` predicate. The column name is
  // a hardcoded constant from the call sites (never user input) so sql.raw is
  // safe; the id is bound as a parameter. Groups that aren't about a client
  // (leave approvals, your own clock-in, lead follow-ups) are skipped entirely.
  const cscope = (col: string) => (clientId ? sql` AND ${sql.raw(col)} = ${clientId}` : sql``);

  // ── 1. Service-request SLA breaches (firefight) ──────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, ticket_no, subject, sla_resolution_at, count(*) OVER() AS total
      FROM service_requests
      WHERE status IN ('open','in_progress','waiting_customer','escalated')
        AND sla_resolution_at IS NOT NULL
        AND sla_resolution_at < now()
        ${scope("assigned_to_user_id", userId, firmWide)}${cscope("investor_id")}
      ORDER BY sla_resolution_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "sla_breach",
        label: "SLA breached — service requests",
        icon: "LifeBuoy",
        severity: "now",
        tone: "rose",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/service-requests",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.subject ?? `Ticket #${x.ticket_no}`,
          detail: `#${x.ticket_no} · SLA passed`,
          href: `/dashboard/service-requests`,
        })),
      });
    }
  }

  // ── 2. SIP bounces (mandate / balance trouble → churn) ───────────────
  {
    const r = await tx.execute(sql`
      SELECT s.id, s.scheme_name, s.amount, COALESCE(s.consecutive_failures,'0') AS fails,
             i.name AS investor_name, count(*) OVER() AS total
      FROM sips s
      JOIN investors i ON i.id = s.investor_id
      WHERE (s.status = 'rejected' OR COALESCE(NULLIF(s.consecutive_failures,''),'0')::int > 0)
        AND s.status <> 'stopped'
        ${scope("s.rm_id", userId, firmWide)}${cscope("s.investor_id")}
      ORDER BY COALESCE(NULLIF(s.consecutive_failures,''),'0')::int DESC, s.amount DESC NULLS LAST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "sip_bounce",
        label: "SIP bounces to rescue",
        icon: "XOctagon",
        severity: "now",
        tone: "rose",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/sip-rejections",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.investor_name,
          detail: `${x.scheme_name ?? "SIP"} · ${x.fails} bounce${Number(x.fails) === 1 ? "" : "es"}`,
          href: `/dashboard/sip-rejections`,
        })),
      });
    }
  }

  // ── 3. Redemption-risk clients (retention) ───────────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, redemption_risk_reason, count(*) OVER() AS total
      FROM investors
      WHERE (status = 'redemption_risk' OR redemption_risk_flagged_at IS NOT NULL)
        ${scope("rm_id", userId, firmWide)}${cscope("id")}
      ORDER BY redemption_risk_flagged_at DESC NULLS LAST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "redemption_risk",
        label: "Redemption-risk clients",
        icon: "TrendingDown",
        severity: "now",
        tone: "rose",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/reports/churn-risk",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: x.redemption_risk_reason ?? "Flagged at-risk",
          href: `/dashboard/investors/${x.id}`,
        })),
      });
    }
  }

  // ── 4. Reviews overdue (service promise) ─────────────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, service_tier, next_review_at, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND next_review_at IS NOT NULL
        AND next_review_at < now()
        ${scope("rm_id", userId, firmWide)}${cscope("id")}
      ORDER BY next_review_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "reviews_due",
        label: "Reviews overdue",
        icon: "CalendarClock",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide, "reviews_due=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: `Tier ${x.service_tier ?? "—"} · due ${fmt(x.next_review_at)}`,
          href: `/dashboard/investors/${x.id}`,
        })),
      });
    }
  }

  // ── 4b. Meetings today (be prepared, be on time) ─────────────────────
  {
    const r = await tx.execute(sql`
      SELECT m.id, m.meeting_type, m.subject, m.meeting_date,
             COALESCE(i.name, l.name) AS party_name, count(*) OVER() AS total
      FROM review_meetings m
      LEFT JOIN investors i ON i.id = m.investor_id
      LEFT JOIN leads l ON l.id = m.lead_id
      WHERE m.status IN ('scheduled','confirmed')
        AND m.meeting_date::date = current_date
        ${scope("m.rm_id", userId, firmWide)}${cscope("m.investor_id")}
      ORDER BY m.meeting_date ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "meetings_today",
        label: "Meetings today",
        icon: "Calendar",
        severity: "today",
        tone: "sky",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/review-meetings",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.party_name ?? "Client",
          detail: `${x.subject ? x.subject : String(x.meeting_type).replace(/_/g, " ")} · ${new Date(x.meeting_date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`,
          href: `/dashboard/review-meetings/${x.id}`,
        })),
      });
    }
  }

  // ── 4c. Leave requests to approve (managers only) ────────────────────
  if (firmWide && !clientId) {
    const r = await tx.execute(sql`
      SELECT la.id, la.leave_type, la.from_date, la.to_date, la.no_of_days,
             u.name AS employee_name, count(*) OVER() AS total
      FROM leave_applications la
      LEFT JOIN users u ON u.id = la.employee_user_id
      WHERE la.status = 'requested'
      ORDER BY la.created_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "leave_approvals",
        label: "Leave requests to approve",
        icon: "CalendarOff",
        severity: "today",
        tone: "violet",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/leave-applications?status=requested",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.employee_name ?? "Employee",
          detail: `${x.no_of_days} day(s) · ${String(x.leave_type).replace(/_/g, " ")} · ${fmt(x.from_date)}`,
          href: "/dashboard/leave-applications?status=requested",
        })),
      });
    }
  }

  // ── 4d. Clock in (personal) — if you haven't punched today on a workday ──
  if (!clientId) {
    const r = await tx.execute(sql`
      SELECT
        EXISTS(
          SELECT 1 FROM attendance
          WHERE employee_user_id = ${userId}::uuid AND attendance_date = current_date
            AND (clock_in_at IS NOT NULL OR status IN ('week_off','holiday','on_leave'))
        ) AS handled,
        (EXTRACT(DOW FROM current_date) = 0) AS is_sunday
    `);
    const row = r.rows[0] as any;
    if (row && !row.handled && !row.is_sunday) {
      groups.push({
        key: "clock_in",
        label: "Clock in for today",
        icon: "CalendarCheck",
        severity: "today",
        tone: "sky",
        count: 1,
        href: "/dashboard/attendance",
        items: [{ id: "clock", title: "You haven't clocked in yet", detail: "Mark your attendance for today", href: "/dashboard/attendance" }],
      });
    }
  }

  // ── 5. KYC / CKYC expiring or broken (blocks transactions) ───────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, kyc_status, ckyc_expiry_at, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND (
          kyc_status IN ('expired','re_kyc_required','rejected')
          OR (ckyc_expiry_at IS NOT NULL
              AND ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
        )
        ${scope("rm_id", userId, firmWide)}${cscope("id")}
      ORDER BY ckyc_expiry_at ASC NULLS FIRST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "kyc_expiring",
        label: "KYC expiring / broken",
        icon: "ShieldAlert",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide, "kyc_expiring=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: x.ckyc_expiry_at ? `CKYC expires ${fmt(x.ckyc_expiry_at)}` : `KYC ${x.kyc_status}`,
          href: `/dashboard/investors/${x.id}`,
        })),
      });
    }
  }

  // ── 6. Overdue tasks ─────────────────────────────────────────────────
  {
    const r = await tx.execute(sql`
      SELECT id, title, priority, due_at, count(*) OVER() AS total
      FROM tasks
      WHERE status IN ('open','in_progress')
        AND due_at IS NOT NULL
        AND due_at < now()
        ${scope("assignee_id", userId, firmWide)}${cscope("related_investor_id")}
      ORDER BY due_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "tasks_overdue",
        label: "Overdue tasks",
        icon: "ListChecks",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: "/dashboard/tasks",
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.title,
          detail: `${x.priority} · due ${fmt(x.due_at)}`,
          href: `/dashboard/tasks`,
        })),
      });
    }
  }

  // ── 7. Overdue lead follow-ups (pipeline leaking) ────────────────────
  if (!clientId) {
    const r = await tx.execute(sql`
      SELECT id, name, stage, next_follow_up_at, count(*) OVER() AS total
      FROM leads
      WHERE converted_investor_id IS NULL
        AND stage NOT IN ('not_qualified','lost','not_interested','converted')
        AND next_follow_up_at IS NOT NULL
        AND next_follow_up_at < now()
        ${scope("owner_id", userId, firmWide)}
      ORDER BY next_follow_up_at ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "lead_followups",
        label: "Lead follow-ups overdue",
        icon: "Sparkles",
        severity: "today",
        tone: "amber",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/leads", firmWide),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: `${String(x.stage).replace(/_/g, " ")} · due ${fmt(x.next_follow_up_at)}`,
          href: `/dashboard/leads/${x.id}`,
        })),
      });
    }
  }

  // ── 8. Risk profile stale (>365d) — SEBI annual refresh ──────────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, risk_profile_signed_at, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND (risk_profile_signed_at IS NULL OR risk_profile_signed_at < now() - interval '365 days')
        ${scope("rm_id", userId, firmWide)}${cscope("id")}
      ORDER BY risk_profile_signed_at ASC NULLS FIRST
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "rp_stale",
        label: "Risk profiles to refresh",
        icon: "ShieldCheck",
        severity: "soon",
        tone: "sky",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide, "rp_stale=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: x.risk_profile_signed_at ? `Signed ${fmt(x.risk_profile_signed_at)}` : "Never assessed",
          href: `/dashboard/investors/${x.id}`,
        })),
      });
    }
  }

  // ── 9. Birthdays TODAY (wish them — a do-it-today touchpoint) ────────
  {
    const r = await tx.execute(sql`
      SELECT id, name, dob, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND dob IS NOT NULL
        AND to_char(dob, 'MM-DD') = to_char(current_date, 'MM-DD')
        ${scope("rm_id", userId, firmWide)}${cscope("id")}
      ORDER BY name ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "birthdays_today",
        label: "Birthdays today 🎂",
        icon: "Cake",
        severity: "today",
        tone: "violet",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide, "birthday_today=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: turnsToday(x.dob),
          href: `/dashboard/investors/${x.id}`,
        })),
      });
    }
  }

  // ── 10. Birthdays in the next 7 days (heads-up; excludes today) ──────
  {
    const r = await tx.execute(sql`
      SELECT id, name, dob, count(*) OVER() AS total
      FROM investors
      WHERE status = 'active'
        AND dob IS NOT NULL
        AND to_char(dob, 'MM-DD') BETWEEN to_char(current_date + interval '1 day', 'MM-DD')
                                      AND to_char(current_date + interval '7 days', 'MM-DD')
        ${scope("rm_id", userId, firmWide)}${cscope("id")}
      ORDER BY to_char(dob, 'MM-DD') ASC
      LIMIT 5
    `);
    if (r.rows.length) {
      groups.push({
        key: "birthdays",
        label: "Birthdays this week",
        icon: "Cake",
        severity: "soon",
        tone: "violet",
        count: Number(r.rows[0].total ?? r.rows.length),
        href: href("/dashboard/investors", firmWide, "birthday_week=1"),
        items: r.rows.map((x: any) => ({
          id: x.id,
          title: x.name,
          detail: `Birthday ${fmt(x.dob, true)}`,
          href: `/dashboard/investors/${x.id}`,
        })),
      });
    }
  }

  // Severity ordering, then biggest pile first within a band.
  const order: Record<Severity, number> = { now: 0, today: 1, soon: 2 };
  groups.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return groups;
}

/** "Turns 42 today" from a date of birth (falls back gracefully). */
function turnsToday(dob: any): string {
  const d = dob instanceof Date ? dob : new Date(dob);
  if (isNaN(d.getTime())) return "Birthday today";
  const age = new Date().getFullYear() - d.getFullYear();
  return age > 0 && age < 130 ? `Turns ${age} today` : "Birthday today";
}

function fmt(v: any, dayMonth = false): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", dayMonth
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "short", year: "2-digit" });
}
