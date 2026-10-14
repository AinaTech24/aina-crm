/**
 * Every lead field as a Leads filter — the filter side of table-columns.ts
 * (the firm asked for all fields as columns, then "same way in filters").
 * Stage, Source, Owner and Created stay where the page defines them; these
 * follow, grouped like "Manage columns", then one filter per custom lead field.
 *
 * - Fields with a short vocabulary (lead type, AUM band, pipeline, score band)
 *   and fields whose values repeat (city, occupation, campaign, tags…) are
 *   pick lists; the repeating ones list what the viewer's own book holds, so
 *   no option leads to an empty list and nothing outside the book is named.
 * - Free text (notes, PAN, pincode, contact details) is "contains".
 * - Dates are India dates, both ends inclusive.
 *
 * Every value reaches SQL as a parameter. URL keys are fixed here, so a
 * hand-edited URL can only narrow, never break the query.
 */

import { sql, type SQL } from "drizzle-orm";
import type { CompactFilter } from "@/components/common/CompactFilterBar";
import { MASTER_SEEDS } from "@/lib/masters/seeds";
import { humanise } from "@/lib/format";
import { textList } from "@/lib/metrics";
import type { LeadCustomFieldDef } from "@/lib/leads/table-columns";

type Params = Record<string, string | undefined>;
type Option = { value: string; label: string };

/** Pick-list values found in the viewer's book, by filter key. */
export type LeadFilterOptions = Record<string, Option[]>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTACT = "Contact";
const PROFILE = "Profile";
const PIPELINE = "Stage & score";
const FOLLOW_UP = "Follow-up";
const SOURCE = "Source & campaign";
const OUTCOME = "Outcome";
const RECORD = "Record";
const CUSTOM = "Custom fields";

const LEAD_TYPES: Option[] = [
  { value: "individual", label: "Individual" },
  { value: "hni", label: "HNI" },
  { value: "nri", label: "NRI" },
  { value: "huf", label: "HUF" },
  { value: "corporate", label: "Corporate" },
  { value: "minor", label: "Minor" },
];
const AUM_BANDS: Option[] = [
  { value: "under_10l", label: "< ₹10 L" },
  { value: "10l_50l", label: "₹10 – 50 L" },
  { value: "50l_2cr", label: "₹50 L – 2 Cr" },
  { value: "hni_2cr_plus", label: "HNI · ₹2 Cr+" },
];
const SCORE_BANDS: Option[] = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
];
const INTERESTS = new Map((MASTER_SEEDS.interest_product ?? []).map((r) => [r.key, r.label]));

/**
 * The expected business a lead brings, in rupees: the numeric column, else
 * the legacy text intended_amount the list's "Intended Amount" column shows
 * (older and imported leads carry only that). Text that is not a plain number
 * once commas and ₹ are dropped never matches — it is never cast blindly.
 */
const AMOUNT_SQL = sql`COALESCE(leads.expected_business_amount,
  CASE WHEN regexp_replace(COALESCE(leads.intended_amount, ''), '[^0-9.]', '', 'g') ~ '^[0-9]+(\\.[0-9]+)?$'
       THEN regexp_replace(leads.intended_amount, '[^0-9.]', '', 'g')::numeric END)`;

const AMOUNT_PRESETS = [
  { label: "Under ₹1 L", max: 100000 },
  { label: "₹1 L – ₹10 L", min: 100000, max: 1000000 },
  { label: "₹10 L – ₹50 L", min: 1000000, max: 5000000 },
  { label: "₹50 L – ₹1 Cr", min: 5000000, max: 10000000 },
  { label: "₹1 Cr and above", min: 10000000 },
];

/**
 * Pick lists drawn from the book: [filter key, SQL value, SQL label source].
 * Text values group case- and space-insensitively so "Pune" and "pune " are
 * one option.
 */
const BOOK_TEXT_LISTS: [string, SQL][] = [
  ["city", sql`leads.city`],
  ["occupation", sql`leads.profile->>'occupation'`],
  ["campaign", sql`leads.source_campaign`],
  ["utm_source", sql`leads.utm_params->>'source'`],
  ["utm_medium", sql`leads.utm_params->>'medium'`],
  ["utm_campaign", sql`leads.utm_params->>'campaign'`],
  ["lost_reason", sql`CASE WHEN leads.lost_reason LIKE '\\_\\_%' THEN NULL ELSE leads.lost_reason END`],
];
/** jsonb arrays of plain strings. */
const BOOK_ARRAY_LISTS: [string, SQL][] = [
  ["interest", sql`leads.interest_products`],
  ["holdings", sql`leads.profile->'currentInvestments'`],
  ["tags", sql`leads.tags`],
];

/**
 * Load the pick lists for the viewer's book (`bookWhere` = the page's tenant,
 * not-deleted and role scope), plus sub-distributors and branches. One round
 * trip; at most 200 values per list.
 */
export async function loadLeadFilterOptions(tx: any, tenantId: string, bookWhere: SQL): Promise<LeadFilterOptions> {
  // The book is read ONCE (materialized CTE) and every list groups that —
  // one scan of leads instead of one per list (see loadInvestorFilterOptions).
  const cols = [
    ...BOOK_TEXT_LISTS.map(([, expr], i) => sql`btrim(${expr}) AS ${sql.raw(`c${i}`)}`),
    ...BOOK_ARRAY_LISTS.map(([, expr], i) => sql`CASE WHEN jsonb_typeof(${expr}) = 'array' THEN ${expr} ELSE '[]'::jsonb END AS ${sql.raw(`a${i}`)}`),
  ];
  const parts = [
    ...BOOK_TEXT_LISTS.map(([key], i) => {
      const c = sql.raw(`c${i}`);
      return sql`
      (SELECT ${key}::text AS f, lower(${c}) AS v, min(${c}) AS l
       FROM book WHERE COALESCE(${c}, '') <> ''
       GROUP BY 2 ORDER BY 3 LIMIT 200)`;
    }),
    ...BOOK_ARRAY_LISTS.map(([key], i) => sql`
      (SELECT ${key}::text AS f, e AS v, e AS l
       FROM book, jsonb_array_elements_text(${sql.raw(`a${i}`)}) AS e
       WHERE btrim(e) <> ''
       GROUP BY e ORDER BY e LIMIT 200)`),
    sql`(SELECT 'subdist'::text AS f, id::text AS v, name AS l FROM sub_distributors WHERE tenant_id = ${tenantId}::uuid ORDER BY name LIMIT 200)`,
    sql`(SELECT 'branch'::text AS f, id::text AS v, name AS l FROM branches WHERE tenant_id = ${tenantId}::uuid ORDER BY name LIMIT 200)`,
  ];
  const res = await tx.execute(sql`
    WITH book AS MATERIALIZED (SELECT ${sql.join(cols, sql`, `)} FROM leads WHERE ${bookWhere})
    ${sql.join(parts, sql` UNION ALL `)}`);
  const out: LeadFilterOptions = {};
  for (const r of res.rows as { f: string; v: string; l: string }[]) {
    const label =
      r.f === "interest" ? INTERESTS.get(r.v) ?? humanise(r.v)
      : r.f === "holdings" ? humanise(r.v)
      : r.l;
    (out[r.f] ??= []).push({ value: r.v, label });
  }
  return out;
}

const multi = (key: string, label: string, group: string, options: Option[]): CompactFilter => ({ type: "multi", key, label, group, options });
const text = (key: string, label: string, group: string, placeholder?: string): CompactFilter => ({ type: "text", key, label, group, placeholder });
const dates = (key: string, label: string, group: string): CompactFilter => ({ type: "date_range", key, label, group });

const cfKey = (key: string) => `cf_${key}`;

/** The filter definitions, in panel order. Empty pick lists are left out. */
export function leadFieldFilterDefs(options: LeadFilterOptions, customDefs: (LeadCustomFieldDef & { options?: string[] | null })[]): CompactFilter[] {
  const list = (k: string) => options[k] ?? [];
  const defs: (CompactFilter | null)[] = [
    { type: "amount_range", key: "amount", label: "Intended amount", group: PIPELINE, presets: AMOUNT_PRESETS },
    dates("in_stage", "In stage since", PIPELINE),
    multi("band", "Score band", PIPELINE, SCORE_BANDS),
    text("mobile", "Mobile", CONTACT, "Digits, e.g. 98765"),
    text("alt_mobile", "Alternate mobile", CONTACT, "Digits"),
    text("email", "Email", CONTACT),
    text("alt_email", "Alternate email", CONTACT),
    list("city").length ? multi("city", "City", CONTACT, list("city")) : null,
    text("pincode", "Pincode", CONTACT),
    text("pan", "PAN", CONTACT, "e.g. ABCDE"),
    multi("lead_type", "Lead type", PROFILE, LEAD_TYPES),
    multi("aum", "AUM potential", PROFILE, AUM_BANDS),
    list("interest").length ? multi("interest", "Interested in", PROFILE, list("interest")) : null,
    list("occupation").length ? multi("occupation", "Occupation", PROFILE, list("occupation")) : null,
    list("holdings").length ? multi("holdings", "Current investments", PROFILE, list("holdings")) : null,
    dates("next_fu", "Next follow-up", FOLLOW_UP),
    dates("last_fu", "Last follow-up", FOLLOW_UP),
    dates("last_contact", "Last contacted", FOLLOW_UP),
    text("fu_notes", "Follow-up notes", FOLLOW_UP),
    text("referred", "Referred by", SOURCE, "Name"),
    list("subdist").length ? multi("subdist", "Sub-distributor", SOURCE, list("subdist")) : null,
    list("campaign").length ? multi("campaign", "Campaign", SOURCE, list("campaign")) : null,
    list("utm_source").length ? multi("utm_source", "UTM source", SOURCE, list("utm_source")) : null,
    list("utm_medium").length ? multi("utm_medium", "UTM medium", SOURCE, list("utm_medium")) : null,
    list("utm_campaign").length ? multi("utm_campaign", "UTM campaign", SOURCE, list("utm_campaign")) : null,
    dates("converted", "Converted on", OUTCOME),
    list("lost_reason").length ? multi("lost_reason", "Lost reason", OUTCOME, list("lost_reason")) : null,
    dates("lost", "Lost on", OUTCOME),
    // `branch` is the dashboard's own lead-branch param (lib/metrics leadWhere),
    // read by the page — this only gives it a control.
    list("branch").length > 1 ? multi("branch", "Branch", RECORD, list("branch")) : null,
    list("tags").length ? multi("tags", "Tags", RECORD, list("tags")) : null,
    text("notes", "Notes", RECORD),
    dates("updated", "Last updated", RECORD),
    ...customDefs.map((d): CompactFilter => {
      const key = cfKey(d.key);
      const opts = (d.options ?? []).map((o) => ({ value: o, label: o }));
      switch (d.type) {
        case "select":
        case "radio":
        case "multiselect":
          return opts.length ? multi(key, d.label, CUSTOM, opts) : text(key, d.label, CUSTOM);
        case "checkbox":
          return { type: "select", key, label: d.label, group: CUSTOM, allLabel: "Any", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
        case "date":
          return dates(key, d.label, CUSTOM);
        case "currency":
          return { type: "amount_range", key, label: d.label, group: CUSTOM };
        default:
          return text(key, d.label, CUSTOM);
      }
    }),
  ];
  return defs.filter((d): d is CompactFilter => d != null);
}

// ── Conditions ──────────────────────────────────────────────────────────────

const csv = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 100);
const like = (v: string) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const anyOf = (values: string[]) => sql`ARRAY[${textList(values)}]::text[]`;

/**
 * India-date range on a timestamp expression, either end optional. `plain`:
 * the expression is already a date (a custom date field) and is not shifted.
 */
function inDates(expr: SQL, from: string | undefined, to: string | undefined, plain = false): SQL | null {
  const f = ISO.test(from ?? "") ? from! : "";
  const t = ISO.test(to ?? "") ? to! : "";
  if (!f && !t) return null;
  const day = plain ? expr : sql`(${expr} AT TIME ZONE 'Asia/Kolkata')::date`;
  if (f && t) return sql`${day} BETWEEN ${f}::date AND ${t}::date`;
  return f ? sql`${day} >= ${f}::date` : sql`${day} <= ${t}::date`;
}

/** Rupee range: min inclusive, max exclusive (CompactFilterBar's contract). */
function inAmount(expr: SQL, min: string | undefined, max: string | undefined): SQL | null {
  const lo = min && Number.isFinite(Number(min)) ? Number(min) : null;
  const hi = max && Number.isFinite(Number(max)) ? Number(max) : null;
  if (lo == null && hi == null) return null;
  const parts: SQL[] = [sql`${expr} IS NOT NULL`];
  if (lo != null) parts.push(sql`${expr} >= ${lo}`);
  if (hi != null) parts.push(sql`${expr} < ${hi}`);
  return sql.join(parts, sql` AND `);
}

/** A jsonb array of strings that holds any of the values. */
const arrayHasAny = (expr: SQL, values: string[]) =>
  sql`(jsonb_typeof(${expr}) = 'array' AND ${expr} ?| ${anyOf(values)})`;

/** Text compared case- and space-insensitively, as the pick lists group it. */
const textIn = (expr: SQL, values: string[]) => sql`lower(btrim(${expr})) IN (${textList(values.map((v) => v.toLowerCase()))})`;
const digits = (expr: SQL) => sql`regexp_replace(COALESCE(${expr}, ''), '[^0-9]', '', 'g')`;

/**
 * The SQL conditions for every field filter present in the URL (`branch` is
 * the page's own). Each only narrows.
 */
export function leadFieldFilterConds(sp: Params, customDefs: LeadCustomFieldDef[]): SQL[] {
  const out: (SQL | null)[] = [];
  const many = (key: string, build: (vals: string[]) => SQL) => {
    const vals = csv(sp[key]);
    if (vals.length) out.push(build(vals));
  };
  const contains = (key: string, build: (pattern: string) => SQL) => {
    const v = (sp[key] ?? "").trim();
    if (v) out.push(build(like(v)));
  };

  out.push(inAmount(AMOUNT_SQL, sp.amount_min, sp.amount_max));
  out.push(inDates(sql`leads.stage_changed_at`, sp.in_stage_from, sp.in_stage_to));
  many("band", (v) => sql`leads.score_band IN (${textList(v)})`);

  const mobile = (sp.mobile ?? "").replace(/\D/g, "");
  if (mobile) out.push(sql`${digits(sql`leads.phone`)} LIKE ${`%${mobile}%`}`);
  const altMobile = (sp.alt_mobile ?? "").replace(/\D/g, "");
  if (altMobile) out.push(sql`${digits(sql`leads.alt_phone`)} LIKE ${`%${altMobile}%`}`);
  contains("email", (p) => sql`leads.email ILIKE ${p}`);
  contains("alt_email", (p) => sql`leads.alt_email ILIKE ${p}`);
  many("city", (v) => textIn(sql`leads.city`, v));
  contains("pincode", (p) => sql`leads.pincode ILIKE ${p}`);
  contains("pan", (p) => sql`upper(leads.pan) LIKE upper(${p})`);

  many("lead_type", (v) => sql`leads.lead_type IN (${textList(v)})`);
  many("aum", (v) => sql`leads.aum_potential IN (${textList(v)})`);
  many("interest", (v) => arrayHasAny(sql`leads.interest_products`, v));
  many("occupation", (v) => textIn(sql`leads.profile->>'occupation'`, v));
  many("holdings", (v) => arrayHasAny(sql`leads.profile->'currentInvestments'`, v));

  out.push(inDates(sql`leads.next_follow_up_at`, sp.next_fu_from, sp.next_fu_to));
  out.push(inDates(sql`leads.last_follow_up_at`, sp.last_fu_from, sp.last_fu_to));
  out.push(inDates(sql`leads.last_contact_at`, sp.last_contact_from, sp.last_contact_to));
  contains("fu_notes", (p) => sql`leads.follow_up_notes ILIKE ${p}`);

  contains("referred", (p) => sql`(leads.referred_by_name ILIKE ${p} OR EXISTS (
    SELECT 1 FROM investors ri WHERE ri.id = leads.referred_by_investor_id AND ri.name ILIKE ${p}))`);
  many("subdist", (v) => {
    const ids = v.filter((x) => UUID.test(x));
    return ids.length ? sql`leads.sub_distributor_id::text IN (${textList(ids)})` : sql`FALSE`;
  });
  many("campaign", (v) => textIn(sql`leads.source_campaign`, v));
  many("utm_source", (v) => textIn(sql`leads.utm_params->>'source'`, v));
  many("utm_medium", (v) => textIn(sql`leads.utm_params->>'medium'`, v));
  many("utm_campaign", (v) => textIn(sql`leads.utm_params->>'campaign'`, v));

  out.push(inDates(sql`leads.converted_at`, sp.converted_from, sp.converted_to));
  many("lost_reason", (v) => textIn(sql`leads.lost_reason`, v));
  out.push(inDates(sql`leads.lost_at`, sp.lost_from, sp.lost_to));

  many("tags", (v) => arrayHasAny(sql`leads.tags`, v));
  contains("notes", (p) => sql`leads.notes ILIKE ${p}`);
  out.push(inDates(sql`leads.updated_at`, sp.updated_from, sp.updated_to));

  for (const d of customDefs) {
    const key = cfKey(d.key);
    const value = sql`(leads.custom_fields->>${d.key})`;
    switch (d.type) {
      case "select":
      case "radio":
        many(key, (v) => sql`${value} IN (${textList(v)})`);
        break;
      case "multiselect":
        many(key, (v) => arrayHasAny(sql`(leads.custom_fields->${d.key})`, v));
        break;
      case "checkbox":
        if (sp[key] === "yes") out.push(sql`${value} = 'true'`);
        if (sp[key] === "no") out.push(sql`COALESCE(${value}, 'false') <> 'true'`);
        break;
      case "date":
        // Only well-formed dates are compared; anything else simply never matches.
        out.push(inDates(sql`(CASE WHEN ${value} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(${value}, 10)::date END)`, sp[`${key}_from`], sp[`${key}_to`], true));
        break;
      case "currency":
        out.push(inAmount(sql`(CASE WHEN ${value} ~ '^-?\\d+(\\.\\d+)?$' THEN ${value}::numeric END)`, sp[`${key}_min`], sp[`${key}_max`]));
        break;
      default:
        contains(key, (p) => sql`${value} ILIKE ${p}`);
    }
  }
  return out.filter((c): c is SQL => c != null);
}
