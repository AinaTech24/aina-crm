/**
 * Shared investor-list filter builder.
 *
 * The investors list page and the Excel export endpoint must apply the EXACT
 * same WHERE logic, otherwise an exported file wouldn't match what's on
 * screen. This module is the single source of truth for translating the URL
 * search params (?q / ?segment / ?tier / ?status / ?kyc / quick-filter chips /
 * ?gaps) into Drizzle conditions.
 *
 * Tenant isolation is handled by RLS (withTenant) — never add a tenant_id
 * predicate here.
 */

import { and, ilike, inArray, or, sql } from "drizzle-orm";
import { investors } from "@/db/schema";
import { aliveClient, cleanIds, textList, uuidList } from "@/lib/metrics/scope";
import { missingDataSql, reviewOverdueSql } from "@/lib/metrics/attention";
import { investorFieldFilterConds } from "@/lib/investors/field-filters";
import { clientRiskSql } from "@/lib/risk-profile/own-assessment";
import { missingAdultTextSql, missingDobSql, needsNomineeSql, panAadhaarGapSql } from "@/lib/investors/type-rules";

// A minor's risk is their own assessment, never the guardian's copy (G-1).
const RISK = clientRiskSql("investors");

export type InvestorListParams = Record<string, string | undefined>;

/** Parse the comma-joined multi-select params the FilterBar emits. */
function csv(v: string | undefined): string[] {
  return (v ?? "").split(",").filter(Boolean);
}

/** A non-negative rupee amount from the URL, else null (ignored). */
function rupees(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1e13 ? n : null;
}

/**
 * Build the array of Drizzle conditions for the investor list. Returns an
 * array (possibly empty) so callers can `and(...conditions)` or skip the
 * WHERE entirely. `userId` is needed for the "mine" quick-filter.
 */
export function buildInvestorConditions(
  sp: InvestorListParams,
  userId: string
): any[] {
  const conditions: any[] = [];

  // Trash bin: soft-deleted clients never appear in the list / export / counts.
  conditions.push(sql`${investors.deletedAt} IS NULL`);
  // Nor does a duplicate merged into another client: the merge only marks it
  // inactive + merged_into_id, so without this every merge left both records
  // in the Clients list. Merged records are listed under Merge Clients → Merged.
  conditions.push(sql`${investors.mergedIntoId} IS NULL`);

  const q = (sp.q ?? "").trim();
  const segment = csv(sp.segment);
  const category = csv(sp.category);
  const tier = csv(sp.tier);
  const status = csv(sp.status);
  const kyc = csv(sp.kyc);
  const rm = csv(sp.rm);
  // Malformed ids are dropped rather than cast: '…'::uuid on a hand-edited URL
  // would turn a bad link into a 500.
  const branch = csv(sp.branch).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  const gaps = csv(sp.gaps);
  const qf = {
    mine: sp.mine === "1",
    // Clients not linked to any household — the Family Mapping work queue.
    unmapped: sp.unmapped === "1",
    tier_a: sp.tier_a === "1",
    hni: sp.hni === "1",
    reviews_due: sp.reviews_due === "1",
    kyc_expiring: sp.kyc_expiring === "1",
    no_nominee: sp.no_nominee === "1",
    rp_stale: sp.rp_stale === "1",
    dormant: sp.dormant === "1",
    birthday_week: sp.birthday_week === "1",
    birthday_today: sp.birthday_today === "1",
    birthday_tomorrow: sp.birthday_tomorrow === "1",
    birthday_past: sp.birthday_past === "1",
    cross_sell_opp: sp.cross_sell_opp === "1",
  };

  if (q) {
    // Match each WORD independently, ANDed together, rather than the whole
    // string as one contiguous substring. Registrar names carry middle names and
    // initials the person searching does not type: "adesh manocha" never matched
    // "ADESH KUMAR MANOCHA", because `%adesh manocha%` requires the two to be
    // adjacent. Per-token AND finds it, and for a single word the behaviour is
    // unchanged.
    //
    // Email is included because a family member is often identified by the
    // shared household address when the name is spelled differently on the folio.
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
    for (const tok of tokens) {
      const like = `%${tok}%`;
      conditions.push(
        or(
          ilike(investors.name, like),
          ilike(investors.pan, `%${tok.toUpperCase()}%`),
          ilike(investors.phone, like),
          ilike(investors.email, like)
        )!
      );
    }
  }
  // NB: use inArray (not `= ANY(${jsArray})`) — Drizzle expands a JS array
  // passed to sql`` into a `($1,$2,…)` tuple, which is invalid for ANY().
  if (segment.length) conditions.push(inArray(investors.segmentTag, segment as any));
  // `category=none` is the "no category set" bucket the dashboards link to.
  // Matching it literally found nothing (no client's category is the string
  // "none"), so the link opened an empty list under a count of twelve.
  // Compared trimmed and upper-cased, exactly as lib/metrics/scope.ts counts a
  // category, so a stored "a " is Category A on the dashboard and here alike.
  if (category.length) {
    const named = category.filter((c) => c !== "none").map((c) => c.toUpperCase());
    const catCol = sql`upper(btrim(COALESCE(${investors.clientCategory}, '')))`;
    const parts: any[] = [];
    if (named.length) parts.push(sql`${catCol} IN (${textList(named)})`);
    if (named.length !== category.length) parts.push(sql`${catCol} = ''`);
    conditions.push(parts.length === 1 ? parts[0] : or(...parts)!);
  }
  if (tier.length) conditions.push(inArray(investors.serviceTier, tier as any));
  // Status as the dashboard's Client book counts it (lib/metrics/book.ts):
  // "closed" includes exited, and "none" is a client with no status recorded.
  if (status.length) {
    const named = status.filter((s) => s !== "none");
    if (named.includes("closed") && !named.includes("exited")) named.push("exited");
    const parts: any[] = [];
    if (named.length) parts.push(inArray(investors.status, named as any));
    if (named.length !== status.length) parts.push(sql`COALESCE(${investors.status}, '') = ''`);
    conditions.push(parts.length === 1 ? parts[0] : or(...parts)!);
  }
  // ctype — the Client book's "By client type" (lib/metrics/book.ts
  // clientTypeSql, restated over the investors table): corporate, else the
  // family's primary member as head, else another family member, else
  // individual.
  const ctype = csv(sp.ctype).filter((v) => ["head", "member", "individual", "corporate"].includes(v));
  if (ctype.length) {
    conditions.push(sql`(CASE WHEN ${investors.investorCategory} IN ('corporate', 'company', 'llp', 'partnership', 'aop_boi') THEN 'corporate'
      WHEN EXISTS (SELECT 1 FROM families f WHERE f.tenant_id = ${investors.tenantId}
                     AND f.primary_investor_id = ${investors.id}) THEN 'head'
      WHEN ${investors.familyId} IS NOT NULL THEN 'member'
      ELSE 'individual' END) IN (${textList(ctype)})`);
  }
  if (kyc.length) conditions.push(inArray(investors.kycStatus, kyc as any));
  // RM (owning team member) filter — lets an owner slice the book by RM.
  // Explicit ::uuid casts mirror the meetings/SR/leads filter pattern.
  // `rm=none` is the dashboard Team table's "No RM assigned" row.
  if (rm.length) {
    const ids = rm.filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    const parts: any[] = [];
    if (ids.length) parts.push(sql`${investors.rmId} IN (${sql.join(ids.map((v) => sql`${v}::uuid`), sql`, `)})`);
    if (rm.includes("none")) parts.push(sql`${investors.rmId} IS NULL`);
    if (parts.length) conditions.push(parts.length === 1 ? parts[0] : or(...parts)!);
  }

  // Branch filter — the branch command centre's drill-down. It only NARROWS:
  // the caller's access scope (investorScopeCondition) is ANDed on top, so a
  // branch id in the URL can never widen what a viewer may see.
  if (branch.length) {
    conditions.push(
      sql`${investors.branchId} IN (${sql.join(branch.map((v) => sql`${v}::uuid`), sql`, `)})`
    );
  }

  // The dashboard's client filters (components/dashboards/system/links.ts),
  // each with the definition lib/metrics/scope.ts counts by, so a card's number
  // is the row count here. Like every filter, they only NARROW.
  //
  // alive=1 — the dashboard's client base: live clients, i.e. not deleted, not
  // merged away, not closed (aliveClient). Every Clients link a card builds
  // carries it.
  if (sp.alive === "1") conditions.push(sql`(${aliveClient("investors")})`);
  // fam — the dashboard's family filter: family ids, comma-separated.
  const fam = cleanIds(csv(sp.fam));
  if (fam.length) conditions.push(sql`${investors.familyId} IN (${uuidList(fam)})`);
  // tag — the dashboard's tag filter: any of these tags (investors.tags is a
  // jsonb array of strings).
  const tag = csv(sp.tag);
  if (tag.length) {
    conditions.push(sql`COALESCE(${investors.tags}, '[]'::jsonb) ?| ARRAY[${textList(tag)}]::text[]`);
  }
  // src — the dashboard's lead-source filter: clients converted from a lead
  // with one of these sources (scope.ts clientFilterParts, which is not
  // exported; the lead's tenant is the client's own).
  const src = csv(sp.src);
  if (src.length) {
    conditions.push(sql`${investors.id} IN (SELECT l.converted_investor_id FROM leads l
      WHERE l.tenant_id = ${investors.tenantId} AND l.converted_investor_id IS NOT NULL
        AND l.source IN (${textList(src)}))`);
  }
  // needs_data=1 — "Needs attention", the dashboard's "clients missing data"
  // count: live clients missing PAN, date of birth, nominee, bank, a verified
  // KYC or a risk profile (lib/metrics/attention.ts missingDataSql).
  if (sp.needs_data === "1") {
    conditions.push(sql`(${aliveClient("investors")}) AND ${missingDataSql("investors")}`);
  }

  // Review state, as the dashboards count it: overdue is a review DATE before
  // today; due is today or earlier. `reviews_due=1` below compares with now(),
  // which drops a review due at 5pm today from a list opened at 10am.
  if (sp.review === "overdue") {
    // The dashboard's "Reviews overdue" count: the review's India date before
    // today's India date (lib/metrics/attention.ts reviewOverdueSql).
    conditions.push(sql`(${reviewOverdueSql("investors")})`);
  } else if (sp.review === "due") {
    conditions.push(sql`(${investors.nextReviewAt} IS NOT NULL AND ${investors.nextReviewAt}::date <= current_date)`);
  }

  // Investing, but no active SIP in the SIP register — the relationship
  // opportunity of the same name.
  if (sp.sip === "none") {
    conditions.push(sql`(COALESCE(${investors.aum}, 0) > 0 AND NOT EXISTS (
      SELECT 1 FROM sips s WHERE s.investor_id = ${investors.id} AND s.status = 'active'))`);
  }

  // A birthday or anniversary within the next N days, by NEXT occurrence —
  // the action centre's rule, so the week of Christmas does not empty out.
  const occasionDays = Number(sp.occasion);
  if (Number.isInteger(occasionDays) && occasionDays > 0 && occasionDays <= 60) {
    const within = (d: any) => sql`(${d} IS NOT NULL AND (CASE
        WHEN (${d} + ((EXTRACT(YEAR FROM current_date) - EXTRACT(YEAR FROM ${d}))::int || ' years')::interval)::date >= current_date
        THEN (${d} + ((EXTRACT(YEAR FROM current_date) - EXTRACT(YEAR FROM ${d}))::int || ' years')::interval)::date
        ELSE (${d} + ((EXTRACT(YEAR FROM current_date) - EXTRACT(YEAR FROM ${d}))::int + 1 || ' years')::interval)::date
      END) <= current_date + ${occasionDays}::int)`;
    conditions.push(sql`(${within(investors.dob)} OR ${within(investors.anniversaryDate)})`);
  }

  if (qf.mine) conditions.push(sql`${investors.rmId} = ${userId}`);
  if (qf.unmapped) conditions.push(sql`${investors.familyId} IS NULL`);
  if (qf.tier_a) conditions.push(sql`${investors.serviceTier} = 'A'`);
  if (qf.hni) conditions.push(sql`${investors.segmentTag} = 'HNI'`);
  if (qf.reviews_due) {
    conditions.push(
      sql`${investors.nextReviewAt} IS NOT NULL AND ${investors.nextReviewAt} <= now()`
    );
  }
  if (qf.kyc_expiring) {
    conditions.push(sql`(
      ${investors.kycStatus} IN ('expired','re_kyc_required')
      OR (${investors.ckycExpiryAt} IS NOT NULL
          AND ${investors.ckycExpiryAt} BETWEEN current_date AND current_date + interval '30 days')
    )`);
  }
  if (qf.no_nominee) {
    conditions.push(needsNomineeSql("investors"));
  }
  if (qf.rp_stale) {
    conditions.push(
      sql`(${RISK.signedAt} IS NULL OR ${RISK.signedAt} < now() - interval '365 days')`
    );
  }
  if (qf.dormant) {
    conditions.push(
      sql`(${investors.lastTransactionAt} IS NULL OR ${investors.lastTransactionAt} < now() - make_interval(days => COALESCE((SELECT dormancy_window_days FROM tenants WHERE id = ${investors.tenantId}), 180)))`
    );
  }
  if (qf.birthday_week) {
    conditions.push(sql`(
      ${investors.dob} IS NOT NULL
      AND to_char(${investors.dob}, 'MM-DD') BETWEEN to_char(current_date, 'MM-DD')
                                                 AND to_char(current_date + interval '7 days', 'MM-DD')
    )`);
  }
  if (qf.birthday_today) {
    conditions.push(
      sql`(${investors.dob} IS NOT NULL AND to_char(${investors.dob}, 'MM-DD') = to_char(current_date, 'MM-DD'))`
    );
  }
  if (qf.birthday_tomorrow) {
    conditions.push(
      sql`(${investors.dob} IS NOT NULL AND to_char(${investors.dob}, 'MM-DD') = to_char(current_date + interval '1 day', 'MM-DD'))`
    );
  }
  if (qf.birthday_past) {
    // Birthdays in the last 30 days — day-of-year modular window so it stays
    // correct across the year-end boundary (mirrors the birthday bell's "Past").
    conditions.push(
      sql`(${investors.dob} IS NOT NULL AND ((EXTRACT(DOY FROM current_date)::int - EXTRACT(DOY FROM ${investors.dob})::int + 366) % 366) BETWEEN 1 AND 30)`
    );
  }
  if (qf.cross_sell_opp) {
    // Any product marked held-elsewhere / interested / not-held = a wallet-share opportunity.
    conditions.push(sql`(
      ${investors.crossSell} IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(${investors.crossSell}) AS cs(k, v)
        WHERE cs.v IN ('held_elsewhere', 'interested', 'not_held')
      )
    )`);
  }

  for (const gap of gaps) {
    switch (gap) {
      case "pan":
        conditions.push(sql`(${investors.pan} IS NULL OR ${investors.pan} = '')`);
        break;
      case "phone":
        conditions.push(sql`(${investors.phone} IS NULL OR ${investors.phone} = '')`);
        break;
      case "email":
        conditions.push(sql`(${investors.email} IS NULL OR ${investors.email} = '')`);
        break;
      case "dob":
        conditions.push(missingDobSql("investors"));
        break;
      case "nominee":
        // Only a type that can nominate — the compliance card's count (lib/investors/type-rules.ts).
        conditions.push(needsNomineeSql("investors"));
        break;
      case "bank":
        conditions.push(
          sql`(${investors.bankAccountNumberMasked} IS NULL OR ${investors.bankAccountNumberMasked} = '')`
        );
        break;
      case "risk_profile":
        conditions.push(
          sql`(${RISK.category} IS NULL OR ${RISK.signedAt} IS NULL)`
        );
        break;
      case "rm":
        conditions.push(sql`${investors.rmId} IS NULL`);
        break;
      // The data-quality card's gaps, each matching its count exactly.
      case "kyc":
        conditions.push(sql`(${investors.kycStatus} IS NULL OR ${investors.kycStatus} NOT IN ('validated','registered','verified'))`);
        break;
      case "risk_pending":
        conditions.push(sql`${RISK.category} IS NULL`);
        break;
      case "occupation":
        conditions.push(missingAdultTextSql("investors", "occupation"));
        break;
      case "employer":
        conditions.push(missingAdultTextSql("investors", "employer_name"));
        break;
      case "notes":
        conditions.push(sql`(${investors.notes} IS NULL OR btrim(${investors.notes}) = '')`);
        break;
      case "pan_aadhaar":
        conditions.push(panAadhaarGapSql("investors"));
        break;
      case "marketing_consent":
        // No marketing consent granted and still in force (lib/metrics/compliance.ts).
        conditions.push(sql`NOT EXISTS (SELECT 1 FROM consents c WHERE c.investor_id = ${investors.id}
          AND c.scope IN ('marketing', 'all') AND c.status = 'granted' AND c.revoked_at IS NULL)`);
        break;
      case "unverified_contact":
        // Sanchay "Verified At" parity — email/phone present but not confirmed.
        conditions.push(sql`(
          (${investors.email} IS NOT NULL AND ${investors.email} <> '' AND ${investors.emailVerifiedAt} IS NULL)
          OR (${investors.phone} IS NOT NULL AND ${investors.phone} <> '' AND ${investors.phoneVerifiedAt} IS NULL)
        )`);
        break;
    }
  }

  // Custom created-date range (FilterBar date_range emits created_from / created_to
  // as yyyy-mm-dd). Half-open [from, to+1) so the "to" day is inclusive. Uses the
  // qualified investors.createdAt column so it's unambiguous under joins, and is
  // applied here so the Excel export honours the same range as the on-screen list.
  const createdFrom = (sp.created_from ?? "").trim();
  const createdTo = (sp.created_to ?? "").trim();
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (isDate(createdFrom)) conditions.push(sql`${investors.createdAt} >= ${createdFrom}::date`);
  if (isDate(createdTo)) conditions.push(sql`${investors.createdAt} < (${createdTo}::date + interval '1 day')`);

  // Onboarded between two India dates — how a dashboard's "New clients" count
  // opens onto exactly its rows (lib/metrics/new-clients.ts has the one
  // definition: onboarding date in the period, not deleted, not merged).
  const onbFrom = (sp.onboarded_from ?? "").trim();
  const onbTo = (sp.onboarded_to ?? "").trim();
  if (isDate(onbFrom) || isDate(onbTo)) {
    const onbDay = sql`(${investors.onboardedAt} AT TIME ZONE 'Asia/Kolkata')::date`;
    if (isDate(onbFrom)) conditions.push(sql`${onbDay} >= ${onbFrom}::date`);
    if (isDate(onbTo)) conditions.push(sql`${onbDay} <= ${onbTo}::date`);
    conditions.push(sql`${investors.mergedIntoId} IS NULL`);
  }

  // AUM range in rupees (the filter bar's amount_range emits aum_min / aum_max).
  // Lower bound inclusive, upper bound exclusive, so adjacent bands such as
  // "₹1 L – ₹10 L" and "₹10 L – ₹50 L" never both claim a client at exactly
  // ₹10 L. A client with no AUM recorded counts as ₹0 — the column shows ₹0.
  const aumMin = rupees(sp.aum_min);
  const aumMax = rupees(sp.aum_max);
  if (aumMin != null) conditions.push(sql`COALESCE(${investors.aum}, 0) >= ${aumMin}`);
  if (aumMax != null) conditions.push(sql`COALESCE(${investors.aum}, 0) < ${aumMax}`);

  // Every other client field (lib/investors/field-filters.ts) — applied here so
  // the list, its Excel export and every other caller agree.
  conditions.push(...investorFieldFilterConds(sp));

  return conditions;
}

/** Convenience: combined WHERE (undefined when no conditions). */
export function buildInvestorWhere(sp: InvestorListParams, userId: string) {
  const conditions = buildInvestorConditions(sp, userId);
  return conditions.length ? and(...conditions) : undefined;
}
