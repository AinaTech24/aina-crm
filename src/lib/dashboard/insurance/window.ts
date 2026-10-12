/**
 * The Insurance Business Command Centre's window: who is in scope, which
 * filters apply, and the ONE base query every loader reads policies through.
 *
 * `polBase(w)` is a CTE body over insurance_policies with every derived field
 * from lib/insurance/book.ts already computed (line, product group, nature,
 * booked-on, installment, business owner, client branch, client type…);
 * `polWhere(w)` applies the viewer's scope and the filter bar to it. Loaders
 * write `WITH pol AS (${polBase(w)}) SELECT … FROM pol WHERE ${polWhere(w)}`
 * and never re-derive a definition.
 */

import { sql, type SQL } from "drizzle-orm";
import type { withTenant } from "@/db/client";
import type { DashboardThresholds } from "@/lib/dashboard/thresholds";
import {
  branchSql, bookedOnSql, groupSql, inList, installmentSql, lineSql, natureSql, ownerSql, typesOfGroups, typesOfLine,
  type Line,
} from "@/lib/insurance/book";

export type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
export type Row = Record<string, unknown>;
export const num = (v: unknown): number => (v == null || v === "" ? 0 : Number(v) || 0);
export const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

export type InsScope =
  | { kind: "firm" }
  | { kind: "branch"; branchId: string }
  /** Their own book: policies they sold or own, and their clients' policies. */
  | { kind: "self"; userId: string };

export const PREMIUM_BANDS = [
  { key: "b1", label: "Below ₹10,000", min: 0, max: 10_000 },
  { key: "b2", label: "₹10,000 – ₹25,000", min: 10_000, max: 25_000 },
  { key: "b3", label: "₹25,000 – ₹50,000", min: 25_000, max: 50_000 },
  { key: "b4", label: "₹50,000 – ₹1 Lakh", min: 50_000, max: 100_000 },
  { key: "b5", label: "₹1 Lakh +", min: 100_000, max: null },
] as const;

export const CLIENT_TYPES = [
  { key: "individual", label: "Individual" },
  { key: "head", label: "Family head" },
  { key: "member", label: "Family member" },
  { key: "corporate", label: "Corporate" },
] as const;

export const CLAIM_GROUPS = [
  { key: "open", label: "Open" },
  { key: "fnr", label: "File not received" },
  { key: "query", label: "Insurer query" },
  { key: "settled", label: "Settled" },
  { key: "rejected", label: "Rejected" },
] as const;

export type InsFilter = {
  line?: Line;
  nature?: "new" | "renewal";
  groups?: string[];
  branchId?: string;
  /** Business owner (sales credit). */
  ownerId?: string;
  /** The insurance-team member who sold / keyed the policy. */
  execId?: string;
  insurer?: string;
  categories?: string[];
  clientType?: "individual" | "family" | "corporate";
  mf?: "yes" | "no";
  statuses?: string[];
  band?: string;
  source?: string;
  claimGroup?: string;
  claimType?: string;
  /**
   * The client's industry. The CRM has no industry field: this is the
   * client's occupation / nature of business as keyed (the corporate view's
   * own stand-in), compared case-insensitively. "none" = not recorded.
   */
  industry?: string;
  /** Why a policy lapsed or was cancelled (policies.lapse_reason); "none" = not recorded. */
  lossReason?: string;
};

export type InsWindow = {
  tenantId: string;
  userId: string;
  scope: InsScope;
  filter: InsFilter;
  /** The selected period, inclusive IST dates. */
  from: string;
  to: string;
  periodLabel: string;
  /** The corresponding previous slice (lib/dashboard/period resolvePreviousRange). */
  prevFrom: string;
  prevTo: string;
  prevLabel: string;
  /** FY containing `to`, from 1 April to `to`; and the same slice of the previous FY. */
  fyStart: string;
  pyFrom: string;
  pyTo: string;
  today: string;
  t: DashboardThresholds;
};

export const hasFilter = (w: InsWindow) => Object.values(w.filter).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

/** The date one year before an ISO date (29 Feb → 28 Feb). */
export function yearBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function fyStartOf(iso: string): string {
  const y = Number(iso.slice(0, 4));
  return `${Number(iso.slice(5, 7)) < 4 ? y - 1 : y}-04-01`;
}

/** 'YYYY-YY' — the annual_targets / kra_targets key for the FY containing `iso`. */
export function fyLabelOf(iso: string): string {
  const s = Number(fyStartOf(iso).slice(0, 4));
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}

export const istDay = (ts: SQL) => sql`(${ts} AT TIME ZONE 'Asia/Kolkata')::date`;

/**
 * Every policy with its derived fields. Soft-deleted clients are out: their
 * policies are not business. `today` is IST.
 */
export function polBase(w: InsWindow): SQL {
  return sql`
    SELECT p.id, p.investor_id, i.name AS client, i.phone AS client_phone, i.email AS client_email,
           upper(btrim(COALESCE(i.client_category, ''))) AS cat,
           i.investor_category AS icat,
           CASE WHEN i.investor_category IN ('corporate', 'company', 'llp', 'partnership', 'aop_boi') THEN 'corporate'
                WHEN i.id IN (SELECT f.primary_investor_id FROM families f
                               WHERE f.tenant_id = ${w.tenantId}::uuid AND f.primary_investor_id IS NOT NULL) THEN 'head'
                WHEN i.family_id IS NOT NULL THEN 'member'
                ELSE 'individual' END AS ctype,
           (COALESCE(i.aum, 0)::numeric > 0) AS mf,
           NULLIF(btrim(i.occupation), '') AS occupation,
           i.rm_id AS client_rm,
           ${branchSql("p", "i")} AS branch_id,
           ${ownerSql("p", "i", "su")} AS owner_id,
           p.sold_by_user_id AS seller_id,
           COALESCE(su.roles && ARRAY['insurance_team']::text[], false) AS seller_ins,
           ${lineSql("p")} AS line,
           ${groupSql("p")} AS grp,
           ${natureSql("p")} AS nature,
           ${bookedOnSql("p")} AS booked_on,
           p.status,
           COALESCE(p.annual_premium, 0)::numeric AS premium,
           (p.annual_premium IS NULL OR p.annual_premium = 0) AS premium_missing,
           ${installmentSql("p")} AS inst,
           p.premium_frequency AS freq,
           p.next_premium_due_date AS due,
           COALESCE(p.grace_period_days, 30) AS grace,
           p.maturity_date AS expiry,
           NULLIF(btrim(p.insurer), '') AS insurer,
           lower(btrim(COALESCE(p.insurer, ''))) AS insurer_key,
           p.policy_type, p.plan_name, NULLIF(btrim(p.policy_number), '') AS policy_number,
           p.sum_assured, p.created_at, p.updated_at, NULLIF(btrim(p.lapse_reason), '') AS lapse_reason,
           src.source
      FROM insurance_policies p
      JOIN investors i ON i.id = p.investor_id AND i.tenant_id = ${w.tenantId}::uuid AND i.deleted_at IS NULL
      LEFT JOIN users su ON su.id = p.sold_by_user_id
      LEFT JOIN LATERAL (
        SELECT l.source FROM leads l
         WHERE l.tenant_id = ${w.tenantId}::uuid AND l.converted_investor_id = i.id
         ORDER BY l.converted_at DESC NULLS LAST LIMIT 1
      ) src ON true
     WHERE p.tenant_id = ${w.tenantId}::uuid`;
}

/** The viewer's scope over `pol`. */
export function scopeSql(w: InsWindow, a = "pol"): SQL {
  const c = (x: string) => sql.raw(`${a}.${x}`);
  if (w.scope.kind === "firm") return sql`TRUE`;
  if (w.scope.kind === "branch") return sql`${c("branch_id")} = ${w.scope.branchId}::uuid`;
  const me = w.scope.userId;
  return sql`(${c("owner_id")} = ${me}::uuid OR ${c("seller_id")} = ${me}::uuid OR ${c("client_rm")} = ${me}::uuid)`;
}

/**
 * Scope + the filter bar. `nature` applies to booked business only (a renewal
 * DUE has no new/renewal nature); `status` is off for sections that pick their
 * own statuses (renewals due, lost, pending issuance).
 */
export function polWhere(w: InsWindow, opts: { nature?: boolean; status?: boolean } = {}, a = "pol"): SQL {
  const c = (x: string) => sql.raw(`${a}.${x}`);
  const f = w.filter;
  const parts: SQL[] = [scopeSql(w, a)];
  if (f.line) parts.push(sql`${c("policy_type")} IN (${inList(typesOfLine(f.line))})`);
  if (f.groups?.length) parts.push(sql`${c("policy_type")} IN (${inList(typesOfGroups(f.groups))})`);
  if (opts.nature !== false && f.nature) parts.push(sql`${c("nature")} = ${f.nature}`);
  if (f.branchId) parts.push(sql`${c("branch_id")} = ${f.branchId}::uuid`);
  if (f.ownerId) parts.push(sql`${c("owner_id")} = ${f.ownerId}::uuid`);
  if (f.execId) parts.push(sql`${c("seller_id")} = ${f.execId}::uuid`);
  if (f.insurer) parts.push(sql`${c("insurer_key")} = ${f.insurer.trim().toLowerCase()}`);
  if (f.categories?.length) {
    const letters = f.categories.filter((x) => x !== "none");
    const none = f.categories.includes("none");
    parts.push(sql`(${letters.length ? sql`${c("cat")} IN (${inList(letters)})` : sql`FALSE`}${none ? sql` OR ${c("cat")} = ''` : sql``})`);
  }
  if (f.clientType === "corporate") parts.push(sql`${c("ctype")} = 'corporate'`);
  if (f.clientType === "individual") parts.push(sql`${c("ctype")} = 'individual'`);
  if (f.clientType === "family") parts.push(sql`${c("ctype")} IN ('head', 'member')`);
  if (f.mf === "yes") parts.push(sql`${c("mf")}`);
  if (f.mf === "no") parts.push(sql`NOT ${c("mf")}`);
  if (opts.status !== false && f.statuses?.length) parts.push(sql`${c("status")} IN (${inList(f.statuses)})`);
  if (f.band) {
    const b = PREMIUM_BANDS.find((x) => x.key === f.band);
    if (b) parts.push(b.max == null ? sql`${c("premium")} >= ${b.min}` : sql`${c("premium")} >= ${b.min} AND ${c("premium")} < ${b.max}`);
  }
  if (f.source === "none") parts.push(sql`${c("source")} IS NULL`);
  else if (f.source) parts.push(sql`${c("source")} = ${f.source}`);
  if (f.industry === "none") parts.push(sql`${c("occupation")} IS NULL`);
  else if (f.industry) parts.push(sql`lower(${c("occupation")}) = ${f.industry.toLowerCase()}`);
  if (f.lossReason === "none") parts.push(sql`${c("lapse_reason")} IS NULL`);
  else if (f.lossReason) parts.push(sql`lower(${c("lapse_reason")}) = ${f.lossReason.toLowerCase()}`);
  return sql.join(parts, sql` AND `);
}

/**
 * Renewals recorded with "Mark renewed": one audit row per renewal, carrying
 * the due date it cleared. A renewal only counts as RENEWAL premium from the
 * policy's second year: a monthly policy's installments 2–12 are first-year
 * premium, already booked with the policy. (15 days' slack, because an annual
 * policy's renewal date is often its expiry — one day short of a year.)
 */
export function renewEvents(w: InsWindow, from: string, to: string): SQL {
  return sql`
    SELECT a.entity_id AS policy_id, ${istDay(sql`a.at`)} AS renewed_on,
           NULLIF(a.before->>'nextPremiumDueDate', '')::date AS due_cleared
      FROM audit_log a
     WHERE a.tenant_id = ${w.tenantId}::uuid AND a.action = 'insurance.renew' AND a.entity_type = 'insurance_policy'
       AND a.at >= (${from}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
       AND a.at < ((${to}::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'`;
}

/** A renewal event that is renewal premium (second policy year onwards). */
export const SECOND_YEAR = (ev = "ev", p = "pol") =>
  sql`(${sql.raw(`${p}.booked_on`)} IS NULL OR ${sql.raw(`${ev}.due_cleared`)} IS NULL
       OR ${sql.raw(`${ev}.due_cleared`)} >= ${sql.raw(`${p}.booked_on`)} + interval '1 year' - interval '15 days')`;

/**
 * A policy moving to lapsed / surrendered / cancelled, from the audit trail —
 * the only record of WHEN it happened. An edit records the new status in
 * `after`; a cancel (DELETE) records the old one in `before`.
 */
export function lostEvents(w: InsWindow, from: string, to: string): SQL {
  return sql`
    SELECT DISTINCT ON (a.entity_id) a.entity_id AS policy_id, ${istDay(sql`a.at`)} AS lost_on,
           CASE WHEN a.action = 'insurance.delete' THEN 'cancelled' ELSE a.after->>'status' END AS lost_status,
           a.before->>'status' AS from_status
      FROM audit_log a
     WHERE a.tenant_id = ${w.tenantId}::uuid AND a.entity_type = 'insurance_policy'
       AND (a.action = 'insurance.delete'
            OR (a.action = 'insurance.update' AND a.after->>'status' IN ('lapsed', 'surrendered', 'cancelled')
                AND a.before->>'status' IS DISTINCT FROM a.after->>'status'))
       AND a.at >= (${from}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
       AND a.at < ((${to}::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'
     ORDER BY a.entity_id, a.at DESC`;
}

/**
 * Claims with the policy's line and the client's branch, scoped like
 * policies: the handler, the client's RM or the policy's owner is "mine".
 */
export function claimBase(w: InsWindow): SQL {
  return sql`
    SELECT c.id, c.policy_id, c.investor_id, COALESCE(i.name, c.proposer_name) AS client, c.claim_status AS status,
           c.claim_type, NULLIF(btrim(COALESCE(c.insurer, p.insurer)), '') AS insurer,
           lower(btrim(COALESCE(c.insurer, p.insurer, ''))) AS insurer_key,
           COALESCE(c.claimed_amount, 0)::numeric AS claimed, COALESCE(c.settled_amount, 0)::numeric AS settled,
           c.intimation_date, c.submission_date, c.settlement_date,
           COALESCE(c.intimation_date, ${istDay(sql`c.created_at`)}) AS opened_on, c.updated_at AS upd,
           c.rm_id AS handler_id, i.rm_id AS client_rm, ${branchSql("c", "i")} AS branch_id,
           ${lineSql("p")} AS line, ${groupSql("p")} AS grp, p.policy_type, p.status AS policy_status,
           p.next_premium_due_date AS policy_due, p.sold_by_user_id AS seller_id,
           upper(btrim(COALESCE(i.client_category, ''))) AS cat,
           CASE WHEN i.investor_category IN ('corporate', 'company', 'llp', 'partnership', 'aop_boi') THEN 'corporate' ELSE 'other' END AS ctype,
           jsonb_array_length(COALESCE(c.documents, '[]'::jsonb)) AS docs
      FROM insurance_claims c
      LEFT JOIN insurance_policies p ON p.id = c.policy_id
      LEFT JOIN investors i ON i.id = c.investor_id
     WHERE c.tenant_id = ${w.tenantId}::uuid`;
}

export function claimWhere(w: InsWindow, a = "cl"): SQL {
  const c = (x: string) => sql.raw(`${a}.${x}`);
  const f = w.filter;
  const parts: SQL[] = [];
  if (w.scope.kind === "branch") parts.push(sql`${c("branch_id")} = ${w.scope.branchId}::uuid`);
  if (w.scope.kind === "self") {
    const me = w.scope.userId;
    parts.push(sql`(${c("handler_id")} = ${me}::uuid OR ${c("client_rm")} = ${me}::uuid OR ${c("seller_id")} = ${me}::uuid)`);
  }
  if (f.line) parts.push(sql`${c("policy_type")} IN (${inList(typesOfLine(f.line))})`);
  if (f.groups?.length) parts.push(sql`${c("policy_type")} IN (${inList(typesOfGroups(f.groups))})`);
  if (f.branchId) parts.push(sql`${c("branch_id")} = ${f.branchId}::uuid`);
  if (f.ownerId) parts.push(sql`(${c("handler_id")} = ${f.ownerId}::uuid OR ${c("client_rm")} = ${f.ownerId}::uuid)`);
  if (f.insurer) parts.push(sql`${c("insurer_key")} = ${f.insurer.trim().toLowerCase()}`);
  if (f.claimType) parts.push(sql`${c("claim_type")} = ${f.claimType}`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

/**
 * Insurance leads — the new-business pipeline before a policy exists. A lead
 * is insurance when its board pipeline is 'insurance' or its blueprint has
 * taken the insurance branch. Deleted leads (lost_reason '__deleted__') are out.
 */
export function leadBase(w: InsWindow): SQL {
  return sql`
    SELECT l.id, l.name, l.lead_type, l.source, l.owner_id, l.branch_id, l.created_at,
           l.expected_business_amount::numeric AS potential, l.next_follow_up_at, l.last_contact_at,
           l.lost_reason, l.lost_at, l.converted_investor_id, NULLIF(btrim(l.profile->>'occupation'), '') AS occupation,
           l.interest_products,
           CASE
             WHEN bi.current_stage_key = 'insurance_needs_analysis' THEN 'needs_analysis'
             WHEN bi.current_stage_key = 'insurance_quote' THEN 'quoted'
             WHEN bi.current_stage_key = 'insurance_proposal' THEN 'proposal'
             WHEN bi.current_stage_key = 'insurance_underwriting' THEN 'underwriting'
             WHEN bi.current_stage_key = 'insurance_policy_issued' THEN 'issued'
             WHEN bi.current_stage_key = 'insurance_lost' THEN 'lost'
             WHEN l.pipeline = 'insurance' THEN COALESCE(NULLIF(l.pipeline_stage, ''), 'inquiry')
             ELSE 'inquiry' END AS stage,
           CASE WHEN bi.current_stage_key LIKE 'insurance_%' THEN bi.stage_entered_at END AS stage_since
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT b.current_stage_key, b.stage_entered_at FROM lead_blueprint_instances b
         WHERE b.lead_id = l.id ORDER BY b.stage_entered_at DESC NULLS LAST LIMIT 1
      ) bi ON true
     WHERE l.tenant_id = ${w.tenantId}::uuid
       AND l.lost_reason IS DISTINCT FROM '__deleted__'
       AND (l.pipeline = 'insurance' OR bi.current_stage_key LIKE 'insurance_%')`;
}

export function leadWhere(w: InsWindow, a = "ld"): SQL {
  const c = (x: string) => sql.raw(`${a}.${x}`);
  const f = w.filter;
  const parts: SQL[] = [];
  if (w.scope.kind === "branch") parts.push(sql`${c("branch_id")} = ${w.scope.branchId}::uuid`);
  if (w.scope.kind === "self") parts.push(sql`${c("owner_id")} = ${w.scope.userId}::uuid`);
  if (f.branchId) parts.push(sql`${c("branch_id")} = ${f.branchId}::uuid`);
  if (f.ownerId) parts.push(sql`${c("owner_id")} = ${f.ownerId}::uuid`);
  if (f.line === "commercial") parts.push(sql`${c("lead_type")} = 'corporate'`);
  if (f.line === "personal") parts.push(sql`${c("lead_type")} IS DISTINCT FROM 'corporate'`);
  if (f.source === "none") parts.push(sql`${c("source")} IS NULL`);
  else if (f.source) parts.push(sql`${c("source")} = ${f.source}`);
  if (f.industry === "none") parts.push(sql`${c("occupation")} IS NULL`);
  else if (f.industry) parts.push(sql`lower(${c("occupation")}) = ${f.industry.toLowerCase()}`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

/* ───────────────────────────── links ───────────────────────────── */

/**
 * The policy register (/dashboard/insurance) with the dashboard's filters
 * carried across, plus the section's own narrowing. The register reads the
 * same definitions (lib/insurance/book.ts), so its rows are the tile's rows.
 */
export function registerHref(w: InsWindow, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  const f = w.filter;
  if (f.line) q.set("line", f.line);
  if (f.groups?.length) q.set("grp", f.groups.join(","));
  if (f.branchId) q.set("branch", f.branchId);
  if (f.ownerId) q.set("owner", f.ownerId);
  if (f.insurer) q.set("insurer", f.insurer);
  if (f.categories?.length) q.set("cat", f.categories.join(","));
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/dashboard/insurance?${s}` : "/dashboard/insurance";
}
