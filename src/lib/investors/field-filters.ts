/**
 * Every client field as a Clients filter — the client counterpart of
 * lib/leads/field-filters.ts. The page's own filters (Quick filters, Segment,
 * Category, Service tier, KYC, Status, RM, AUM, Added) stay where it defines
 * them; these follow, grouped like the client record, then one filter per
 * custom client field.
 *
 * - Fields with a short vocabulary are fixed pick lists; fields whose values
 *   repeat (city, occupation, bank, nominee relation…) list what the viewer's
 *   own book holds, so no option leads to an empty list and nothing outside
 *   the book is named.
 * - Free text (PAN, contact details, notes, names) is "contains".
 * - Dates are India dates, both ends inclusive.
 *
 * The conditions are applied inside buildInvestorConditions, so the Clients
 * list, its Excel export and every other caller of the builder agree. Custom
 * fields carry their TYPE in the URL key (cft_ / cfs_ / cfm_ / cfb_ / cfd_ /
 * cfa_), so the conditions need no database lookup and the export matches the
 * screen without loading definitions.
 *
 * Every value reaches SQL as a parameter, and URL keys are fixed here or
 * pattern-checked, so a hand-edited URL can only narrow, never break the query.
 */

import { sql, type SQL } from "drizzle-orm";
import type { CompactFilter } from "@/components/common/CompactFilterBar";
import { humanise } from "@/lib/format";
import { textList } from "@/lib/metrics/scope";

type Params = Record<string, string | undefined>;
type Option = { value: string; label: string };

/** Pick-list values found in the viewer's book, by filter key. */
export type InvestorFilterOptions = Record<string, Option[]>;

/** A custom client field definition (custom_field_defs, entity 'investor'). */
export type InvestorCustomFieldDef = { key: string; label: string; type: string; options?: string[] | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CF_KEY = /^[a-z0-9_]{1,60}$/i;

const CONTACT = "Contact";
const PERSONAL = "Personal";
const KYC = "KYC & compliance";
const FAMILY = "Family & relationship";
const NOMINEE_BANK = "Nominee & bank";
const PORTFOLIO = "Portfolio & risk";
const ACTIVITY = "Activity & reviews";
const RECORD = "Record";
const CUSTOM = "Custom fields";

const YES_NO: Option[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const HEALTH: Option[] = [
  { value: "green", label: "Healthy" },
  { value: "amber", label: "Watch" },
  { value: "red", label: "At risk" },
];

const SIP_PRESETS = [
  { label: "Under ₹5,000", max: 5000 },
  { label: "₹5,000 – ₹25,000", min: 5000, max: 25000 },
  { label: "₹25,000 – ₹1 L", min: 25000, max: 100000 },
  { label: "₹1 L and above", min: 100000 },
];

/**
 * Pick lists drawn from the book: [filter key, SQL value]. Text values group
 * case- and space-insensitively so "Pune" and "pune " are one option.
 */
const BOOK_TEXT_LISTS: [string, SQL][] = [
  ["city", sql`investors.address->>'city'`],
  ["state", sql`investors.address->>'state'`],
  ["gender", sql`investors.gender`],
  ["marital", sql`investors.marital_status`],
  ["occupation", sql`investors.occupation`],
  ["income", sql`investors.income_range`],
  ["inv_category", sql`investors.investor_category`],
  ["residency", sql`investors.residency_status`],
  ["tax_status", sql`investors.tax_status`],
  ["language", sql`investors.language_pref`],
  ["pan_aadhaar", sql`investors.pan_aadhaar_link_status`],
  ["fatca", sql`investors.fatca_status`],
  ["ipv", sql`investors.ipv_status`],
  ["ubo", sql`investors.ubo_status`],
  ["kra", sql`investors.kra_name`],
  ["family_role", sql`investors.family_role`],
  ["relationship", sql`investors.relationship_category`],
  ["household", sql`investors.household_type`],
  ["holding_mode", sql`investors.mode_of_holding`],
  ["nominee_rel", sql`investors.nominee_relation`],
  ["bank", sql`investors.bank_name`],
  ["mandate", sql`investors.mandate_status`],
  ["risk", sql`investors.risk_profile`],
  ["statement", sql`investors.statement_cadence`],
  ["review_freq", sql`investors.review_frequency`],
];
/** jsonb arrays of plain strings. */
const BOOK_ARRAY_LISTS: [string, SQL][] = [["tag", sql`investors.tags`]];

/**
 * Load the pick lists for the viewer's book (`bookWhere` = the page's access
 * scope, not deleted, not merged), plus families and branches. One round
 * trip; at most 200 values per list.
 *
 * The book is read ONCE into a materialized CTE and every list groups that.
 * It used to be one subquery per list — 26 scans of the investors table on
 * every Clients page load (~210 ms of a ~440 ms page at 6,000 clients).
 */
export async function loadInvestorFilterOptions(tx: any, tenantId: string, bookWhere: SQL): Promise<InvestorFilterOptions> {
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
    // A family reads as its name, else "<head> Family" (families.family_name is optional).
    sql`(SELECT 'fam'::text AS f, fm.id::text AS v,
                COALESCE(NULLIF(btrim(fm.family_name), ''), fm.head_name || ' Family') AS l
         FROM families fm
         WHERE fm.tenant_id = ${tenantId}::uuid
           AND fm.id IN (SELECT family_id FROM book)
         ORDER BY 3 LIMIT 200)`,
    sql`(SELECT 'branch'::text AS f, id::text AS v, name AS l FROM branches WHERE tenant_id = ${tenantId}::uuid ORDER BY name LIMIT 200)`,
  ];
  const res = await tx.execute(sql`
    WITH book AS MATERIALIZED (
      SELECT investors.family_id, ${sql.join(cols, sql`, `)}
      FROM investors WHERE ${bookWhere}
    )
    ${sql.join(parts, sql` UNION ALL `)}`);
  const out: InvestorFilterOptions = {};
  for (const r of res.rows as { f: string; v: string; l: string }[]) {
    // Stored codes (snake_case, lower case) read as words; free text keeps the
    // spelling the book holds.
    const label = /^[a-z0-9_]+$/.test(r.l ?? "") ? humanise(r.l) : r.l;
    (out[r.f] ??= []).push({ value: r.v, label: label || r.v });
  }
  return out;
}

const multi = (key: string, label: string, group: string, options: Option[]): CompactFilter => ({ type: "multi", key, label, group, options });
const text = (key: string, label: string, group: string, placeholder?: string): CompactFilter => ({ type: "text", key, label, group, placeholder });
const dates = (key: string, label: string, group: string): CompactFilter => ({ type: "date_range", key, label, group });
const yesNo = (key: string, label: string, group: string): CompactFilter => ({ type: "select", key, label, group, allLabel: "Any", options: YES_NO });

/** URL key for a custom field filter — the prefix carries the field's type. */
function customKey(d: InvestorCustomFieldDef): string | null {
  if (!CF_KEY.test(d.key)) return null;
  switch (d.type) {
    case "select":
    case "radio":
      return (d.options ?? []).length ? `cfs_${d.key}` : `cft_${d.key}`;
    case "multiselect":
      return (d.options ?? []).length ? `cfm_${d.key}` : `cft_${d.key}`;
    case "checkbox":
      return `cfb_${d.key}`;
    case "date":
      return `cfd_${d.key}`;
    case "currency":
    case "number":
      return `cfa_${d.key}`;
    default:
      return `cft_${d.key}`;
  }
}

/**
 * The filter definitions, in panel order. Empty pick lists are left out, and
 * `allowed(field)` hides a filter on a column the firm's licence does not show
 * (the same gate the list's columns use), so a filter never reveals a field
 * the column would not.
 */
export function investorFieldFilterDefs(
  options: InvestorFilterOptions,
  customDefs: InvestorCustomFieldDef[],
  allowed: (field: string) => boolean = () => true,
): CompactFilter[] {
  const list = (k: string) => options[k] ?? [];
  const pick = (key: string, label: string, group: string) => (list(key).length ? multi(key, label, group, list(key)) : null);
  const defs: (CompactFilter | null)[] = [
    // Contact
    text("mobile", "Mobile", CONTACT, "Digits, e.g. 98765"),
    text("email", "Email", CONTACT),
    pick("city", "City", CONTACT),
    pick("state", "State", CONTACT),
    text("pincode", "Pincode", CONTACT),
    text("address", "Address", CONTACT),
    // Personal
    pick("gender", "Gender", PERSONAL),
    dates("dob", "Date of birth", PERSONAL),
    dates("anniversary", "Anniversary", PERSONAL),
    pick("marital", "Marital status", PERSONAL),
    pick("occupation", "Occupation", PERSONAL),
    pick("income", "Income range", PERSONAL),
    text("employer", "Employer", PERSONAL),
    pick("inv_category", "Client type", PERSONAL),
    pick("residency", "Residency", PERSONAL),
    pick("tax_status", "Tax status", PERSONAL),
    yesNo("minor", "Minor", PERSONAL),
    pick("language", "Preferred language", PERSONAL),
    // KYC & compliance
    allowed("pan") ? text("pan", "PAN", KYC, "e.g. ABCDE") : null,
    text("pan_name", "Name as per PAN", KYC),
    pick("pan_aadhaar", "PAN–Aadhaar link", KYC),
    dates("kyc_validated", "KYC validated on", KYC),
    text("ckyc", "CKYC number", KYC),
    dates("ckyc_expiry", "CKYC expiry", KYC),
    pick("kra", "KRA", KYC),
    pick("fatca", "FATCA status", KYC),
    dates("fatca_expiry", "FATCA expiry", KYC),
    pick("ipv", "IPV status", KYC),
    pick("ubo", "UBO status", KYC),
    // Family & relationship
    list("fam").length ? multi("fam", "Family", FAMILY, list("fam")) : null,
    pick("family_role", "Family role", FAMILY),
    pick("relationship", "Relationship category", FAMILY),
    pick("household", "Household type", FAMILY),
    pick("holding_mode", "Mode of holding", FAMILY),
    text("second_holder", "Second holder", FAMILY, "Name"),
    text("referred", "Referred by", FAMILY, "Name"),
    // Nominee & bank
    text("nominee", "Nominee", NOMINEE_BANK, "Name"),
    pick("nominee_rel", "Nominee relation", NOMINEE_BANK),
    pick("bank", "Bank", NOMINEE_BANK),
    text("ifsc", "IFSC", NOMINEE_BANK),
    // Portfolio & risk
    allowed("active_sip_amount") ? { type: "amount_range", key: "sipamt", label: "Monthly SIP", group: PORTFOLIO, presets: SIP_PRESETS } : null,
    pick("mandate", "Mandate status", PORTFOLIO),
    { type: "amount_range", key: "mandate_amt", label: "Mandate amount", group: PORTFOLIO },
    text("ucc", "UCC / CAN", PORTFOLIO),
    pick("risk", "Risk profile", PORTFOLIO),
    yesNo("risk_provisional", "Risk profile suggested (unconfirmed)", PORTFOLIO),
    dates("risk_signed", "Risk profile signed", PORTFOLIO),
    multi("health", "Health", PORTFOLIO, HEALTH),
    pick("statement", "Statement cadence", PORTFOLIO),
    // Activity & reviews
    dates("onboarded", "Onboarded", ACTIVITY),
    dates("last_txn", "Last transaction", ACTIVITY),
    dates("last_contact", "Last contacted", ACTIVITY),
    dates("last_review", "Last review", ACTIVITY),
    dates("next_review", "Next review", ACTIVITY),
    pick("review_freq", "Review frequency", ACTIVITY),
    dates("dormant", "Dormant since", ACTIVITY),
    dates("exited", "Exited on", ACTIVITY),
    // Record — `branch`, `tag` and `fam` are the dashboard's own params,
    // already read by buildInvestorConditions; these only give them a control.
    list("branch").length > 1 ? multi("branch", "Branch", RECORD, list("branch")) : null,
    pick("tag", "Tags", RECORD),
    text("notes", "Notes", RECORD),
    dates("updated", "Last updated", RECORD),
    ...customDefs.map((d): CompactFilter | null => {
      const key = customKey(d);
      if (!key) return null;
      const opts = (d.options ?? []).map((o) => ({ value: o, label: o }));
      switch (key.slice(0, 4)) {
        case "cfs_":
        case "cfm_":
          return multi(key, d.label, CUSTOM, opts);
        case "cfb_":
          return yesNo(key, d.label, CUSTOM);
        case "cfd_":
          return dates(key, d.label, CUSTOM);
        case "cfa_":
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

/**
 * India-date range, either end optional. `plain`: the expression is already a
 * calendar date (date of birth, a date column) and is not shifted.
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

/** Text compared case- and space-insensitively, as the pick lists group it. */
const textIn = (expr: SQL, values: string[]) => sql`lower(btrim(${expr})) IN (${textList(values.map((v) => v.toLowerCase()))})`;
const digits = (expr: SQL) => sql`regexp_replace(COALESCE(${expr}, ''), '[^0-9]', '', 'g')`;

/**
 * The SQL conditions for every field filter present in the URL. Each only
 * narrows. `branch`, `tag` and `fam` are handled by buildInvestorConditions.
 */
export function investorFieldFilterConds(sp: Params): SQL[] {
  const out: (SQL | null)[] = [];
  const many = (key: string, build: (vals: string[]) => SQL) => {
    const vals = csv(sp[key]);
    if (vals.length) out.push(build(vals));
  };
  const contains = (key: string, build: (pattern: string) => SQL) => {
    const v = (sp[key] ?? "").trim().slice(0, 200);
    if (v) out.push(build(like(v)));
  };
  const flag = (key: string, yes: SQL, no: SQL) => {
    if (sp[key] === "yes") out.push(yes);
    if (sp[key] === "no") out.push(no);
  };

  // Contact
  const mobile = (sp.mobile ?? "").replace(/\D/g, "").slice(0, 15);
  if (mobile) {
    const p = `%${mobile}%`;
    out.push(sql`(${digits(sql`investors.phone`)} LIKE ${p} OR ${digits(sql`investors.alternate_phone`)} LIKE ${p}
      OR ${digits(sql`investors.whatsapp_phone`)} LIKE ${p})`);
  }
  contains("email", (p) => sql`investors.email ILIKE ${p}`);
  many("city", (v) => textIn(sql`(investors.address->>'city')`, v));
  many("state", (v) => textIn(sql`(investors.address->>'state')`, v));
  contains("pincode", (p) => sql`(investors.address->>'pincode') ILIKE ${p}`);
  contains("address", (p) => sql`(investors.address->>'line1') ILIKE ${p}`);

  // Personal
  many("gender", (v) => textIn(sql`investors.gender`, v));
  out.push(inDates(sql`investors.dob`, sp.dob_from, sp.dob_to, true));
  out.push(inDates(sql`investors.anniversary_date`, sp.anniversary_from, sp.anniversary_to, true));
  many("marital", (v) => textIn(sql`investors.marital_status`, v));
  many("occupation", (v) => textIn(sql`investors.occupation`, v));
  many("income", (v) => textIn(sql`investors.income_range`, v));
  contains("employer", (p) => sql`investors.employer_name ILIKE ${p}`);
  many("inv_category", (v) => textIn(sql`investors.investor_category`, v));
  many("residency", (v) => textIn(sql`investors.residency_status`, v));
  many("tax_status", (v) => textIn(sql`investors.tax_status`, v));
  flag("minor", sql`investors.is_minor = true`, sql`COALESCE(investors.is_minor, false) = false`);
  many("language", (v) => textIn(sql`investors.language_pref`, v));

  // KYC & compliance
  contains("pan", (p) => sql`upper(investors.pan) LIKE upper(${p})`);
  contains("pan_name", (p) => sql`investors.name_as_per_pan ILIKE ${p}`);
  many("pan_aadhaar", (v) => textIn(sql`investors.pan_aadhaar_link_status`, v));
  out.push(inDates(sql`investors.kyc_validated_at`, sp.kyc_validated_from, sp.kyc_validated_to, true));
  contains("ckyc", (p) => sql`investors.ckyc_number ILIKE ${p}`);
  out.push(inDates(sql`investors.ckyc_expiry_at`, sp.ckyc_expiry_from, sp.ckyc_expiry_to, true));
  many("kra", (v) => textIn(sql`investors.kra_name`, v));
  many("fatca", (v) => textIn(sql`investors.fatca_status`, v));
  out.push(inDates(sql`investors.fatca_expiry_at`, sp.fatca_expiry_from, sp.fatca_expiry_to, true));
  many("ipv", (v) => textIn(sql`investors.ipv_status`, v));
  many("ubo", (v) => textIn(sql`investors.ubo_status`, v));

  // Family & relationship (`fam` is the builder's)
  many("family_role", (v) => textIn(sql`investors.family_role`, v));
  many("relationship", (v) => textIn(sql`investors.relationship_category`, v));
  many("household", (v) => textIn(sql`investors.household_type`, v));
  many("holding_mode", (v) => textIn(sql`investors.mode_of_holding`, v));
  contains("second_holder", (p) => sql`(concat_ws(' ', investors.second_holder_first_name, investors.second_holder_last_name) ILIKE ${p})`);
  contains("referred", (p) => sql`investors.referral_client_name ILIKE ${p}`);

  // Nominee & bank — the first nominee column, or any nominee in the list
  contains("nominee", (p) => sql`(investors.nominee_name ILIKE ${p} OR (jsonb_typeof(investors.nominees) = 'array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(investors.nominees) n WHERE n->>'name' ILIKE ${p})))`);
  many("nominee_rel", (v) => textIn(sql`investors.nominee_relation`, v));
  many("bank", (v) => textIn(sql`investors.bank_name`, v));
  contains("ifsc", (p) => sql`upper(investors.bank_ifsc) LIKE upper(${p})`);

  // Portfolio & risk
  out.push(inAmount(sql`COALESCE(investors.active_sip_amount, 0)`, sp.sipamt_min, sp.sipamt_max));
  many("mandate", (v) => textIn(sql`investors.mandate_status`, v));
  out.push(inAmount(sql`investors.mandate_amount`, sp.mandate_amt_min, sp.mandate_amt_max));
  contains("ucc", (p) => sql`(investors.bse_ucc_code ILIKE ${p} OR investors.nse_can_code ILIKE ${p}
    OR COALESCE(investors.ucc_codes::text, '') ILIKE ${p})`);
  many("risk", (v) => textIn(sql`investors.risk_profile`, v));
  flag("risk_provisional", sql`investors.risk_profile_provisional = true`, sql`COALESCE(investors.risk_profile_provisional, false) = false`);
  out.push(inDates(sql`investors.risk_profile_signed_at`, sp.risk_signed_from, sp.risk_signed_to));
  many("health", (v) => sql`investors.health_band IN (${textList(v.filter((x) => ["green", "amber", "red"].includes(x)))})`);
  many("statement", (v) => textIn(sql`investors.statement_cadence`, v));

  // Activity & reviews (`onboarded_from/_to` is the builder's own)
  out.push(inDates(sql`investors.last_transaction_at`, sp.last_txn_from, sp.last_txn_to));
  out.push(inDates(sql`investors.last_contact_at`, sp.last_contact_from, sp.last_contact_to));
  out.push(inDates(sql`investors.last_review_at`, sp.last_review_from, sp.last_review_to));
  out.push(inDates(sql`investors.next_review_at`, sp.next_review_from, sp.next_review_to));
  many("review_freq", (v) => textIn(sql`investors.review_frequency`, v));
  out.push(inDates(sql`investors.dormant_since`, sp.dormant_from, sp.dormant_to));
  out.push(inDates(sql`investors.exited_at`, sp.exited_from, sp.exited_to));

  // Record (`branch`, `tag` are the builder's)
  contains("notes", (p) => sql`investors.notes ILIKE ${p}`);
  out.push(inDates(sql`investors.updated_at`, sp.updated_from, sp.updated_to));

  // Custom fields — the key's prefix says how to compare, so no definitions
  // are needed here. Only well-formed dates and numbers are compared.
  for (const [rawKey, rawVal] of Object.entries(sp)) {
    const m = /^(cft|cfs|cfm|cfb)_([a-z0-9_]{1,60})$/i.exec(rawKey);
    if (!m || !rawVal) continue;
    const [, kind, field] = m;
    const value = sql`(investors.custom_fields->>${field})`;
    if (kind === "cft") contains(rawKey, (p) => sql`${value} ILIKE ${p}`);
    else if (kind === "cfs") many(rawKey, (v) => sql`${value} IN (${textList(v)})`);
    else if (kind === "cfm") many(rawKey, (v) => sql`(jsonb_typeof(investors.custom_fields->${field}) = 'array'
      AND (investors.custom_fields->${field}) ?| ARRAY[${textList(v)}]::text[])`);
    else flag(rawKey, sql`${value} = 'true'`, sql`COALESCE(${value}, 'false') <> 'true'`);
  }
  const ranged = new Set<string>();
  for (const k of Object.keys(sp)) {
    const m = /^(cfd|cfa)_([a-z0-9_]{1,60})_(from|to|min|max)$/i.exec(k);
    if (m) ranged.add(`${m[1]}_${m[2]}`);
  }
  for (const key of ranged) {
    const field = key.slice(4);
    const value = sql`(investors.custom_fields->>${field})`;
    if (key.startsWith("cfd_")) {
      out.push(inDates(sql`(CASE WHEN ${value} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(${value}, 10)::date END)`, sp[`${key}_from`], sp[`${key}_to`], true));
    } else {
      out.push(inAmount(sql`(CASE WHEN ${value} ~ '^-?\\d+(\\.\\d+)?$' THEN ${value}::numeric END)`, sp[`${key}_min`], sp[`${key}_max`]));
    }
  }

  return out.filter((c): c is SQL => c != null);
}
