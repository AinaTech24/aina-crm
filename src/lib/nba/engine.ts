/**
 * Next-Best-Action engine — the "advisor copilot" layer.
 *
 * Where the Command Center groups open work by TYPE (10 buckets), the NBA
 * engine flattens every signal into PER-CLIENT actions, attaches a ₹-impact
 * (AUM at risk / SIP value / cross-sell potential), scores each by
 * priority = typeWeight + impact-bump + urgency, and returns a single ranked
 * list answering: "who is the #1 client to act on right now, why, and what's
 * it worth?" This is the thing a generic CRM (Sanchay) structurally cannot do.
 *
 * Scope: firm-wide (managers) or personal (own book). Pass `forInvestorId` to
 * get just one client's recommendations (powers the Client-360 card).
 *
 * Read-only, RLS-scoped via withTenant at the call site.
 */

import { sql } from "drizzle-orm";

type Tx = { execute: (q: any) => Promise<{ rows: any[] }> };

export type NbaType =
  | "redemption_risk" | "sip_bounce" | "kyc_broken" | "review_overdue"
  | "dormant" | "rp_stale" | "cross_sell" | "birthday_today" | "lead_followup";

export type NbaAction = {
  key: string;
  type: NbaType;
  subjectType: "investor" | "lead";
  subjectId: string;
  subjectName: string;
  phone: string | null;
  email: string | null;
  rmName: string | null;
  title: string;
  reason: string;
  impactInr: number;
  score: number;
  severity: "now" | "today" | "soon";
  suggestedChannel: "call" | "whatsapp" | "task";
  href: string;
  /** The signal's "relevant date" (review-due, follow-up, KYC expiry, bounce,
   *  birthday…) as YYYY-MM-DD — drives the date-range filter. null when undated. */
  date: string | null;
};

export const NBA_META: Record<NbaType, { label: string; weight: number; severity: "now" | "today" | "soon"; tone: string; icon: string }> = {
  redemption_risk: { label: "Retention call", weight: 100, severity: "now", tone: "rose", icon: "TrendingDown" },
  sip_bounce:      { label: "Rescue SIP",     weight: 90,  severity: "now", tone: "rose", icon: "XOctagon" },
  kyc_broken:      { label: "Fix KYC",        weight: 80,  severity: "today", tone: "amber", icon: "ShieldAlert" },
  lead_followup:   { label: "Follow up lead", weight: 65,  severity: "today", tone: "violet", icon: "Sparkles" },
  review_overdue:  { label: "Run review",     weight: 60,  severity: "today", tone: "amber", icon: "CalendarClock" },
  dormant:         { label: "Re-engage",      weight: 52,  severity: "soon", tone: "sky", icon: "Moon" },
  rp_stale:        { label: "Refresh risk profile", weight: 48, severity: "soon", tone: "sky", icon: "ShieldCheck" },
  cross_sell:      { label: "Cross-sell",     weight: 45,  severity: "soon", tone: "emerald", icon: "TrendingUp" },
  birthday_today:  { label: "Wish birthday",  weight: 40,  severity: "today", tone: "violet", icon: "Cake" },
};

/** ₹-impact contributes up to +50 to the score (₹2L per point, capped). */
function scoreFor(type: NbaType, impactInr: number): number {
  return NBA_META[type].weight + Math.min(50, (Number(impactInr) || 0) / 200_000);
}

const num = (v: any) => Number(v ?? 0) || 0;
const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`);

export async function buildNextBestActions(
  tx: Tx,
  opts: { userId: string; firmWide: boolean; forInvestorId?: string; limit?: number }
): Promise<NbaAction[]> {
  const { userId, firmWide, forInvestorId } = opts;
  const out: NbaAction[] = [];
  const todayISO = new Date().toISOString().slice(0, 10);

  // Personal scope OR single-investor scope.
  const invScope = forInvestorId
    ? sql` AND i.id = ${forInvestorId}::uuid`
    : firmWide ? sql`` : sql` AND i.rm_id = ${userId}::uuid`;
  const sipScope = forInvestorId
    ? sql` AND s.investor_id = ${forInvestorId}::uuid`
    : firmWide ? sql`` : sql` AND s.rm_id = ${userId}::uuid`;
  const cap = forInvestorId ? sql`` : sql`LIMIT 80`;

  function push(type: NbaType, r: any, impactInr: number, title: string, reason: string, channel: NbaAction["suggestedChannel"]) {
    // The date that makes this action "due" — drives the date-range filter.
    const dateRaw =
      type === "redemption_risk" ? r.redemption_risk_flagged_at :
      type === "sip_bounce" ? r.updated_at :
      type === "kyc_broken" ? r.ckyc_expiry_at :
      type === "lead_followup" ? r.next_follow_up_at :
      type === "review_overdue" ? r.next_review_at :
      type === "dormant" ? r.last_transaction_at :
      type === "rp_stale" ? r.risk_profile_signed_at :
      type === "birthday_today" ? todayISO :
      null; // cross_sell has no natural date
    out.push({
      key: `${type}:${r.id}`,
      type,
      subjectType: type === "lead_followup" ? "lead" : "investor",
      subjectId: r.id,
      subjectName: r.name,
      phone: r.phone ?? null,
      email: r.email ?? null,
      rmName: r.rm_name ?? null,
      title,
      reason,
      impactInr,
      score: scoreFor(type, impactInr),
      severity: NBA_META[type].severity,
      suggestedChannel: channel,
      href: type === "lead_followup" ? `/dashboard/leads/${r.id}` : `/dashboard/investors/${r.id}`,
      date: toISODate(dateRaw),
    });
  }

  // 1. Redemption-risk → AUM at risk.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.redemption_risk_reason, i.redemption_risk_flagged_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND (i.status = 'redemption_risk' OR i.redemption_risk_flagged_at IS NOT NULL) ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("redemption_risk", x, num(x.aum), `Retention call — ${inr(num(x.aum))} at risk`, x.redemption_risk_reason ?? "Flagged redemption-risk", "call");
  }
  // 2. SIP bounce → annualised SIP value.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, u.name AS rm_name,
             s.amount::numeric AS amount, s.scheme_name, COALESCE(NULLIF(s.consecutive_failures,''),'0')::int AS fails, s.updated_at
      FROM sips s JOIN investors i ON i.id = s.investor_id LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND (s.status = 'rejected' OR COALESCE(NULLIF(s.consecutive_failures,''),'0')::int > 0) AND s.status <> 'stopped' ${sipScope}
      ORDER BY fails DESC, s.amount DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("sip_bounce", x, num(x.amount) * 12, `Rescue SIP — ${inr(num(x.amount))}/mo`, `${x.scheme_name ?? "SIP"} · ${x.fails} bounce${num(x.fails) === 1 ? "" : "es"}`, "call");
  }
  // 3. KYC broken/expiring → AUM blocked.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.kyc_status, i.ckyc_expiry_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.status = 'active' AND (
        i.kyc_status IN ('expired','re_kyc_required','rejected')
        OR (i.ckyc_expiry_at IS NOT NULL AND i.ckyc_expiry_at BETWEEN current_date AND current_date + interval '30 days')
      ) ${invScope}
      ORDER BY i.ckyc_expiry_at ASC NULLS FIRST ${cap}
    `);
    for (const x of r.rows) push("kyc_broken", x, num(x.aum), `Fix KYC — transactions blocked`, x.ckyc_expiry_at ? `CKYC expires ${fmt(x.ckyc_expiry_at)}` : `KYC ${x.kyc_status}`, "task");
  }
  // 4. Lead follow-up overdue → intended amount.
  if (!forInvestorId) {
    const leadScope = firmWide ? sql`` : sql` AND l.owner_id = ${userId}::uuid`;
    const r = await tx.execute(sql`
      SELECT l.id, l.name, l.phone, l.email, l.stage, l.next_follow_up_at, u.name AS rm_name,
             COALESCE(NULLIF(regexp_replace(COALESCE(l.intended_amount,''),'[^0-9.]','','g'),'')::numeric, 0) AS amt
      FROM leads l LEFT JOIN users u ON u.id = l.owner_id
      WHERE l.converted_investor_id IS NULL AND l.stage NOT IN ('not_qualified','lost','not_interested','converted')
        AND l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < now() ${leadScope}
      ORDER BY l.next_follow_up_at ASC ${cap}
    `);
    for (const x of r.rows) push("lead_followup", x, num(x.amt), `Follow up — ${num(x.amt) > 0 ? inr(num(x.amt)) : "open"} lead`, `${String(x.stage).replace(/_/g, " ")} · overdue ${fmt(x.next_follow_up_at)}`, "call");
  }
  // 5. Review overdue → AUM.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.service_tier, i.next_review_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.status = 'active' AND i.next_review_at IS NOT NULL AND i.next_review_at < now() ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("review_overdue", x, num(x.aum), `Run review — Tier ${x.service_tier ?? "—"}`, `Review due ${fmt(x.next_review_at)}`, "call");
  }
  // 6. Dormant (no txn 180d+) → AUM.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.last_transaction_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.status = 'active'
        AND (i.last_transaction_at IS NULL OR i.last_transaction_at < now() - interval '180 days')
        AND COALESCE(i.aum,0) > 0 ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("dormant", x, num(x.aum), `Re-engage — dormant 6m+`, x.last_transaction_at ? `Last txn ${fmt(x.last_transaction_at)}` : "No transactions", "whatsapp");
  }
  // 7. Cross-sell opportunity → 15% of AUM (wallet-share estimate, min ₹1L).
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, u.name AS rm_name,
        (SELECT string_agg(cs.k, ', ') FROM jsonb_each_text(i.cross_sell) AS cs(k,v) WHERE cs.v IN ('held_elsewhere','interested','not_held')) AS gaps
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.status = 'active' AND i.cross_sell IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_each_text(i.cross_sell) AS cs(k,v) WHERE cs.v IN ('held_elsewhere','interested','not_held')) ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) { const pot = Math.max(100000, Math.round(num(x.aum) * 0.15)); push("cross_sell", x, pot, `Cross-sell — ~${inr(pot)} potential`, x.gaps ? `Gaps: ${String(x.gaps).replace(/_/g, " ")}` : "Wallet-share opportunity", "call"); }
  }
  // 8. Risk profile stale (SEBI annual) → AUM.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, COALESCE(i.aum,0)::numeric AS aum, i.risk_profile_signed_at, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.status = 'active'
        AND (i.risk_profile_signed_at IS NULL OR i.risk_profile_signed_at < now() - interval '365 days') ${invScope}
      ORDER BY i.aum DESC NULLS LAST ${cap}
    `);
    for (const x of r.rows) push("rp_stale", x, num(x.aum), `Refresh risk profile (SEBI annual)`, x.risk_profile_signed_at ? `Signed ${fmt(x.risk_profile_signed_at)}` : "Never assessed", "task");
  }
  // 9. Birthday today → relationship touch.
  {
    const r = await tx.execute(sql`
      SELECT i.id, i.name, i.phone, i.email, i.dob, u.name AS rm_name
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
      WHERE i.merged_into_id IS NULL AND i.status = 'active' AND i.dob IS NOT NULL
        AND to_char(i.dob, 'MM-DD') = to_char(current_date, 'MM-DD') ${invScope}
      ORDER BY i.name ASC ${cap}
    `);
    for (const x of r.rows) push("birthday_today", x, 0, `Wish a happy birthday 🎂`, "Birthday today", "whatsapp");
  }

  // Dedup: keep the highest-scoring action per (subject) so one client isn't
  // spammed across the top — except in single-client mode (show all).
  out.sort((a, b) => b.score - a.score);
  if (forInvestorId) return out;
  const seen = new Set<string>();
  const ranked: NbaAction[] = [];
  for (const a of out) {
    if (seen.has(a.subjectId)) continue;
    seen.add(a.subjectId);
    ranked.push(a);
  }
  return ranked.slice(0, opts.limit ?? 100);
}

function fmt(v: any): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Normalise any date-ish value to YYYY-MM-DD (or null) for range comparisons. */
function toISODate(v: any): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
