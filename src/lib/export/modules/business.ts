/**
 * Business & advice modules — SIP Book, SIP Rejections, MF Transactions,
 * Business Entries, Fixed Deposits, Goals, Financial Plans and Proposals.
 *
 * Each `where` repeats its list page's access rule and URL filters, so the
 * file is the list on screen. Where a list page applies NO row scope of its
 * own (SIP Rejections, MF Transactions, Proposals), the export applies the
 * module's API / client rule instead — a bulk file never carries more than
 * the viewer's book.
 */

import { sql, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { clientWhere, textList, type MetricScope } from "@/lib/metrics/scope";
import { sipMonthlySql } from "@/lib/metrics/sip";
import { buildTransactionConditions, transactionClientCondition } from "@/lib/transactions/list-filters";
import { dateRangeCond } from "@/lib/filters/date-range";
import { RTA_LINE_STATUSES } from "@/db/schema/business_entries";
import { RTA_STATUS_LABEL } from "@/lib/business/rta-status";
import { d, dIst, dt, inFilter, userName } from "../helpers";
import type { ExportModule } from "../types";

// ── small shared helpers ─────────────────────────────────────────────────────

const raw = (c: string) => sql.raw(c);
/** "client_contacted" → "Client Contacted". */
const nice = (e: SQL) => sql`initcap(replace(${e}::text, '_', ' '))`;
/** A value → its label from a fixed map; unknown values print as stored. */
const labelOf = (e: SQL, map: Record<string, string>) =>
  sql`CASE ${e}::text ${sql.join(Object.entries(map).map(([k, v]) => sql`WHEN ${k} THEN ${v}`), sql` `)} ELSE ${e}::text END`;
const branchName = (idExpr: string) => sql`(SELECT b_.name FROM branches b_ WHERE b_.id = ${raw(idExpr)})`;
const sp = (params: URLSearchParams) => Object.fromEntries(params) as Record<string, string | undefined>;
const csv = (v: string | null | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (v: string | null | undefined) => csv(v).filter((x) => UUID.test(x));
const uuidIn = (col: string, ids: string[]) => sql`${raw(col)} IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})`;
const canInvestorView = (s: SessionUser) =>
  can(s.roles, "investor.view.all", s.permissions) || can(s.roles, "investor.view.assigned", s.permissions);

// ── SIP Book — /dashboard/sips ───────────────────────────────────────────────

const SIP_FREQ: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", weekly: "Weekly", fortnightly: "Fortnightly", yearly: "Yearly" };
const SIP_STATUS: Record<string, string> = {
  active: "Active", paused: "Paused", stopped: "Stopped", rejected: "Rejected", completed: "Completed", pending: "Pending", expired: "Completed",
};

export const sipBookExport: ExportModule = {
  key: "sips",
  label: "SIP Book",
  fileName: "sip-book",
  piiSubject: "investor",
  canView: (s) => can(s.roles, "transactions.view", s.permissions),
  from: sql`sips JOIN investors ON investors.id = sips.investor_id`,
  async where(_tx, session, params) {
    // The page's rule: firm-wide for investor.view.all / reports.business,
    // otherwise SIPs they own OR of a client they manage.
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
    const p = sp(params);
    const scope: MetricScope = {
      tenantId: session.tenantId,
      rmIds: csv(p.rm), branchIds: csv(p.branch), segments: csv(p.segment), categories: csv(p.category),
      familyIds: csv(p.fam), tags: csv(p.tag), leadSources: csv(p.src), amcs: csv(p.amc),
    };
    const statuses = csv(p.status).flatMap((s) => (s === "completed" || s === "expired" ? ["completed", "expired"] : [s]));
    const conds: SQL[] = [
      sql`sips.tenant_id = ${session.tenantId}::uuid`,
      sql`(${clientWhere(scope, "investors")})`,
    ];
    if (scope.amcs?.length) conds.push(sql`sips.amc_name IN (${textList(scope.amcs)})`);
    if (!seesAll) conds.push(sql`(sips.rm_id = ${session.userId}::uuid OR investors.rm_id = ${session.userId}::uuid)`);
    const q = (p.q ?? "").trim();
    if (q) conds.push(sql`(sips.scheme_name ILIKE ${`%${q}%`} OR sips.amc_name ILIKE ${`%${q}%`} OR sips.folio_number ILIKE ${`%${q}%`} OR investors.name ILIKE ${`%${q}%`})`);
    if (statuses.length) conds.push(sql`sips.status IN (${textList(statuses)})`);
    conds.push(...inFilter(p.frequency ?? null, sql`sips.frequency`));
    const created = dateRangeCond(p, "created", "sips.created_at");
    if (created) conds.push(created);
    const ends = dateRangeCond(p, "end", "sips.end_date");
    if (ends) conds.push(ends);
    return conds;
  },
  orderBy: sql`sips.updated_at DESC`,
  columns: [
    { key: "investor", label: "Client", group: "Client", sql: raw("investors.name"), default: true },
    { key: "pan", label: "Client PAN", group: "Client", sql: raw("investors.pan"), pii: "pan" },
    { key: "client_rm", label: "Client's RM", group: "Client", sql: userName(raw("investors.rm_id")) },
    { key: "branch", label: "Branch", group: "Client", sql: branchName("investors.branch_id") },

    { key: "folio", label: "Folio", group: "SIP", sql: raw("sips.folio_number") },
    { key: "amc", label: "AMC", group: "SIP", sql: sql`COALESCE(sips.amc_name, sips.amc_code)`, default: true },
    { key: "scheme", label: "Scheme", group: "SIP", sql: sql`COALESCE(sips.scheme_name, sips.scheme_code)`, default: true },
    { key: "scheme_code", label: "Scheme code", group: "SIP", sql: raw("sips.scheme_code") },
    { key: "amount", label: "Amount", group: "SIP", sql: raw("sips.amount"), kind: "money", default: true },
    { key: "monthly", label: "Monthly equivalent", group: "SIP", sql: sipMonthlySql("sips"), kind: "money" },
    { key: "frequency", label: "Frequency", group: "SIP", sql: labelOf(raw("sips.frequency"), SIP_FREQ), default: true },
    { key: "sip_day", label: "SIP day", group: "SIP", sql: raw("sips.sip_date") },
    { key: "start", label: "Start date", group: "SIP", sql: d(raw("sips.start_date")), kind: "date" },
    { key: "end", label: "End date", group: "SIP", sql: d(raw("sips.end_date")), kind: "date" },
    { key: "next_recorded", label: "Next instalment (as recorded)", group: "SIP", sql: d(raw("sips.next_installment_at")), kind: "date" },
    { key: "status", label: "Status", group: "SIP", sql: labelOf(raw("sips.status"), SIP_STATUS), default: true },
    { key: "failures", label: "Consecutive failures", group: "SIP", sql: raw("sips.consecutive_failures") },
    { key: "rm", label: "RM", group: "SIP", sql: userName(raw("sips.rm_id")), default: true },
    { key: "remarks", label: "Remarks", group: "SIP", sql: raw("sips.remarks") },

    { key: "mandate_ref", label: "Mandate reference", group: "Mandate", sql: sql`(SELECT m_.mandate_ref_no FROM mandates m_ WHERE m_.id = sips.mandate_id)` },
    { key: "mandate_status", label: "Mandate status", group: "Mandate", sql: sql`(SELECT m_.status FROM mandates m_ WHERE m_.id = sips.mandate_id)` },
    { key: "mandate_limit", label: "Mandate limit", group: "Mandate", sql: sql`(SELECT m_.amount_limit FROM mandates m_ WHERE m_.id = sips.mandate_id)`, kind: "money" },
    { key: "mandate_expiry", label: "Mandate expires", group: "Mandate", sql: sql`(SELECT to_char(m_.expires_at, 'YYYY-MM-DD') FROM mandates m_ WHERE m_.id = sips.mandate_id)`, kind: "date" },

    { key: "created", label: "Added on", group: "Record", sql: dIst(raw("sips.created_at")), kind: "date" },
    { key: "updated", label: "Last updated", group: "Record", sql: dt(raw("sips.updated_at")), kind: "datetime" },
  ],
};

// ── SIP Rejections — /dashboard/sip-rejections ───────────────────────────────

const OPEN_RECOVERY = sql`r.recovery_status IN ('pending','client_contacted','bank_issue','mandate_issue')`;

export const sipRejectionsExport: ExportModule = {
  key: "sip-rejections",
  label: "SIP Rejections",
  fileName: "sip-rejections",
  piiSubject: "investor",
  // The SIP module's view (the tab's parent page) plus a client view, which
  // the client scope below needs.
  canView: (s) => can(s.roles, "transactions.view", s.permissions) && canInvestorView(s),
  from: sql`sip_rejections r LEFT JOIN investors i ON i.id = r.investor_id`,
  async where(tx, session, params) {
    const p = sp(params);
    // The list page shows the whole firm; the export keeps to the viewer's
    // client book (or rejections assigned to them).
    const scope = await investorScopeSql(tx, session, "i");
    const conds: SQL[] = [
      sql`r.tenant_id = ${session.tenantId}::uuid`,
      sql`(${scope} OR r.assigned_rm_id = ${session.userId}::uuid)`,
    ];
    const q = (p.q ?? "").trim();
    if (q) conds.push(sql`(i.name ILIKE ${`%${q}%`} OR r.scheme_name ILIKE ${`%${q}%`} OR r.amc_name ILIKE ${`%${q}%`} OR r.folio_number ILIKE ${`%${q}%`} OR r.rejection_reason ILIKE ${`%${q}%`})`);
    const rec = csv(p.recovery);
    if (rec.length) conds.push(sql`r.recovery_status IN (${textList(rec)})`);
    const reasonCat = (p.reason_cat ?? "").trim();
    if (reasonCat) conds.push(sql`r.reason_category = ${reasonCat}`);
    if (p.overdue === "1") conds.push(sql`((now() - r.status_changed_at) > interval '2 days' AND ${OPEN_RECOVERY})`);
    if (p.mtd === "1") conds.push(sql`r.rejection_date >= date_trunc('month', now())`);
    const dr = dateRangeCond(p, "rej", "r.rejection_date");
    if (dr) conds.push(dr);
    const branchIds = uuids(p.branch);
    const rmIds = uuids(p.rm);
    if (branchIds.length) conds.push(uuidIn("i.branch_id", branchIds));
    if (rmIds.length) conds.push(uuidIn("i.rm_id", rmIds));
    return conds;
  },
  orderBy: sql`r.rejection_date DESC, r.created_at DESC`,
  columns: [
    { key: "rejected_on", label: "Rejected on", group: "Rejection", sql: d(raw("r.rejection_date")), kind: "date", default: true },
    { key: "investor", label: "Client", group: "Rejection", sql: raw("i.name"), default: true },
    { key: "pan", label: "Client PAN", group: "Rejection", sql: raw("i.pan"), pii: "pan" },
    { key: "phone", label: "Client mobile", group: "Rejection", sql: raw("i.phone"), pii: "phone" },
    { key: "amc", label: "AMC", group: "Rejection", sql: raw("r.amc_name") },
    { key: "scheme", label: "Scheme", group: "Rejection", sql: raw("r.scheme_name"), default: true },
    { key: "folio", label: "Folio", group: "Rejection", sql: raw("r.folio_number") },
    { key: "amount", label: "Amount", group: "Rejection", sql: raw("r.rejection_amount"), kind: "money", default: true },
    { key: "reason", label: "Reason", group: "Rejection", sql: raw("r.rejection_reason"), default: true },
    { key: "reason_cat", label: "Reason category", group: "Rejection", sql: nice(raw("r.reason_category")) },

    { key: "rm", label: "Assigned RM", group: "Recovery", sql: userName(raw("r.assigned_rm_id")), default: true },
    { key: "client_rm", label: "Client's RM", group: "Recovery", sql: userName(raw("i.rm_id")) },
    { key: "branch", label: "Branch", group: "Recovery", sql: branchName("i.branch_id") },
    { key: "recovery_status", label: "Recovery status", group: "Recovery", sql: nice(raw("r.recovery_status")), default: true },
    { key: "follow_up", label: "Follow-up date", group: "Recovery", sql: d(raw("r.follow_up_date")), kind: "date" },
    { key: "recovery_date", label: "Recovery date", group: "Recovery", sql: d(raw("r.recovery_date")), kind: "date" },
    { key: "status_changed", label: "Status last changed", group: "Recovery", sql: dt(raw("r.status_changed_at")), kind: "datetime" },
    { key: "sla_breached", label: "SLA breached (>2 days)", group: "Recovery", sql: sql`((now() - r.status_changed_at) > interval '2 days' AND ${OPEN_RECOVERY})`, kind: "bool" },
    { key: "escalated", label: "Escalated on", group: "Recovery", sql: dt(raw("r.escalated_at")), kind: "datetime" },
    { key: "remarks", label: "Remarks", group: "Recovery", sql: raw("r.remarks") },
    { key: "created", label: "Logged on", group: "Recovery", sql: dIst(raw("r.created_at")), kind: "date" },
  ],
};

// ── MF Transactions — /dashboard/transactions ────────────────────────────────

export const transactionsExport: ExportModule = {
  key: "transactions",
  label: "MF Transactions",
  fileName: "transactions",
  piiSubject: "investor",
  canView: (s) => can(s.roles, "transactions.view", s.permissions) && canInvestorView(s),
  // Unaliased tables: the shared list filters reference "transactions" and "investors".
  from: sql`transactions LEFT JOIN investors ON investors.id = transactions.investor_id`,
  async where(tx, session, params) {
    const p = sp(params);
    // The page's own filters (shared builder), plus the client scope — the
    // list page applies none, the bulk file keeps to the viewer's book.
    const scope = await investorScopeSql(tx, session, "investors");
    return [
      sql`transactions.tenant_id = ${session.tenantId}::uuid`,
      ...(buildTransactionConditions(p) as SQL[]),
      transactionClientCondition(p, session.tenantId),
      scope,
    ];
  },
  orderBy: sql`transactions.order_date DESC NULLS LAST, transactions.created_at DESC`,
  columns: [
    { key: "date", label: "Order date", group: "Transaction", sql: d(raw("transactions.order_date")), kind: "date", default: true },
    { key: "settled", label: "Settlement date", group: "Transaction", sql: d(raw("transactions.settlement_date")), kind: "date" },
    { key: "type", label: "Type", group: "Transaction", sql: nice(raw("transactions.type")), default: true },
    { key: "direction", label: "Direction", group: "Transaction", sql: nice(raw("transactions.direction")) },
    { key: "amount", label: "Amount", group: "Transaction", sql: raw("transactions.amount"), kind: "money", default: true },
    { key: "units", label: "Units", group: "Transaction", sql: raw("transactions.units"), kind: "number" },
    { key: "nav", label: "NAV", group: "Transaction", sql: raw("transactions.nav"), kind: "number" },
    { key: "status", label: "Status", group: "Transaction", sql: nice(raw("transactions.status")), default: true },
    { key: "reason_code", label: "Reason code", group: "Transaction", sql: raw("transactions.reason_code") },
    { key: "reason", label: "Reason", group: "Transaction", sql: raw("transactions.reason_description") },
    { key: "order_id", label: "Order ID", group: "Transaction", sql: raw("transactions.order_id") },
    { key: "exchange", label: "Exchange", group: "Transaction", sql: raw("transactions.exchange") },
    { key: "source", label: "Source", group: "Transaction", sql: raw("transactions.source_feed") },
    { key: "executed_by", label: "Executed by", group: "Transaction", sql: userName(raw("transactions.executed_by")) },
    { key: "euin", label: "EUIN", group: "Transaction", sql: raw("transactions.executed_euin") },
    { key: "remarks", label: "Remarks", group: "Transaction", sql: raw("transactions.remarks") },
    { key: "created", label: "Recorded on", group: "Transaction", sql: dIst(raw("transactions.created_at")), kind: "date" },

    { key: "folio", label: "Folio", group: "Scheme", sql: raw("transactions.folio_number"), default: true },
    { key: "amc", label: "AMC", group: "Scheme", sql: sql`COALESCE(transactions.amc_name, transactions.amc_code)` },
    { key: "scheme", label: "Scheme", group: "Scheme", sql: sql`COALESCE(transactions.scheme_name, transactions.scheme_code)`, default: true },
    { key: "scheme_code", label: "Scheme code", group: "Scheme", sql: raw("transactions.scheme_code") },
    { key: "category", label: "Scheme category", group: "Scheme", sql: raw("transactions.scheme_category") },

    { key: "investor", label: "Client", group: "Client", sql: raw("investors.name"), default: true },
    { key: "pan", label: "Client PAN", group: "Client", sql: raw("investors.pan"), pii: "pan" },
    { key: "client_rm", label: "Client's RM", group: "Client", sql: userName(raw("investors.rm_id")) },
    { key: "branch", label: "Branch", group: "Client", sql: branchName("investors.branch_id") },
  ],
};

// ── Business Entries — /dashboard/business-entries ───────────────────────────
//
// One row per LINE (scheme / product leg), the entry's own fields repeated:
// the amount, scheme and RTA outcome live on the line, so a per-entry file
// would lose exactly what Operations reconciles. An entry with no lines still
// gives one row (line columns blank).

const BE_MANAGE_ROLES = ["owner", "branch_head", "rm", "back_office", "ops"];
const BE_PRODUCT: Record<string, string> = {
  mutual_fund: "Mutual Fund", direct_equity: "Direct Equity", pms: "PMS", aif: "AIF", sif: "SIF", bond: "Bond", ncd: "NCD", p2p: "P2P", las: "LAS", other: "Other",
};

export const businessEntriesExport: ExportModule = {
  key: "business-entries",
  label: "Business Entries",
  fileName: "business-entries",
  canView: (s) => s.roles.some((r) => BE_MANAGE_ROLES.includes(r)),
  from: sql`business_entries be LEFT JOIN business_entry_lines bl ON bl.entry_id = be.id`,
  async where(_tx, session, params) {
    const p = sp(params);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "reports.business", session.permissions);
    const conds: SQL[] = [sql`be.tenant_id = ${session.tenantId}::uuid`];
    if (!seesAll) conds.push(sql`be.rm_id = ${session.userId}::uuid`);
    const q = (p.q ?? "").trim();
    if (q) conds.push(sql`(be.client_name ILIKE ${`%${q}%`} OR be.amc_name ILIKE ${`%${q}%`})`);
    conds.push(...inFilter(p.status ?? null, sql`be.status`));
    conds.push(...inFilter(p.productType ?? null, sql`be.product_type`));
    const rmIds = uuids(p.rm);
    if (rmIds.length) conds.push(uuidIn("be.rm_id", rmIds));
    const rta = csv(p.rta).filter((v) => (RTA_LINE_STATUSES as readonly string[]).includes(v));
    if (rta.length) {
      // As the list: only counted entries are checked against the RTA. The
      // file then carries just the lines with that outcome.
      conds.push(sql`be.status IN ('confirmed', 'emailed')`);
      conds.push(sql`bl.rta_status IN (${textList(rta)})`);
    }
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (p.from && day.test(p.from)) conds.push(sql`be.business_date >= ${p.from}::date`);
    if (p.to && day.test(p.to)) conds.push(sql`be.business_date <= ${p.to}::date`);
    return conds;
  },
  orderBy: sql`be.business_date DESC, be.created_at DESC, bl.sort_order NULLS LAST`,
  columns: [
    { key: "date", label: "Business date", group: "Entry", sql: d(raw("be.business_date")), kind: "date", default: true },
    { key: "client", label: "Client", group: "Entry", sql: sql`COALESCE((SELECT i_.name FROM investors i_ WHERE i_.id = be.investor_id), be.client_name)`, default: true },
    { key: "product", label: "Product", group: "Entry", sql: labelOf(raw("be.product_type"), BE_PRODUCT), default: true },
    { key: "platform", label: "Platform", group: "Entry", sql: raw("be.platform") },
    { key: "status", label: "Entry status", group: "Entry", sql: nice(raw("be.status")), default: true },
    { key: "rm", label: "RM", group: "Entry", sql: userName(raw("be.rm_id")), default: true },
    { key: "entry_amc", label: "Entry AMC", group: "Entry", sql: raw("be.amc_name") },
    { key: "entry_folio", label: "Entry folio", group: "Entry", sql: raw("be.folio_no") },
    { key: "total", label: "Entry total", group: "Entry", sql: raw("be.total_amount"), kind: "money" },
    { key: "liquid_net", label: "Liquid net", group: "Entry", sql: raw("be.liquid_net"), kind: "money" },
    { key: "notes", label: "Entry notes", group: "Entry", sql: raw("be.notes") },
    { key: "emailed", label: "Emailed at", group: "Entry", sql: dt(raw("be.emailed_at")), kind: "datetime" },
    { key: "created_by", label: "Entered by", group: "Entry", sql: userName(raw("be.created_by_id")) },
    { key: "created", label: "Entered on", group: "Entry", sql: dIst(raw("be.created_at")), kind: "date" },

    { key: "txn_type", label: "Transaction type", group: "Line", sql: nice(raw("bl.txn_type")), default: true },
    { key: "amc", label: "AMC", group: "Line", sql: raw("bl.amc_name") },
    { key: "scheme", label: "Scheme", group: "Line", sql: raw("bl.scheme_name"), default: true },
    { key: "scheme_code", label: "Scheme code", group: "Line", sql: raw("bl.scheme_code") },
    { key: "asset_class", label: "Asset class", group: "Line", sql: nice(raw("bl.asset_class")) },
    { key: "asset_category", label: "Asset category", group: "Line", sql: raw("bl.asset_category") },
    { key: "amount", label: "Line amount", group: "Line", sql: raw("bl.amount"), kind: "money", default: true },
    { key: "units", label: "Units", group: "Line", sql: raw("bl.units"), kind: "number" },
    { key: "frequency", label: "Frequency", group: "Line", sql: nice(raw("bl.frequency")) },
    { key: "sip_day", label: "SIP day", group: "Line", sql: raw("bl.sip_date") },
    { key: "from_scheme", label: "From scheme (switch / STP)", group: "Line", sql: raw("bl.from_scheme_name") },
    { key: "folio", label: "Line folio", group: "Line", sql: raw("bl.folio_no") },
    { key: "line_notes", label: "Line notes", group: "Line", sql: raw("bl.notes") },

    { key: "rta_status", label: "RTA outcome", group: "RTA check", sql: labelOf(raw("bl.rta_status"), RTA_STATUS_LABEL), default: true },
    { key: "rta_date", label: "RTA outcome date", group: "RTA check", sql: d(raw("bl.rta_status_at")), kind: "date" },
    { key: "rta_amount", label: "RTA amount", group: "RTA check", sql: raw("bl.rta_amount"), kind: "money" },
    { key: "rta_note", label: "RTA note", group: "RTA check", sql: raw("bl.rta_note") },
    { key: "rta_checked", label: "Last checked", group: "RTA check", sql: dt(raw("bl.rta_checked_at")), kind: "datetime" },
  ],
};

// ── Fixed Deposits — /dashboard/fixed-deposits ───────────────────────────────

const FD_LIVE = sql`f.status IN ('applied', 'active')`;
const FD_ISSUER: Record<string, string> = { bank: "Bank", small_finance_bank: "Small finance bank", corporate: "Corporate FD", nbfc: "NBFC", post_office: "Post office", other: "Other" };
const FD_STATUS: Record<string, string> = { applied: "Applied", active: "Active", matured: "Matured", renewed: "Renewed", closed_early: "Closed early", cancelled: "Cancelled" };
const FD_PAYOUT: Record<string, string> = { cumulative: "Cumulative", monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly" };
const FD_HOLDING: Record<string, string> = { single: "Single", joint: "Joint", either_or_survivor: "Either or survivor" };
const FD_TAX: Record<string, string> = { none: "Not submitted", "15g": "Form 15G", "15h": "Form 15H" };

export const fixedDepositsExport: ExportModule = {
  key: "fixed-deposits",
  label: "Fixed Deposits",
  fileName: "fixed-deposits",
  piiSubject: "investor",
  canView: canInvestorView,
  from: sql`fixed_deposits f JOIN investors i ON i.id = f.investor_id`,
  async where(tx, session, params) {
    // listFds (lib/fixed-deposits/service.ts): the client scope, not deleted,
    // then the page's view / status / issuer type / search.
    const p = sp(params);
    const scope = await investorScopeSql(tx, session, "i");
    const conds: SQL[] = [
      sql`f.tenant_id = ${session.tenantId}::uuid`,
      sql`f.deleted_at IS NULL`,
      sql`i.deleted_at IS NULL`,
      scope,
    ];
    const view = p.view || "live";
    const st = p.status || (view === "all" ? "all" : "live");
    if (st === "live") conds.push(FD_LIVE);
    else if (st !== "all") conds.push(sql`f.status = ${st}`);
    const within = view === "30" ? 30 : view === "90" ? 90 : null;
    if (within) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      conds.push(sql`${FD_LIVE} AND f.maturity_date BETWEEN ${today}::date AND ${today}::date + ${within}::int`);
    }
    if (p.type) conds.push(sql`f.issuer_type = ${p.type}`);
    const q = (p.q ?? "").trim();
    if (q) conds.push(sql`(i.name ILIKE ${`%${q}%`} OR f.issuer ILIKE ${`%${q}%`} OR f.fd_number ILIKE ${`%${q}%`} OR f.scheme_name ILIKE ${`%${q}%`})`);
    return conds;
  },
  orderBy: sql`CASE WHEN f.status IN ('applied', 'active') THEN 0 ELSE 1 END, f.maturity_date ASC, f.created_at DESC`,
  columns: [
    { key: "investor", label: "Client", group: "Client", sql: raw("i.name"), default: true },
    { key: "pan", label: "Client PAN", group: "Client", sql: raw("i.pan"), pii: "pan" },
    { key: "phone", label: "Client mobile", group: "Client", sql: raw("i.phone"), pii: "phone" },
    { key: "rm", label: "RM", group: "Client", sql: userName(raw("f.rm_id")), default: true },
    { key: "branch", label: "Branch", group: "Client", sql: branchName("i.branch_id") },

    { key: "issuer", label: "Issuer", group: "Deposit", sql: raw("f.issuer"), default: true },
    { key: "issuer_type", label: "Issuer type", group: "Deposit", sql: labelOf(raw("f.issuer_type"), FD_ISSUER) },
    { key: "scheme", label: "Scheme", group: "Deposit", sql: raw("f.scheme_name") },
    { key: "fd_number", label: "FD number", group: "Deposit", sql: raw("f.fd_number") },
    { key: "principal", label: "Amount deposited", group: "Deposit", sql: raw("f.principal"), kind: "money", default: true },
    { key: "rate", label: "Interest rate (%)", group: "Deposit", sql: raw("f.interest_rate"), kind: "number", default: true },
    { key: "payout", label: "Payout", group: "Deposit", sql: labelOf(raw("f.payout"), FD_PAYOUT) },
    { key: "compounding", label: "Compounding", group: "Deposit", sql: nice(raw("f.compounding")) },
    { key: "deposit_date", label: "Deposit date", group: "Deposit", sql: d(raw("f.deposit_date")), kind: "date" },
    { key: "maturity_date", label: "Maturity date", group: "Deposit", sql: d(raw("f.maturity_date")), kind: "date", default: true },
    { key: "tenure_months", label: "Tenure (months)", group: "Deposit", sql: raw("f.tenure_months"), kind: "number" },
    { key: "tenure_days", label: "Tenure (days)", group: "Deposit", sql: raw("f.tenure_days"), kind: "number" },
    { key: "maturity_amount", label: "Maturity amount", group: "Deposit", sql: raw("f.maturity_amount"), kind: "money" },
    { key: "status", label: "Status", group: "Deposit", sql: labelOf(raw("f.status"), FD_STATUS), default: true },
    { key: "closed_on", label: "Closed on", group: "Deposit", sql: d(raw("f.closed_on")), kind: "date" },
    { key: "auto_renew", label: "Auto-renew", group: "Deposit", sql: raw("f.auto_renew"), kind: "bool" },

    { key: "holding", label: "Holding", group: "Holders & tax", sql: labelOf(raw("f.holding"), FD_HOLDING) },
    { key: "joint", label: "Joint holders", group: "Holders & tax", sql: raw("f.joint_holders") },
    { key: "nominee", label: "Nominee", group: "Holders & tax", sql: raw("f.nominee_name") },
    { key: "senior", label: "Senior citizen", group: "Holders & tax", sql: raw("f.senior_citizen"), kind: "bool" },
    { key: "tax_form", label: "Tax form", group: "Holders & tax", sql: labelOf(raw("f.tax_form"), FD_TAX) },

    { key: "commission_rate", label: "Commission rate (%)", group: "Commission", sql: raw("f.commission_rate"), kind: "number" },
    { key: "commission", label: "Commission amount", group: "Commission", sql: raw("f.commission_amount"), kind: "money" },
    { key: "remarks", label: "Remarks", group: "Commission", sql: raw("f.remarks") },
    { key: "created", label: "Recorded on", group: "Commission", sql: dIst(raw("f.created_at")), kind: "date" },
  ],
};

// ── Goals — /dashboard/goals ─────────────────────────────────────────────────

export const goalsExport: ExportModule = {
  key: "goals",
  label: "Goals",
  fileName: "goals",
  canView: canInvestorView,
  from: sql`goals g LEFT JOIN investors i ON i.id = g.investor_id`,
  async where(_tx, session) {
    // The page's rule: investor.view.all → every goal of a live client record;
    // otherwise goals of clients assigned to them.
    const all = can(session.roles, "investor.view.all", session.permissions);
    return [
      sql`g.tenant_id = ${session.tenantId}::uuid`,
      sql`i.deleted_at IS NULL`,
      ...(all ? [] : [sql`i.rm_id = ${session.userId}::uuid`]),
    ];
  },
  // The page's default order (soonest target first); its ?sort= is not carried.
  orderBy: sql`g.target_date ASC NULLS LAST`,
  columns: [
    { key: "investor", label: "Client", group: "Goal", sql: raw("i.name"), default: true },
    { key: "client_rm", label: "Client's RM", group: "Goal", sql: userName(raw("i.rm_id")) },
    { key: "name", label: "Goal", group: "Goal", sql: raw("g.name"), default: true },
    { key: "category", label: "Category", group: "Goal", sql: nice(raw("g.category")) },
    { key: "target_amount", label: "Target amount", group: "Goal", sql: raw("g.target_amount"), kind: "money", default: true },
    { key: "present_target", label: "Target in today's money", group: "Goal", sql: raw("g.present_target_amount"), kind: "money" },
    { key: "target_date", label: "Target date", group: "Goal", sql: d(raw("g.target_date")), kind: "date", default: true },
    { key: "inflation", label: "Inflation (%)", group: "Goal", sql: raw("g.inflation_pct"), kind: "number" },
    { key: "expected_return", label: "Expected return (%)", group: "Goal", sql: raw("g.expected_return"), kind: "number" },
    { key: "step_up", label: "Annual step-up (%)", group: "Goal", sql: raw("g.step_up_pct"), kind: "number" },
    { key: "glide_path", label: "Glide path", group: "Goal", sql: nice(raw("g.glide_path")) },
    { key: "started", label: "Started on", group: "Goal", sql: d(raw("g.started_on")), kind: "date" },
    { key: "remarks", label: "Remarks", group: "Goal", sql: raw("g.remarks") },

    // These are the nightly recompute's figures (the page recomputes live).
    { key: "status", label: "Status (last nightly check)", group: "Progress (last nightly check)", sql: nice(raw("g.status")), default: true },
    { key: "current_value", label: "Current value", group: "Progress (last nightly check)", sql: raw("g.current_value"), kind: "money", default: true },
    { key: "progress", label: "Progress (%)", group: "Progress (last nightly check)", sql: raw("g.progress_pct"), kind: "number" },
    { key: "expected_progress", label: "Expected progress (%)", group: "Progress (last nightly check)", sql: raw("g.expected_progress_pct"), kind: "number" },
    { key: "required_sip", label: "Required monthly SIP", group: "Progress (last nightly check)", sql: raw("g.required_monthly_sip"), kind: "money" },
    { key: "existing_sip", label: "Existing monthly SIP", group: "Progress (last nightly check)", sql: sql`COALESCE(g.existing_monthly_sip, g.monthly_contribution)`, kind: "money" },
    { key: "gap", label: "Gap amount", group: "Progress (last nightly check)", sql: raw("g.gap_amount"), kind: "money" },
    { key: "next_review", label: "Next review", group: "Progress (last nightly check)", sql: dIst(raw("g.next_review_at")), kind: "date" },
    { key: "created", label: "Created on", group: "Progress (last nightly check)", sql: dIst(raw("g.created_at")), kind: "date" },
  ],
};

// ── Financial Plans — /dashboard/financial-plans ─────────────────────────────

const jsonSum = (col: string, key: string) =>
  sql`(SELECT COALESCE(SUM((x_->>${key})::numeric), 0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${raw(col)}) = 'array' THEN ${raw(col)} ELSE '[]'::jsonb END) x_)`;
const jsonLen = (col: string) => sql`(CASE WHEN jsonb_typeof(${raw(col)}) = 'array' THEN jsonb_array_length(${raw(col)}) ELSE 0 END)`;

export const financialPlansExport: ExportModule = {
  key: "financial-plans",
  label: "Financial Health Checks",
  fileName: "financial-plans",
  canView: (s) => can(s.roles, "financial_plan.view", s.permissions),
  from: sql`financial_plans fp LEFT JOIN investors i ON i.id = fp.investor_id LEFT JOIN leads l ON l.id = fp.lead_id`,
  async where(_tx, session, params) {
    // The page's rule: investor.view.all / compliance.view see every plan,
    // everyone else the plans they prepared.
    const p = sp(params);
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const conds: SQL[] = [sql`fp.tenant_id = ${session.tenantId}::uuid`];
    if (!seesAll) conds.push(sql`fp.prepared_by_user_id = ${session.userId}::uuid`);
    const q = (p.q ?? "").trim();
    if (q) conds.push(sql`(fp.plan_number ILIKE ${`%${q}%`} OR i.name ILIKE ${`%${q}%`} OR l.name ILIKE ${`%${q}%`})`);
    conds.push(...inFilter(p.status ?? null, sql`fp.status`));
    const dr = dateRangeCond(p, "created", "fp.created_at");
    if (dr) conds.push(dr);
    return conds;
  },
  orderBy: sql`fp.created_at DESC`,
  columns: [
    { key: "number", label: "Plan number", group: "Plan", sql: raw("fp.plan_number"), default: true },
    { key: "client", label: "Client / lead", group: "Plan", sql: sql`COALESCE(i.name, l.name)`, default: true },
    { key: "for", label: "Prepared for", group: "Plan", sql: sql`CASE WHEN fp.investor_id IS NOT NULL THEN 'Client' WHEN fp.lead_id IS NOT NULL THEN 'Lead' END` },
    { key: "status", label: "Status", group: "Plan", sql: nice(raw("fp.status")), default: true },
    { key: "prepared_by", label: "Prepared by", group: "Plan", sql: userName(raw("fp.prepared_by_user_id")), default: true },
    { key: "prepared_at", label: "Prepared on", group: "Plan", sql: dIst(raw("fp.prepared_at")), kind: "date" },
    { key: "created", label: "Created on", group: "Plan", sql: dIst(raw("fp.created_at")), kind: "date" },
    { key: "risk", label: "Risk profile", group: "Plan", sql: nice(raw("fp.risk_profile")) },

    { key: "client_age", label: "Client age", group: "Family", sql: raw("fp.client_age"), kind: "number" },
    { key: "spouse_age", label: "Spouse age", group: "Family", sql: raw("fp.spouse_age"), kind: "number" },
    { key: "children", label: "Children", group: "Family", sql: jsonLen("fp.children_details"), kind: "number" },

    { key: "income", label: "Monthly income", group: "Cash flow", sql: raw("fp.monthly_income"), kind: "money", default: true },
    { key: "expenses", label: "Monthly expenses", group: "Cash flow", sql: raw("fp.monthly_expenses"), kind: "money" },
    { key: "surplus", label: "Monthly surplus", group: "Cash flow", sql: sql`GREATEST(0, COALESCE(fp.monthly_income::numeric, 0) - COALESCE(fp.monthly_expenses::numeric, 0))`, kind: "money", default: true },
    { key: "savings_rate", label: "Savings rate (%)", group: "Cash flow", sql: raw("fp.savings_rate"), kind: "number" },
    { key: "emi_pct", label: "EMI to income (%)", group: "Cash flow", sql: raw("fp.emi_to_income_pct"), kind: "number" },

    { key: "assets", label: "Total assets", group: "Net worth", sql: jsonSum("fp.assets", "value"), kind: "money" },
    { key: "liabilities", label: "Total liabilities", group: "Net worth", sql: jsonSum("fp.liabilities", "value"), kind: "money" },
    { key: "net_worth", label: "Net worth", group: "Net worth", sql: sql`(${jsonSum("fp.assets", "value")} - ${jsonSum("fp.liabilities", "value")})`, kind: "money" },
    { key: "ef_months", label: "Emergency fund target (months)", group: "Net worth", sql: raw("fp.emergency_fund_target_months"), kind: "number" },
    { key: "ef_value", label: "Emergency fund today", group: "Net worth", sql: raw("fp.emergency_fund_current_value"), kind: "money" },

    { key: "life_sa", label: "Life cover", group: "Protection", sql: raw("fp.life_insurance_sum_assured"), kind: "money" },
    { key: "life_prem", label: "Life premium (annual)", group: "Protection", sql: raw("fp.life_insurance_annual_premium"), kind: "money" },
    { key: "health_sa", label: "Health cover", group: "Protection", sql: raw("fp.health_insurance_sum_assured"), kind: "money" },
    { key: "health_prem", label: "Health premium (annual)", group: "Protection", sql: raw("fp.health_insurance_annual_premium"), kind: "money" },

    { key: "goals", label: "Goals", group: "Goals & allocation", sql: jsonLen("fp.goals"), kind: "number" },
    { key: "eq", label: "Recommended equity (%)", group: "Goals & allocation", sql: raw("fp.recommended_equity_pct"), kind: "number" },
    { key: "debt", label: "Recommended debt (%)", group: "Goals & allocation", sql: raw("fp.recommended_debt_pct"), kind: "number" },
    { key: "gold", label: "Recommended gold (%)", group: "Goals & allocation", sql: raw("fp.recommended_gold_pct"), kind: "number" },
    { key: "cash", label: "Recommended cash (%)", group: "Goals & allocation", sql: raw("fp.recommended_cash_pct"), kind: "number" },
  ],
};

// ── Proposals — /dashboard/proposals ─────────────────────────────────────────

/** Past its valid-till date on the IST calendar (as the page). */
const P_PAST = sql`(p.valid_until IS NOT NULL AND (p.valid_until AT TIME ZONE 'Asia/Kolkata')::date < (now() AT TIME ZONE 'Asia/Kolkata')::date)`;
const P_TABS: Record<string, SQL> = {
  draft: sql`(p.status IN ('draft', 'ready') AND NOT ${P_PAST})`,
  sent: sql`(p.status IN ('sent', 'viewed', 'changes_requested') AND NOT ${P_PAST})`,
  accepted: sql`p.status IN ('accepted', 'partially_approved', 'executed')`,
  rejected: sql`p.status = 'rejected'`,
  expired: sql`(p.status = 'expired' OR (p.status IN ('draft', 'ready', 'sent', 'viewed', 'changes_requested') AND ${P_PAST}))`,
};
const P_ITEMS = sql`(CASE WHEN jsonb_typeof(p.products) = 'array' THEN p.products ELSE '[]'::jsonb END)`;

export const proposalsExport: ExportModule = {
  key: "proposals",
  label: "Proposals",
  fileName: "proposals",
  piiSubject: "investor",
  canView: (s) => can(s.roles, "proposal.view", s.permissions),
  from: sql`proposals p`,
  async where(_tx, session, params) {
    const p = sp(params);
    // The list page applies no row scope; the export uses the proposals API's
    // (GET /api/proposals): investor.view.all / compliance.view see every
    // proposal, everyone else the ones they prepared.
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);
    const conds: SQL[] = [sql`p.tenant_id = ${session.tenantId}::uuid`, sql`p.status <> 'superseded'`];
    if (!seesAll) conds.push(sql`p.prepared_by_user_id = ${session.userId}::uuid`);
    const q = (p.q ?? "").trim();
    if (q) conds.push(sql`(p.proposal_number ILIKE ${`%${q}%`} OR p.title ILIKE ${`%${q}%`} OR p.recipient_name ILIKE ${`%${q}%`})`);
    conds.push(...inFilter(p.type ?? null, sql`p.type`));
    conds.push(...inFilter(p.risk ?? null, sql`p.risk_rating`));
    const dr = dateRangeCond(p, "created", "p.created_at");
    if (dr) conds.push(dr);
    const statuses = csv(p.status);
    if (statuses.length) conds.push(sql`p.status IN (${textList(statuses)})`);
    if (p.view === "board") {
      // The pipeline board: every open column, no tab.
      conds.push(sql`p.status NOT IN ('rejected', 'expired')`);
    } else if (!statuses.length) {
      conds.push(P_TABS[p.tab ?? ""] ?? P_TABS.draft);
    }
    return conds;
  },
  orderBy: sql`p.created_at DESC`,
  columns: [
    { key: "number", label: "Proposal number", group: "Proposal", sql: raw("p.proposal_number"), default: true },
    { key: "version", label: "Version", group: "Proposal", sql: raw("p.version"), kind: "number" },
    { key: "title", label: "Title", group: "Proposal", sql: raw("p.title") },
    { key: "type", label: "Type", group: "Proposal", sql: nice(raw("p.type")) },
    { key: "status", label: "Status", group: "Proposal", sql: sql`CASE WHEN p.status IN ('draft', 'ready', 'sent', 'viewed', 'changes_requested') AND ${P_PAST} THEN 'Expired' ELSE initcap(replace(p.status, '_', ' ')) END`, default: true },
    { key: "risk", label: "Risk rating", group: "Proposal", sql: nice(raw("p.risk_rating")) },
    { key: "invest", label: "Invest amount", group: "Proposal", sql: raw("p.total_investment"), kind: "money", default: true },
    { key: "corpus", label: "Projected corpus (illustrative)", group: "Proposal", sql: raw("p.expected_corpus"), kind: "money" },
    { key: "items", label: "Products", group: "Proposal", sql: sql`jsonb_array_length(${P_ITEMS})`, kind: "number" },
    { key: "schemes", label: "Schemes / products", group: "Proposal", sql: sql`(SELECT string_agg(COALESCE(x_->>'schemeName', x_->>'policyName', x_->>'strategyName', x_->>'fundName', x_->>'name', x_->>'productName'), '; ') FROM jsonb_array_elements(${P_ITEMS}) x_)` },
    { key: "summary", label: "Summary", group: "Proposal", sql: raw("p.summary") },
    { key: "prepared_by", label: "Prepared by", group: "Proposal", sql: userName(raw("p.prepared_by_user_id")), default: true },
    { key: "branch", label: "Branch", group: "Proposal", sql: branchName("p.branch_id") },

    { key: "recipient", label: "Client", group: "Recipient", sql: raw("p.recipient_name"), default: true },
    { key: "recipient_type", label: "Recipient type", group: "Recipient", sql: nice(raw("p.recipient_type")) },
    { key: "email", label: "Recipient email", group: "Recipient", sql: raw("p.recipient_email"), pii: "email" },
    { key: "phone", label: "Recipient phone", group: "Recipient", sql: raw("p.recipient_phone"), pii: "phone" },

    { key: "created", label: "Created on", group: "Timeline", sql: dIst(raw("p.created_at")), kind: "date" },
    { key: "valid_till", label: "Valid till", group: "Timeline", sql: dIst(raw("p.valid_until")), kind: "date", default: true },
    { key: "sent", label: "Sent on", group: "Timeline", sql: dIst(raw("p.sent_at")), kind: "date" },
    { key: "viewed", label: "Last viewed", group: "Timeline", sql: dIst(raw("p.last_viewed_at")), kind: "date" },
    { key: "views", label: "Times viewed", group: "Timeline", sql: raw("p.view_count"), kind: "number" },
    { key: "accepted", label: "Accepted on", group: "Timeline", sql: dIst(raw("p.accepted_at")), kind: "date" },
    { key: "rejected", label: "Rejected on", group: "Timeline", sql: dIst(raw("p.rejected_at")), kind: "date" },
    { key: "rejection_reason", label: "Rejection reason", group: "Timeline", sql: raw("p.rejection_reason") },
    { key: "change_note", label: "Change requested", group: "Timeline", sql: raw("p.change_request_note") },
    { key: "executed", label: "Executed on", group: "Timeline", sql: dIst(raw("p.executed_at")), kind: "date" },
    { key: "executed_amount", label: "Executed amount", group: "Timeline", sql: raw("p.executed_amount"), kind: "money" },
  ],
};
