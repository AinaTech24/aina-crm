/**
 * Relationship modules — Leads, Families, Risk Profiles, Discovery (Fact-find)
 * and Client Feedback. Each `where` applies the same tenant, "not deleted",
 * access scope and URL filters as the module's own list, so the file is what
 * is on screen (never wider; where a list itself had no row scope, the export
 * scopes through the client / lead the row belongs to).
 */

import { clientRiskSql, minorSql } from "@/lib/risk-profile/own-assessment";
import { sql, type SQL } from "drizzle-orm";
import { can, requireAny } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { leadScopeSql, requireLeadView } from "@/lib/leads/access";
import { investorScopeSql } from "@/lib/investors/access";
import { familyScopeSql } from "@/lib/families/access";
import { LIVE_MEMBER_JOIN } from "@/lib/families/live";
import { WEALTH_BANDS, WEALTH_BAND_META, bandBounds, bandCaseSql, type WealthBand } from "@/lib/families/wealth-band";
import { LEAD_PIPELINE, LEAD_PIPELINE_STAGE_VALUES, LEAD_STAGE_TAG, leadPipelineColumn } from "@/lib/leads/stages";
import { LEAD_SOURCE_OPTIONS } from "@/lib/leads/sources";
import { leadFieldFilterConds } from "@/lib/leads/field-filters";
import type { LeadCustomFieldDef } from "@/lib/leads/table-columns";
import { leadCreatedInSql, leadOpenSql, leadStageKeySql, leadWhere, textList, riskProfileBaseSql } from "@/lib/metrics";
import { RISK_BUCKETS, riskBucketCaseSql, riskBucketSql, type RiskBucket } from "@/lib/risk-profile/buckets";
import { d, dIst, dt, userName } from "../helpers";
import type { ExportModule } from "../types";

// ── Shared bits ─────────────────────────────────────────────────────────────

/** A stored code as its label; anything unlisted reads humanised ("call_back" → "Call Back"). */
function labelCase(expr: SQL, labels: Record<string, string>): SQL {
  const whens = Object.entries(labels).map(([k, v]) => sql`WHEN ${k} THEN ${v}`);
  return sql`(CASE ${expr} ${sql.join(whens, sql` `)} ELSE initcap(replace(${expr}::text, '_', ' ')) END)`;
}

/** "a, b" from a jsonb array of strings (anything else → blank). */
const jsonList = (expr: SQL, humanise = false) => sql`(SELECT string_agg(${humanise ? sql`initcap(replace(e_, '_', ' '))` : sql`e_`}, ', ')
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${expr}) = 'array' THEN ${expr} ELSE '[]'::jsonb END) AS e_)`;

/** A jsonb number as numeric, blank when it is not one. */
const jsonNum = (expr: SQL) => sql`(CASE WHEN jsonb_typeof(${expr}) = 'number' THEN (${expr})::text::numeric END)`;

const hasInvestorView = (s: SessionUser) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "investor.view.assigned", s.permissions);
const hasLeadView = (s: SessionUser) =>
  can(s.roles, "lead.view.all", s.permissions) || can(s.roles, "lead.view.assigned", s.permissions);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const csv = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

// ── Leads ───────────────────────────────────────────────────────────────────

/** A lead on the board — the Leads page's ON_BOARD, verbatim. */
const BOARD_STAGE_VALUES = [...LEAD_PIPELINE_STAGE_VALUES, "", "insurance_lost"];
const ON_BOARD = sql`(leads.converted_investor_id IS NULL
  AND lower(btrim(COALESCE(leads.stage::text, ''))) IN (${textList(BOARD_STAGE_VALUES)}))`;

const STAGE_COLUMN_LABELS = Object.fromEntries(LEAD_PIPELINE.map((c) => [c.key, c.label]));
const SOURCE_LABELS: Record<string, string> = {
  ...Object.fromEntries(LEAD_SOURCE_OPTIONS.map((o) => [o.value, o.label])),
  existing_client: "Client Referral",
};
/** Every stored stage → what the list cell says ("Contacted · Call back later"). */
const STAGE_DETAIL_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_PIPELINE.flatMap((c) => c.members.map((m) => [m, LEAD_STAGE_TAG[m] ? `${c.label} · ${LEAD_STAGE_TAG[m]}` : c.label])),
);
const LEAD_TYPES: Record<string, string> = { individual: "Individual", hni: "HNI", nri: "NRI", huf: "HUF", corporate: "Corporate", minor: "Minor" };
const AUM_BANDS: Record<string, string> = {
  under_10l: "< ₹10 L",
  "10l_50l": "₹10 – 50 L",
  "50l_2cr": "₹50 L – 2 Cr",
  hni_2cr_plus: "HNI · ₹2 Cr+",
};

const l = (c: string) => sql.raw(`leads.${c}`);

export const leadsExport: ExportModule = {
  key: "leads",
  label: "Leads",
  fileName: "leads",
  piiSubject: "lead",
  canView: hasLeadView,
  from: sql`leads LEFT JOIN users lo ON lo.id = leads.owner_id`,
  async where(tx, session, params) {
    requireLeadView(session);
    const sp: Record<string, string> = Object.fromEntries(params);
    const conds: SQL[] = [
      sql`leads.tenant_id = ${session.tenantId}::uuid`,
      // Not soft-deleted (lost_reason '__deleted__'), as lib/metrics leadWhere reads it.
      leadWhere({ tenantId: session.tenantId }, "leads"),
      leadScopeSql(session, "leads"),
    ];
    // include_won=1 lifts "on the board" only.
    if (sp.include_won !== "1") conds.push(ON_BOARD);

    const customDefs = (await tx.execute(sql`
      SELECT key, label, type FROM custom_field_defs
       WHERE tenant_id = ${session.tenantId}::uuid AND entity = 'lead'
    `)).rows as LeadCustomFieldDef[];
    conds.push(...leadFieldFilterConds(sp, customDefs));

    const q = (sp.q ?? "").trim();
    if (q) conds.push(sql`(leads.name ILIKE ${`%${q}%`} OR leads.phone ILIKE ${`%${q}%`} OR leads.email ILIKE ${`%${q}%`} OR lo.name ILIKE ${`%${q}%`})`);

    const stages = csv(params.get("stage"));
    if (stages.length) {
      const keys = [...new Set(stages.map((s) => leadPipelineColumn(s)?.key ?? s))];
      conds.push(sql`(${leadStageKeySql("leads")}) IN (${textList(keys)})`);
    }
    const sources = csv(params.get("source"));
    const owners = csv(params.get("owner"));
    const branches = csv(params.get("branch")).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    if (sources.length || owners.length || branches.length) {
      conds.push(leadWhere({ tenantId: session.tenantId, rmIds: owners, branchIds: branches, leadSources: sources }, "leads"));
    }
    if (sp.followup_due === "1") {
      conds.push(sql`${leadOpenSql("leads")} AND leads.next_follow_up_at IS NOT NULL
        AND (leads.next_follow_up_at AT TIME ZONE 'Asia/Kolkata')::date <= (now() AT TIME ZONE 'Asia/Kolkata')::date`);
    }
    // Quick filters (LeadQuickFilters), as the page applies them.
    if (sp.mine === "1") conds.push(sql`leads.owner_id = ${session.userId}::uuid`);
    if (sp.unassigned === "1") conds.push(sql`leads.owner_id IS NULL`);
    if (sp.hot === "1") conds.push(sql`leads.score_band = 'hot'`);
    if (sp.stuck === "1") conds.push(sql`COALESCE(leads.stage_changed_at, leads.updated_at, leads.created_at) < now() - interval '14 days'`);
    if (sp.followup_today === "1") conds.push(sql`leads.next_follow_up_at::date = current_date`);
    if (sp.followup_overdue === "1") conds.push(sql`leads.next_follow_up_at IS NOT NULL AND leads.next_follow_up_at < now()`);
    if (sp.new_week === "1") conds.push(sql`leads.created_at >= now() - interval '7 days'`);

    const from = ISO_DATE.test(sp.created_from ?? "") ? sp.created_from : "";
    const to = ISO_DATE.test(sp.created_to ?? "") ? sp.created_to : "";
    if (from || to) conds.push(leadCreatedInSql({ from: from || "1900-01-01", to: to || "9999-12-31" }, "leads"));
    return conds;
  },
  orderBy: sql`leads.lead_score DESC, leads.updated_at DESC`,
  columns: [
    { key: "name", label: "Name", group: "Lead", sql: l("name"), default: true },
    { key: "stage", label: "Stage", group: "Lead", sql: labelCase(leadStageKeySql("leads"), STAGE_COLUMN_LABELS), default: true },
    { key: "stage_detail", label: "Stage (detailed)", group: "Lead", sql: labelCase(l("stage"), STAGE_DETAIL_LABELS) },
    { key: "score", label: "Lead score", group: "Lead", sql: l("lead_score"), kind: "number", default: true },
    { key: "score_band", label: "Score band", group: "Lead", sql: sql`initcap(leads.score_band)` },
    { key: "source", label: "Source", group: "Lead", sql: labelCase(l("source"), SOURCE_LABELS), default: true },
    { key: "owner", label: "Owner (RM)", group: "Lead", sql: sql`lo.name`, default: true },
    { key: "branch", label: "Branch", group: "Lead", sql: sql`(SELECT b.name FROM branches b WHERE b.id = leads.branch_id)` },
    { key: "in_stage", label: "In stage since", group: "Lead", sql: dIst(l("stage_changed_at")), kind: "date" },

    { key: "phone", label: "Mobile", group: "Contact", sql: l("phone"), pii: "phone", default: true },
    { key: "alt_phone", label: "Alternate mobile", group: "Contact", sql: l("alt_phone"), pii: "phone" },
    { key: "email", label: "Email", group: "Contact", sql: l("email"), pii: "email" },
    { key: "alt_email", label: "Alternate email", group: "Contact", sql: l("alt_email"), pii: "email" },
    { key: "city", label: "City", group: "Contact", sql: l("city") },
    { key: "pincode", label: "Pincode", group: "Contact", sql: l("pincode"), pii: "address" },
    { key: "pan", label: "PAN", group: "Contact", sql: sql`upper(leads.pan)`, pii: "pan" },

    { key: "amount", label: "Intended amount", group: "Profile", sql: l("expected_business_amount"), kind: "money", default: true },
    { key: "lead_type", label: "Lead type", group: "Profile", sql: labelCase(l("lead_type"), LEAD_TYPES) },
    { key: "aum_potential", label: "AUM potential", group: "Profile", sql: labelCase(l("aum_potential"), AUM_BANDS) },
    { key: "interest", label: "Interested in", group: "Profile", sql: jsonList(l("interest_products"), true) },
    { key: "occupation", label: "Occupation", group: "Profile", sql: sql`leads.profile->>'occupation'` },
    { key: "holdings", label: "Current investments", group: "Profile", sql: jsonList(sql`leads.profile->'currentInvestments'`, true) },

    { key: "next_fu", label: "Next follow-up", group: "Follow-up", sql: dt(l("next_follow_up_at")), kind: "datetime", default: true },
    { key: "last_fu", label: "Last follow-up", group: "Follow-up", sql: dt(l("last_follow_up_at")), kind: "datetime" },
    { key: "last_contact", label: "Last contacted", group: "Follow-up", sql: dt(l("last_contact_at")), kind: "datetime" },
    { key: "fu_notes", label: "Follow-up notes", group: "Follow-up", sql: l("follow_up_notes") },

    { key: "referred", label: "Referred by", group: "Source & campaign", sql: sql`COALESCE(NULLIF(btrim(leads.referred_by_name), ''), (SELECT ri.name FROM investors ri WHERE ri.id = leads.referred_by_investor_id))` },
    { key: "subdist", label: "Sub-distributor", group: "Source & campaign", sql: sql`(SELECT sd.name FROM sub_distributors sd WHERE sd.id = leads.sub_distributor_id)` },
    { key: "campaign", label: "Campaign", group: "Source & campaign", sql: l("source_campaign") },
    { key: "utm_source", label: "UTM source", group: "Source & campaign", sql: sql`leads.utm_params->>'source'` },
    { key: "utm_medium", label: "UTM medium", group: "Source & campaign", sql: sql`leads.utm_params->>'medium'` },
    { key: "utm_campaign", label: "UTM campaign", group: "Source & campaign", sql: sql`leads.utm_params->>'campaign'` },

    { key: "converted_at", label: "Converted on", group: "Outcome", sql: dIst(l("converted_at")), kind: "date" },
    { key: "converted_client", label: "Converted to client", group: "Outcome", sql: sql`(SELECT ci.name FROM investors ci WHERE ci.id = leads.converted_investor_id)` },
    { key: "lost_reason", label: "Lost reason", group: "Outcome", sql: sql`(CASE WHEN leads.lost_reason LIKE '\\_\\_%' THEN NULL ELSE leads.lost_reason END)` },
    { key: "lost_at", label: "Lost on", group: "Outcome", sql: dIst(l("lost_at")), kind: "date" },

    { key: "tags", label: "Tags", group: "Record", sql: jsonList(l("tags")) },
    { key: "notes", label: "Notes", group: "Record", sql: l("notes") },
    { key: "created", label: "Created on", group: "Record", sql: dIst(l("created_at")), kind: "date", default: true },
    { key: "updated", label: "Last updated", group: "Record", sql: dt(l("updated_at")), kind: "datetime" },
  ],
};

// ── Families ────────────────────────────────────────────────────────────────

const FAMILY_CATEGORIES = ["HNI", "Affluent", "Retail", "NRI", "Corporate"];
const WEALTH_LABELS = Object.fromEntries(WEALTH_BANDS.map((b) => [b, WEALTH_BAND_META[b].label]));
const f = (c: string) => sql.raw(`f.${c}`);

export const familiesExport: ExportModule = {
  key: "families",
  label: "Families",
  fileName: "families",
  piiSubject: "investor",
  canView: (s) => (["family.view", "investor.view.all", "investor.view.assigned"] as const).some((c) => can(s.roles, c, s.permissions)),
  // The list's GROUP BY over live members, as a lateral aggregate so its
  // HAVING filters become plain conditions.
  from: sql`families f
    LEFT JOIN LATERAL (
      SELECT COUNT(i.id)::int AS member_count,
             COALESCE(SUM(i.aum::numeric), 0) AS aum,
             COALESCE(SUM(i.active_sip_amount::numeric), 0) AS sip,
             COUNT(i.id) FILTER (WHERE i.is_minor = true)::int AS minors,
             BOOL_OR(i.id IS NOT NULL AND (i.nominee_name IS NULL OR i.nominee_name = '')) AS nominee_gap,
             BOOL_OR(i.is_minor = true) AS has_minor,
             BOOL_OR(i.segment_tag = 'HNI') AS has_hni
        FROM investors i WHERE ${LIVE_MEMBER_JOIN}
    ) fa ON TRUE
    LEFT JOIN investors fh ON fh.id = f.primary_investor_id AND fh.family_id = f.id`,
  async where(tx, session, params) {
    const conds: SQL[] = [sql`f.tenant_id = ${session.tenantId}::uuid`, await familyScopeSql(tx, session, "f")];
    const q = (params.get("q") ?? "").trim();
    if (q) {
      const digits = q.replace(/\D/g, "");
      conds.push(sql`(
        f.head_name ILIKE ${`%${q}%`}
        OR f.family_name ILIKE ${`%${q}%`}
        OR f.family_code ILIKE ${`%${q}%`}
        OR EXISTS (
          SELECT 1 FROM investors mi WHERE mi.family_id = f.id AND mi.deleted_at IS NULL AND mi.merged_into_id IS NULL
            AND (mi.name ILIKE ${`%${q}%`} OR mi.pan ILIKE ${`%${q.toUpperCase()}%`}
                 ${digits.length >= 6 ? sql`OR regexp_replace(COALESCE(mi.phone, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}` : sql``})
        )
      )`);
    }
    const cats = csv(params.get("category")).filter((c) => FAMILY_CATEGORIES.includes(c));
    if (cats.length) conds.push(sql`f.family_category IN (${textList(cats)})`);
    const flag = (k: string) => params.get(k) === "1";
    if (flag("mine")) conds.push(sql`f.rm_id = ${session.userId}::uuid`);
    if (flag("no_primary")) conds.push(sql`f.primary_investor_id IS NULL`);
    if (flag("no_rm")) conds.push(sql`f.rm_id IS NULL`);
    if (flag("review_due")) conds.push(sql`(f.next_review_at IS NULL OR f.next_review_at <= now())`);
    if (flag("red_health")) conds.push(sql`f.health_band = 'red'`);
    if (flag("nominee_gap")) conds.push(sql`fa.nominee_gap = true`);
    if (flag("has_minor")) conds.push(sql`fa.has_minor = true`);
    if (flag("hni")) conds.push(sql`fa.has_hni = true`);
    if (flag("single")) conds.push(sql`fa.member_count = 1`);
    if (flag("large")) conds.push(sql`fa.member_count >= 5`);
    const band = params.get("band") ?? "";
    if ((WEALTH_BANDS as readonly string[]).includes(band)) {
      const b = bandBounds(band as WealthBand);
      conds.push(b.max == null ? sql`fa.aum >= ${b.min}` : sql`fa.aum >= ${b.min} AND fa.aum < ${b.max}`);
    } else if (!q) {
      // As the list: families with no AUM are hidden unless searched for or ?band=empty.
      conds.push(sql`fa.aum >= 1`);
    }
    return conds;
  },
  orderBy: sql`fa.aum DESC NULLS LAST, f.head_name`,
  columns: [
    { key: "name", label: "Family", group: "Family", sql: sql`COALESCE(NULLIF(f.family_name, ''), f.head_name)`, default: true },
    { key: "code", label: "Family code", group: "Family", sql: f("family_code") },
    { key: "category", label: "Family category", group: "Family", sql: f("family_category") },
    { key: "wealth_band", label: "Wealth band", group: "Family", sql: labelCase(sql.raw(`(${bandCaseSql("fa.aum")})`), WEALTH_LABELS) },
    { key: "head", label: "Head of family", group: "Family", sql: sql`fh.name`, default: true },
    { key: "rm", label: "Relationship manager", group: "Family", sql: userName(f("rm_id")), default: true },
    { key: "branch", label: "Branch", group: "Family", sql: sql`(SELECT b.name FROM branches b WHERE b.id = f.branch_id)` },
    { key: "tags", label: "Tags", group: "Family", sql: jsonList(f("tags")) },
    { key: "notes", label: "Notes", group: "Family", sql: f("notes") },
    { key: "created", label: "Created on", group: "Family", sql: dIst(f("created_at")), kind: "date" },

    { key: "head_phone", label: "Head's mobile", group: "Head contact", sql: sql`fh.phone`, pii: "phone" },
    { key: "head_email", label: "Head's email", group: "Head contact", sql: sql`fh.email`, pii: "email" },

    { key: "members", label: "Members", group: "Portfolio", sql: sql`fa.member_count`, kind: "number", default: true },
    { key: "minors", label: "Minor members", group: "Portfolio", sql: sql`fa.minors`, kind: "number" },
    { key: "aum", label: "Combined AUM", group: "Portfolio", sql: sql`fa.aum`, kind: "money", default: true },
    { key: "sip", label: "SIP / month", group: "Portfolio", sql: sql`fa.sip`, kind: "money", default: true },
    { key: "nominee_gap", label: "A member has no nominee", group: "Portfolio", sql: sql`COALESCE(fa.nominee_gap, false)`, kind: "bool" },

    { key: "next_review", label: "Next review", group: "Reviews & health", sql: dIst(f("next_review_at")), kind: "date", default: true },
    { key: "last_review", label: "Last review", group: "Reviews & health", sql: dIst(f("last_review_at")), kind: "date" },
    { key: "frequency", label: "Review frequency", group: "Reviews & health", sql: labelCase(f("review_frequency"), { half_yearly: "Half-yearly" }) },
    { key: "first_meeting", label: "First meeting", group: "Reviews & health", sql: d(f("first_meeting_date")), kind: "date" },
    { key: "health", label: "Health", group: "Reviews & health", sql: sql`(CASE WHEN f.health_band = 'green' THEN 'OK' ELSE 'At risk' END)` },
    { key: "health_score", label: "Health score", group: "Reviews & health", sql: f("health_score"), kind: "number" },
  ],
};

// ── Risk Profiles ───────────────────────────────────────────────────────────

const RISK_BUCKET_LABELS = Object.fromEntries(RISK_BUCKETS.map((b) => [b.key, b.label]));
const VERIFICATION_LABELS: Record<string, string> = {
  rm_entry: "Entered by RM",
  client_otp: "Client (OTP verified)",
  client_physical: "Signed paper form",
  client_link: "Client (secure link)",
};
const PAN_RE = `'^[A-Z]{5}[0-9]{4}[A-Z]$'`;
const i = (c: string) => sql.raw(`i.${c}`);

/** A minor's risk is their own assessment, never the guardian's copy (G-1). */
const OWN_RISK = clientRiskSql("i");

export const riskProfilesExport: ExportModule = {
  key: "risk-profiles",
  label: "Risk Profiles",
  fileName: "risk-profiles",
  piiSubject: "investor",
  canView: hasInvestorView,
  // The guardian is joined only when this user may open them (G-1): a hidden
  // guardian's name is blank. A minor's risk columns are the minor's own
  // assessment, never the guardian's copy (migration 0234).
  from: async (tx, session) => sql`investors i
    LEFT JOIN investors g ON g.id = i.guardian_investor_id AND g.tenant_id = i.tenant_id AND ${await investorScopeSql(tx, session, "g")}
    LEFT JOIN LATERAL (
      SELECT r.total_score, r.next_review_at, r.signed_at, r.signed_by_name, r.verification_method,
             r.profile_date, r.age, r.investment_horizon, r.income_stability, r.risk_capacity, r.risk_tolerance,
             r.investment_objective, r.mf_experience, r.net_worth_band, r.rm_remarks, r.basis
        FROM risk_profile_responses r
       WHERE r.investor_id = i.id
       ORDER BY r.signed_at DESC NULLS LAST
       LIMIT 1
    ) rp ON TRUE`,
  async where(tx, session, params) {
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "investor.view.all", session.permissions);
    const rm = params.get("rm");
    const branch = params.get("branch");
    // The page's base: active clients, an RM's own book for non-managers,
    // narrowed by a drill-down's rm / branch.
    const base = riskProfileBaseSql({
      tenantId: session.tenantId,
      rmIds: canViewAll ? (rm ? rm.split(",") : undefined) : [session.userId],
      branchIds: branch ? branch.split(",") : undefined,
    });
    // The tab (?filter=, comma-separated for a dashboard's combined drill-down).
    const raw = csv(params.get("filter"));
    const tabs = [...new Set(raw.filter((k) => RISK_BUCKETS.some((b) => b.key === k)))] as RiskBucket[];
    const legacy: Record<string, RiskBucket> = { needs_review: "not_profiled", suggested: "awaiting", all: "not_profiled" };
    const picked: RiskBucket[] = tabs.length > 1 ? tabs : [tabs[0] ?? legacy[raw[0] ?? ""] ?? "not_profiled"];
    return [
      sql`i.tenant_id = ${session.tenantId}::uuid`,
      base,
      await investorScopeSql(tx, session, "i"),
      sql`(${sql.join(picked.map((k) => riskBucketSql(k)), sql` OR `)})`,
    ];
  },
  orderBy: sql`i.name ASC`,
  columns: [
    { key: "name", label: "Client", group: "Client", sql: i("name"), default: true },
    { key: "pan", label: "PAN", group: "Client", sql: sql.raw(`(CASE WHEN upper(i.pan) ~ ${PAN_RE} THEN upper(i.pan) END)`), pii: "pan" },
    { key: "minor", label: "Minor", group: "Client", sql: sql.raw(`(i.is_minor IS TRUE OR upper(btrim(i.pan)) LIKE 'MINOR:%')`), kind: "bool" },
    { key: "guardian", label: "Guardian", group: "Client", sql: sql`g.name` },
    { key: "guardian_risk", label: "Guardian's own risk category (not this account's)", group: "Client", sql: sql`(CASE WHEN ${minorSql("i")} THEN initcap(replace(g.risk_profile, '_', ' ')) END)` },
    { key: "rm", label: "Relationship manager", group: "Client", sql: userName(i("rm_id")), default: true },
    { key: "branch", label: "Branch", group: "Client", sql: sql`(SELECT b.name FROM branches b WHERE b.id = i.branch_id)` },
    { key: "phone", label: "Mobile", group: "Client", sql: i("phone"), pii: "phone" },
    { key: "email", label: "Email", group: "Client", sql: i("email"), pii: "email" },

    { key: "category", label: "Risk category", group: "Risk profile", sql: sql`initcap(replace(${OWN_RISK.category}, '_', ' '))`, default: true },
    { key: "suggested", label: "Suggested from age (not confirmed)", group: "Risk profile", sql: sql`(${OWN_RISK.provisional} IS TRUE)`, kind: "bool" },
    { key: "status", label: "Status", group: "Risk profile", sql: labelCase(riskBucketCaseSql(), RISK_BUCKET_LABELS), default: true },
    { key: "score", label: "Score", group: "Risk profile", sql: sql`COALESCE(rp.total_score, ${OWN_RISK.score})`, kind: "number", default: true },
    { key: "signed", label: "Last signed", group: "Risk profile", sql: dIst(OWN_RISK.signedAt), kind: "date", default: true },
    { key: "next_review", label: "Next review", group: "Risk profile", sql: d(sql`rp.next_review_at`), kind: "date", default: true },
    { key: "profile_date", label: "Profile date", group: "Risk profile", sql: d(sql`rp.profile_date`), kind: "date" },
    { key: "verification", label: "How it was taken", group: "Risk profile", sql: labelCase(sql`rp.verification_method`, VERIFICATION_LABELS) },
    { key: "signed_by", label: "Signed by", group: "Risk profile", sql: sql`rp.signed_by_name` },
    { key: "basis", label: "Suggestion basis", group: "Risk profile", sql: labelCase(sql`rp.basis`, { age_band: "Age band" }) },
    { key: "remarks", label: "RM remarks", group: "Risk profile", sql: sql`rp.rm_remarks` },

    { key: "age", label: "Age at profiling", group: "Answers", sql: sql`rp.age`, kind: "number" },
    { key: "horizon", label: "Investment horizon", group: "Answers", sql: sql`replace(rp.investment_horizon, '_', ' ')` },
    { key: "income_stability", label: "Income stability", group: "Answers", sql: sql`replace(rp.income_stability, '_', ' ')` },
    { key: "risk_capacity", label: "Risk capacity", group: "Answers", sql: sql`replace(rp.risk_capacity, '_', ' ')` },
    { key: "risk_tolerance", label: "Risk tolerance", group: "Answers", sql: sql`replace(rp.risk_tolerance, '_', ' ')` },
    { key: "objective", label: "Investment objective", group: "Answers", sql: sql`replace(rp.investment_objective, '_', ' ')` },
    { key: "mf_experience", label: "MF experience", group: "Answers", sql: sql`replace(rp.mf_experience, '_', ' ')` },
    { key: "net_worth", label: "Net worth band", group: "Answers", sql: sql`replace(rp.net_worth_band, '_', ' ')` },
  ],
};

// ── Discovery (Fact-find) ───────────────────────────────────────────────────

const fd = (c: string) => sql.raw(`fd.${c}`);
const comp = (k: string) => jsonNum(sql.raw(`fd.computed->'${k}'`));
const ident = (k: string) => sql.raw(`NULLIF(btrim(fd.data->'identification'->>'${k}'), '')`);

export const discoveryExport: ExportModule = {
  key: "discovery",
  label: "Discovery (Fact-find)",
  fileName: "discovery",
  piiSubject: "investor",
  canView: (s) => hasInvestorView(s) || hasLeadView(s),
  from: sql`financial_discoveries fd`,
  async where(tx, session) {
    requireAny(session.roles, ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"], session.permissions);
    // The list has no row scope of its own; a discovery is about a client or
    // a lead, so it follows that person's visibility.
    const visible: SQL[] = [];
    if (hasInvestorView(session)) {
      visible.push(sql`(fd.subject_type = 'investor' AND EXISTS (
        SELECT 1 FROM investors di WHERE di.id = fd.subject_id AND di.tenant_id = fd.tenant_id AND ${await investorScopeSql(tx, session, "di")}))`);
    }
    if (hasLeadView(session)) {
      visible.push(sql`(fd.subject_type = 'lead' AND EXISTS (
        SELECT 1 FROM leads dl WHERE dl.id = fd.subject_id AND dl.tenant_id = fd.tenant_id AND ${leadScopeSql(session, "dl")}))`);
    }
    return [
      sql`fd.tenant_id = ${session.tenantId}::uuid`,
      visible.length ? sql`(${sql.join(visible, sql` OR `)})` : sql`FALSE`,
    ];
  },
  orderBy: sql`fd.updated_at DESC`,
  columns: [
    { key: "title", label: "Client / lead", group: "Discovery", sql: sql`COALESCE(fd.title, 'Untitled discovery')`, default: true },
    { key: "type", label: "Type", group: "Discovery", sql: sql`initcap(fd.subject_type::text)`, default: true },
    { key: "review_type", label: "Review type", group: "Discovery", sql: fd("review_type") },
    { key: "status", label: "Status", group: "Discovery", sql: sql`initcap(fd.status::text)`, default: true },
    { key: "rm", label: "Assigned RM", group: "Discovery", sql: userName(fd("assigned_rm_id")), default: true },
    { key: "created_by", label: "Created by", group: "Discovery", sql: userName(fd("created_by")) },
    { key: "created", label: "Created on", group: "Discovery", sql: dIst(fd("created_at")), kind: "date" },
    { key: "updated", label: "Last updated", group: "Discovery", sql: dt(fd("updated_at")), kind: "datetime", default: true },
    { key: "shared", label: "Shared with client", group: "Discovery", sql: dt(fd("shared_at")), kind: "datetime" },
    { key: "submitted", label: "Submitted by client", group: "Discovery", sql: dt(fd("submitted_at")), kind: "datetime" },
    { key: "reviewed", label: "Reviewed", group: "Discovery", sql: dt(fd("reviewed_at")), kind: "datetime" },

    { key: "mobile", label: "Mobile", group: "Identification", sql: ident("mobile"), pii: "phone" },
    { key: "email", label: "Email", group: "Identification", sql: ident("email"), pii: "email" },
    { key: "pan", label: "PAN", group: "Identification", sql: sql`upper(${ident("pan")})`, pii: "pan" },
    { key: "city", label: "City", group: "Identification", sql: ident("city") },

    { key: "health_score", label: "Health score", group: "Assessment", sql: fd("health_score"), kind: "number", default: true },
    { key: "health_band", label: "Health band", group: "Assessment", sql: sql`fd.computed->>'healthBand'` },
    { key: "risk_band", label: "Risk band", group: "Assessment", sql: sql`fd.computed->'risk'->>'bandLabel'` },
    { key: "risk_score", label: "Risk score", group: "Assessment", sql: jsonNum(sql`fd.computed->'risk'->'score'`), kind: "number" },

    { key: "income", label: "Gross annual income", group: "Financials", sql: comp("grossAnnualIncome"), kind: "money" },
    { key: "monthly_expenses", label: "Monthly expenses", group: "Financials", sql: comp("monthlyExpenses"), kind: "money" },
    { key: "surplus", label: "Net investable surplus (annual)", group: "Financials", sql: comp("netInvestableSurplus"), kind: "money" },
    { key: "sip_capacity", label: "Monthly SIP capacity", group: "Financials", sql: comp("monthlySipCapacity"), kind: "money" },
    { key: "assets", label: "Total assets", group: "Financials", sql: comp("totalAssets"), kind: "money" },
    { key: "liabilities", label: "Total liabilities", group: "Financials", sql: comp("totalLiabilities"), kind: "money" },
    { key: "net_worth", label: "Net worth", group: "Financials", sql: comp("netWorth"), kind: "money" },
    { key: "emergency_target", label: "Emergency fund target", group: "Financials", sql: comp("emergencyFundTarget"), kind: "money" },

    { key: "life_cover", label: "Life cover held", group: "Insurance & goals", sql: comp("totalLifeCover"), kind: "money" },
    { key: "life_recommended", label: "Life cover recommended", group: "Insurance & goals", sql: comp("recommendedLifeCover"), kind: "money" },
    { key: "life_gap", label: "Life cover gap", group: "Insurance & goals", sql: comp("lifeCoverGap"), kind: "money" },
    { key: "health_cover", label: "Health cover held", group: "Insurance & goals", sql: comp("totalHealthCover"), kind: "money" },
    { key: "goal_corpus", label: "Goals: corpus needed", group: "Insurance & goals", sql: comp("totalCorpusTarget"), kind: "money" },
    { key: "goal_sip", label: "Goals: SIP needed / month", group: "Insurance & goals", sql: comp("totalSipNeeded"), kind: "money" },
    { key: "affordability", label: "SIP capacity minus SIP needed", group: "Insurance & goals", sql: comp("affordabilityGap"), kind: "money" },
  ],
};

// ── Client Feedback ─────────────────────────────────────────────────────────

const sr = (c: string) => sql.raw(`sr.${c}`);
const FEEDBACK_CAPS = [
  "investor.view.all",
  "investor.view.assigned",
  "service_request.view.all",
  "service_request.view.assigned",
  "service_request.manage",
] as const;

export const clientFeedbackExport: ExportModule = {
  key: "client-feedback",
  label: "Client Feedback",
  fileName: "client-feedback",
  piiSubject: "investor",
  canView: (s) => FEEDBACK_CAPS.some((c) => can(s.roles, c, s.permissions)),
  from: sql`service_requests sr LEFT JOIN investors i ON i.id = sr.investor_id`,
  async where(tx, session) {
    requireAny(session.roles, [...FEEDBACK_CAPS], session.permissions);
    // The page lists the firm's feedback; a named client's answer still
    // follows that client's visibility (TRUE unless the firm walls its books).
    let scope: SQL;
    if (hasInvestorView(session)) scope = sql`(sr.investor_id IS NULL OR ${await investorScopeSql(tx, session, "i")})`;
    else if (can(session.roles, "service_request.view.all", session.permissions) || can(session.roles, "service_request.manage", session.permissions)) scope = sql`TRUE`;
    else scope = sql`sr.investor_id IS NULL`;
    return [sql`sr.tenant_id = ${session.tenantId}::uuid`, sql`sr.type = 'feedback'`, scope];
  },
  orderBy: sql`sr.csat_at DESC NULLS LAST`,
  columns: [
    { key: "client", label: "Client", group: "Feedback", sql: sql`COALESCE(i.name, 'Anonymous')`, default: true },
    { key: "rating", label: "Rating (0–10)", group: "Feedback", sql: sr("csat_rating"), kind: "number", default: true },
    { key: "nps_group", label: "NPS group", group: "Feedback", sql: sql`(CASE WHEN sr.csat_rating IS NULL THEN NULL WHEN sr.csat_rating >= 9 THEN 'Promoter' WHEN sr.csat_rating >= 7 THEN 'Passive' ELSE 'Detractor' END)`, default: true },
    { key: "comment", label: "Comment", group: "Feedback", sql: sr("csat_comment"), default: true },
    { key: "answers", label: "Answers by question", group: "Feedback", sql: sql`(SELECT string_agg(concat(a_->>'label', ': ', a_->>'score'), '; ')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(sr.csat_responses) = 'array' THEN sr.csat_responses ELSE '[]'::jsonb END) AS a_)` },
    { key: "submitted", label: "Submitted", group: "Feedback", sql: dt(sr("csat_at")), kind: "datetime", default: true },

    { key: "ticket", label: "Ticket no.", group: "Request", sql: sr("ticket_no") },
    { key: "subject", label: "Subject", group: "Request", sql: sr("subject") },
    { key: "channel", label: "Channel", group: "Request", sql: sql`initcap(replace(sr.channel, '_', ' '))` },
    { key: "status", label: "Status", group: "Request", sql: sql`initcap(replace(sr.status, '_', ' '))` },
    { key: "sent", label: "Survey created", group: "Request", sql: dt(sr("created_at")), kind: "datetime" },

    { key: "rm", label: "Relationship manager", group: "Client", sql: userName(sql`i.rm_id`), default: true },
    { key: "phone", label: "Mobile", group: "Client", sql: sql`i.phone`, pii: "phone" },
    { key: "email", label: "Email", group: "Client", sql: sql`i.email`, pii: "email" },
  ],
};
