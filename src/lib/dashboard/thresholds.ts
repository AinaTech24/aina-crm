/**
 * Dashboard business-logic thresholds — single source of truth.
 *
 * These used to be scattered magic numbers across the cockpits (180-day
 * dormancy in OwnerCockpit, 120-day HNI review, 7-day SIP-rejection window in
 * BackOffice, 90-day minor→major, …). Centralised here so they're consistent
 * and changeable in one place. `getDashboardThresholds()` is the read path —
 * today it returns the defaults; a per-tenant override (firm settings) can be
 * layered in later without touching call sites.
 */

export const DEFAULT_DASHBOARD_THRESHOLDS = {
  /** Days since last transaction before a client is flagged "dormant". */
  dormancyDays: 180,
  /** Days since last review before an HNI/top-tier client is "overdue". */
  hniReviewDays: 120,
  /** Look-back window for "recent SIP rejections to follow up". */
  sipRejectionWindowDays: 14,
  /** Short window for "rejections in the last N days" operational counts. */
  rejectionRecentDays: 7,
  /** Window before a minor turns major (guardian → self) to surface early. */
  minorToMajorDays: 90,

  // ── Management exception centre ───────────────────────────────────────────
  /** A SIP rejection still unresolved after this long is escalated. Matches the
   *  2-day escalation the sip_rejections schema already documents. */
  sipRejectionSlaDays: 2,
  /** A client query open longer than this is "ageing" on the director's view. */
  queryAgeingDays: 7,
  /** Renewals falling due inside this window need chasing now. */
  insuranceRenewalDays: 30,
  /** A claim open longer than this is past service expectation. */
  claimSlaDays: 30,
  /**
   * What makes a redemption "large" enough for a director to look at.
   *
   * A flat rupee bar alone is wrong in both directions — ₹10 L out of a ₹5 Cr
   * portfolio is routine rebalancing, while ₹2 L out of ₹4 L is the client
   * leaving. So a redemption qualifies on EITHER test: a big absolute cheque,
   * or a big bite out of that client's own book.
   */
  largeRedemptionAbsolute: 1_000_000,
  largeRedemptionShareOfAum: 0.25,

  // ── Relationship Manager Dashboard (was /dashboard?scope=mine) ───────────
  /**
   * A lead with no meaningful activity for this long is STALE.
   *
   * "Meaningful" means any of last contact, last follow-up, a stage change or
   * an edit — not merely `updated_at`, which a bulk import would refresh on
   * every row and silently empty the queue.
   *
   * Three weeks is the point at which an untouched MFD prospect has generally
   * gone cold. Firm-configurable — see loadDashboardThresholds below.
   */
  staleLeadDays: 21,

  // ── Branch Head Dashboard (was /dashboard?scope=branch) ─────────────────
  /** A proposal sent this many days ago with no decision needs attention. */
  proposalAgeingDays: 7,
  /**
   * The RM target matrix's amber band: at or above this share of the (phased)
   * target is "near", below it is "significant shortfall", at 100% it is
   * "achieved". The brief forbids hard-coding judgement thresholds, so this is
   * a default the firm can change, not a verdict.
   */
  targetNearFraction: 0.8,
  /**
   * How an ANNUAL target is spread across the year when a shorter period is
   * shown. "linear" pro-rates by elapsed days — the method the Team Scorecard
   * already uses ("pro-rates the annual target to the selected period"), and
   * the one the director's pace notch assumes. "none" shows annual targets
   * only against FY-to-date actuals and makes no claim about any shorter
   * period; the brief allows expected progress "only if an approved
   * target-phasing methodology exists", so a firm can switch it off.
   */
  targetPhasing: "linear" as "linear" | "none",
  /** An A/B client this many days past review is a critical exception, not
   *  merely an overdue one. */
  reviewSevereOverdueDays: 30,

  // ── Operations Dashboard (was /dashboard?scope=ops) ─────────────────────
  /** An open request whose SLA falls due within this many hours is
   *  "approaching" (Level 1). The task list's "SLA at risk" uses 24 hours. */
  opsSlaWarnHours: 24,
  /** Breached by more than this many hours is Level 3 — escalate. */
  opsEscalateHours: 24,
  /** A request at or above this value is high-value; the page also offers
   *  ₹1 L – ₹50 L presets and a custom figure per viewer. */
  opsHighValue: 1_000_000,
  /** An open record with no edit and no remark for this many days is a
   *  "no update" exception. */
  opsNoUpdateDays: 3,
  /** A feed transaction still pending / submitted this many days is waiting
   *  on the platform or AMC too long. */
  opsPlatformPendingDays: 3,
  /** Insurance: a renewal, proposal or pending policy at or above this premium
   *  is high value on the Insurance Business Command Centre. */
  insHighPremium: 100_000,
  /** Insurance: a proposed / in-underwriting policy older than this many days
   *  is an issuance delay. */
  insIssuanceSlaDays: 7,
  /** Insurance: an open claim at or above this amount is high value. */
  insHighClaim: 500_000,

  // ── Claims Dashboard (was /dashboard?scope=claims) ──────────────────────
  // The overall claim SLA is claimSlaDays above. The CRM holds no per-insurer
  // or per-stage SLA, so each of these is the firm's own service standard —
  // editable at Settings → Dashboard thresholds, never a regulator's number.
  /** An open claim within this many days of its SLA is "approaching" (Attention). */
  claimSlaWarnDays: 5,
  /** Breached by more than this many days, a claim is escalated (Level 3). */
  claimEscalateDays: 15,
  /** A claim file awaited from the client longer than this is overdue. */
  claimDocsDays: 7,
  /** An insurer query or information request unanswered longer than this is overdue. */
  claimQueryDays: 7,
  /** Under process with the insurer longer than this is "under assessment too long". */
  claimAssessDays: 21,
  /** An open claim with no edit for this many days is a "no update" exception. */
  claimNoUpdateDays: 3,
  /** A claimant with no logged contact for this many days is due an update. */
  claimClientUpdateDays: 7,
};

export type DashboardThresholds = typeof DEFAULT_DASHBOARD_THRESHOLDS;

/**
 * The thresholds a firm may change, with the bounds each must stay within.
 * Anything outside the bounds is ignored and the default stands — a typo in a
 * settings form must never turn "stale after 21 days" into "stale after 0".
 */
export const CONFIGURABLE_THRESHOLDS: Array<{
  key: keyof DashboardThresholds;
  label: string;
  hint: string;
  kind: "days" | "hours" | "rupees" | "fraction" | "choice";
  min?: number;
  max?: number;
  choices?: Array<{ value: string; label: string }>;
}> = [
  { key: "targetNearFraction", label: "Near-target band", hint: "Share of target that counts as amber rather than red", kind: "fraction", min: 0.1, max: 0.99 },
  { key: "targetPhasing", label: "Target phasing", hint: "How annual targets are spread over shorter periods", kind: "choice",
    choices: [
      { value: "linear", label: "Pro-rate evenly through the year" },
      { value: "none", label: "No phasing — compare FY-to-date only" },
    ] },
  { key: "staleLeadDays", label: "Stale lead after", hint: "Days with no activity of any kind", kind: "days", min: 3, max: 365 },
  { key: "proposalAgeingDays", label: "Proposal needs attention after", hint: "Days since sent with no decision", kind: "days", min: 1, max: 180 },
  { key: "largeRedemptionAbsolute", label: "High-value redemption from", hint: "Default threshold; each viewer can pick another on the page", kind: "rupees", min: 10000, max: 1e10 },
  { key: "sipRejectionSlaDays", label: "SIP rejection SLA", hint: "Days before an unworked rejection is past SLA", kind: "days", min: 1, max: 60 },
  { key: "queryAgeingDays", label: "Query ageing from", hint: "Days before an open query is flagged", kind: "days", min: 1, max: 90 },
  { key: "reviewSevereOverdueDays", label: "Review severely overdue after", hint: "Days past review before an A/B client is critical", kind: "days", min: 1, max: 365 },
  { key: "opsSlaWarnHours", label: "Operations: SLA approaching within", hint: "Hours before an open request's SLA falls due", kind: "hours", min: 1, max: 168 },
  { key: "opsEscalateHours", label: "Operations: escalate once SLA is breached by", hint: "Hours past SLA before a request is Level 3", kind: "hours", min: 1, max: 720 },
  { key: "opsHighValue", label: "Operations: high-value request from", hint: "Default threshold; each viewer can pick another on the page", kind: "rupees", min: 10000, max: 1e10 },
  { key: "opsNoUpdateDays", label: "Operations: no update after", hint: "Days with no edit or remark on an open record", kind: "days", min: 1, max: 60 },
  { key: "opsPlatformPendingDays", label: "Operations: waiting on platform too long after", hint: "Days a feed transaction may stay pending or submitted", kind: "days", min: 1, max: 60 },
  { key: "insHighPremium", label: "Insurance: high premium from", hint: "Renewals, proposals and pending policies at or above this are high value", kind: "rupees", min: 1000, max: 1e9 },
  { key: "insIssuanceSlaDays", label: "Insurance: issuance delayed after", hint: "Days a proposed or in-underwriting policy may wait", kind: "days", min: 1, max: 90 },
  { key: "insHighClaim", label: "Insurance: high-value claim from", hint: "Open claims at or above this amount are escalated", kind: "rupees", min: 1000, max: 1e10 },
  { key: "claimSlaDays", label: "Insurance: claim SLA", hint: "Days from intimation before an open claim is past SLA", kind: "days", min: 1, max: 365 },
  { key: "claimSlaWarnDays", label: "Claims: SLA approaching within", hint: "Days before the claim SLA falls due", kind: "days", min: 1, max: 60 },
  { key: "claimEscalateDays", label: "Claims: escalate once SLA is breached by", hint: "Days past SLA before a claim is escalated", kind: "days", min: 1, max: 365 },
  { key: "claimDocsDays", label: "Claims: documents overdue after", hint: "Days a claim file may stay awaited from the client", kind: "days", min: 1, max: 90 },
  { key: "claimQueryDays", label: "Claims: insurer query overdue after", hint: "Days a query or information request may stay unanswered", kind: "days", min: 1, max: 90 },
  { key: "claimAssessDays", label: "Claims: under process too long after", hint: "Days a submitted claim may stay under process", kind: "days", min: 1, max: 365 },
  { key: "claimNoUpdateDays", label: "Claims: no update after", hint: "Days an open claim may go without an edit", kind: "days", min: 1, max: 60 },
  { key: "claimClientUpdateDays", label: "Claims: client update due every", hint: "Days a claimant may go without a logged call, email, visit or message", kind: "days", min: 1, max: 60 },
];

/**
 * Keep only overrides that name a configurable key and sit inside its bounds.
 * Shared by the reader below and the settings API, so what can be saved and
 * what is honoured are the same thing.
 */
export function sanitizeThresholdOverrides(raw: unknown): Partial<DashboardThresholds> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out as Partial<DashboardThresholds>;
  for (const def of CONFIGURABLE_THRESHOLDS) {
    const v = (raw as Record<string, unknown>)[def.key];
    if (v == null || v === "") continue;
    if (def.kind === "choice") {
      if (typeof v === "string" && def.choices?.some((c) => c.value === v)) out[def.key] = v;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (def.min != null && n < def.min) continue;
    if (def.max != null && n > def.max) continue;
    out[def.key] = def.kind === "days" || def.kind === "hours" ? Math.round(n) : n;
  }
  return out as Partial<DashboardThresholds>;
}

import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

/**
 * The firm's thresholds: code defaults with its saved overrides (migration
 * 0219, dashboard_settings) merged over them. A firm that has never opened the
 * settings screen gets exactly the defaults. RLS scopes the read to the tenant.
 */
export async function loadDashboardThresholds(tx: Tx): Promise<DashboardThresholds> {
  // Explicit tenant predicate as well as RLS: a superuser connection (local
  // dev) ignores RLS, and a bare LIMIT 1 would then read ANY firm's row.
  const row = (await tx.execute(sql`
    SELECT settings FROM dashboard_settings
     WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  `)).rows[0] as
    | { settings: unknown }
    | undefined;
  return { ...DEFAULT_DASHBOARD_THRESHOLDS, ...sanitizeThresholdOverrides(row?.settings) };
}

/**
 * Resolve the thresholds for a tenant. Currently returns the defaults; the
 * signature takes a tenantId so a future per-firm override (read from tenant
 * settings) is a drop-in change with no call-site churn.
 */
export function getDashboardThresholds(_tenantId?: string): DashboardThresholds {
  return DEFAULT_DASHBOARD_THRESHOLDS;
}
