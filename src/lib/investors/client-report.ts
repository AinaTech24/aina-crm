/**
 * The consolidated client report — the DATA side (2026-11-25, Investment
 * Options, flag `clientReportPdf`). Loads everything the CRM holds about one
 * client and turns it into the blocks client-report-pdf.ts lays out.
 * SERVER-ONLY.
 *
 * Rules it keeps (CLAUDE.md):
 *   - the client is loaded through the viewer's scope (loadViewableInvestor);
 *     family members outside the viewer's book are counted, never named;
 *   - field-level licence gates (PAN, phone, AUM …) apply as on the client page;
 *   - insurance needs an insurance capability, documents `document.view`;
 *   - a task reaches the client through EITHER link (related_investor_id or
 *     subject investor);
 *   - a blank field is "Not on record", never a fact about the client.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import type { LicenseState } from "@/lib/auth/license";
import { investors } from "@/db/schema";
import { investorScopeCondition, loadViewableInvestor } from "@/lib/investors/access";
import { valueInvestor } from "@/lib/finance/valuation";
import { clientCompleteness } from "@/lib/investors/completeness";
import { canNominate, clientTypeLabel, type ClientTypeDetails } from "@/lib/investors/client-types";
import { policyTypeLabel, POLICY_STATUS_LABEL, STATUS_IN_FORCE } from "@/lib/insurance/book";
import { cellText, claimDetailLines, policyDetailLines, policyDetailTables } from "@/lib/insurance/extra-fields";
import { productLabel } from "@/lib/opportunities/products";
import { attendeeIs } from "@/lib/review-meetings/attendees";
import { formatDate, formatMoney, formatMoneyFull, formatPercent, humanise } from "@/lib/format";
import type { ReportBlock, ReportColumn } from "./client-report-pdf";
import type { ClientReportSection } from "./client-report-sections";

type Row = Record<string, any>;

const rows = async (tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)).rows as Row[];
const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const d = (v: unknown) => (v ? formatDate(v as string) : "");
const dt = (v: unknown) => (v ? formatDate(v as string, "dateTime") : "");
const inr = (v: unknown) => {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? formatMoneyFull(n) : "";
};
const num = (v: unknown, digits = 3) => {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: digits }) : "";
};
const label = (v: unknown) => (txt(v) ? humanise(txt(v)) : "");
const join = (...xs: unknown[]) => xs.map(txt).filter(Boolean).join(" · ");
/** A YYYY-MM-DD value prints as a date, a ₹-labelled number as rupees. */
const asShown = (lbl: string, v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : /₹/.test(lbl) && /^-?\d+(\.\d+)?$/.test(v) ? formatMoneyFull(Number(v)) : v;
const plainLabel = (lbl: string) => lbl.replace(/\s*\(₹\)\s*$/, "");

function table(cols: ReportColumn[], data: string[][], maxLines?: number): ReportBlock {
  return { t: "table", cols, rows: data, maxLines };
}

export type ClientReport = {
  clientName: string;
  subtitles: string[];
  blocks: ReportBlock[];
  /** What the report printed, for the audit row. */
  pii: { pan: boolean; dob: boolean; address: boolean; phone: boolean; email: boolean; bank: boolean };
};

export async function buildClientReport(
  tx: Tx,
  session: SessionUser,
  license: LicenseState | null,
  id: string,
  sections: ClientReportSection[],
  opts: { clientCopy: boolean },
): Promise<ClientReport | null> {
  const inv = await loadViewableInvestor(tx, session, id).catch((e: any) => {
    if (e?.status === 403) return null;
    throw e;
  });
  if (!inv || (inv as any).deletedAt) return null;

  const allow = (f: string) => isFieldAllowed(license, "investor", f);
  const show = {
    pan: allow("pan"), dob: allow("dob"), phone: allow("phone"), email: allow("email"),
    address: allow("address") || allow("city"), aum: allow("aum"),
    sip: allow("active_sip_amount") || allow("sip"), kyc: allow("kyc_status") || allow("kyc"),
    risk: allow("risk_profile") || allow("risk"), nominee: allow("nominee_name") || allow("nominee"),
    bank: allow("bank_account_number_masked") || allow("bank"), rm: allow("rm_id") || allow("rm"),
  };
  const caps = {
    insurance: (["insurance.view", "insurance.view.all", "insurance.write"] as const).some((c) => can(session.roles, c, session.permissions)),
    documents: can(session.roles, "document.view", session.permissions),
  };
  const want = new Set(sections);
  const on = (k: ClientReportSection) => want.has(k);
  const i = inv as any;
  const tenantId = session.tenantId;
  const blocks: ReportBlock[] = [];

  const [rm] = i.rmId ? await rows(tx, sql`SELECT name, email, phone FROM users WHERE id = ${i.rmId}::uuid`) : [];
  const [branch] = i.branchId ? await rows(tx, sql`SELECT name FROM branches WHERE id = ${i.branchId}::uuid`) : [];
  const [family] = i.familyId
    ? await rows(tx, sql`SELECT id, family_name, family_code, head_name, primary_investor_id, review_frequency, next_review_at FROM families WHERE id = ${i.familyId}::uuid`)
    : [];

  // ── Headline ──────────────────────────────────────────────────────────
  const valuation = on("portfolio") || show.aum ? await valueInvestor(tx, id) : null;
  const [ins] = caps.insurance
    ? await rows(tx, sql`
        SELECT count(*) FILTER (WHERE status = ANY(ARRAY['active','claim_filed','claim_settled']::text[]))::int AS live,
               COALESCE(sum(annual_premium::numeric) FILTER (WHERE status = ANY(ARRAY['active','claim_filed','claim_settled']::text[])), 0) AS premium,
               COALESCE(sum(sum_assured::numeric) FILTER (WHERE status = ANY(ARRAY['active','claim_filed','claim_settled']::text[])), 0) AS cover
          FROM insurance_policies WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid`)
    : [];
  const [fd] = await rows(tx, sql`
    SELECT count(*)::int AS n, COALESCE(sum(principal::numeric), 0) AS principal
      FROM fixed_deposits WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid
       AND deleted_at IS NULL AND status = 'active'`);
  const [sipBook] = await rows(tx, sql`
    SELECT count(*)::int AS n, COALESCE(sum(amount::numeric), 0) AS amount
      FROM sips WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid AND status = 'active'`);

  const stats: { label: string; value: string; sub?: string }[] = [];
  if (show.aum && valuation) {
    stats.push({ label: "Mutual fund value", value: formatMoney(valuation.currentValue), sub: valuation.asOf ? `NAV as on ${formatDate(valuation.asOf)}` : undefined });
    if (valuation.gain != null) stats.push({ label: "Gain", value: formatMoney(valuation.gain), sub: valuation.absoluteReturn != null ? `${formatPercent(valuation.absoluteReturn * 100)} absolute` : undefined });
    stats.push({ label: "XIRR", value: valuation.xirr != null ? formatPercent(valuation.xirr * 100) : valuation.xirrPartial != null ? `~${formatPercent(valuation.xirrPartial * 100)}` : "Not known", sub: valuation.xirr == null && valuation.xirrPartial == null ? "Needs the transaction history" : "Annualised" });
  }
  if (show.sip) stats.push({ label: "Active SIPs", value: Number(sipBook?.n) ? formatMoney(sipBook.amount) : "None", sub: Number(sipBook?.n) ? `${sipBook.n} SIP${sipBook.n === 1 ? "" : "s"}` : undefined });
  if (ins) stats.push({ label: "Insurance in force", value: Number(ins.live) ? `${ins.live} polic${ins.live === 1 ? "y" : "ies"}` : "None on record", sub: Number(ins.live) ? `Cover ${formatMoney(ins.cover)} · premium ${formatMoney(ins.premium)}/yr` : undefined });
  if (Number(fd?.n)) stats.push({ label: "Fixed deposits", value: formatMoney(fd.principal), sub: `${fd.n} live FD${fd.n === 1 ? "" : "s"}` });
  blocks.push({ t: "h1", text: "Summary" });
  blocks.push({
    t: "kv",
    cols: 3,
    items: [
      ["Client", i.name],
      ["Client type", clientTypeLabel(i.investorCategory)],
      ["Status", label(i.status)],
      ["PAN", show.pan ? txt(i.pan).replace(/^NOPAN:.*/, "") : ""],
      ["Relationship manager", show.rm ? txt(rm?.name) : ""],
      ["Branch", txt(branch?.name)],
      ["Family", family ? join(family.family_name, family.family_code) : "Not mapped to a family"],
      ["Category", join(i.segmentTag, i.clientCategory ? `Category ${i.clientCategory}` : "")],
      ["Client since", d(i.onboardedAt)],
      ["Risk profile", show.risk ? (i.riskProfile ? join(label(i.riskProfile), i.riskProfileProvisional ? "provisional" : "") : "Not completed") : ""],
      ["Last review", d(i.lastReviewAt) || "Not on record"],
      ["Next review", d(i.nextReviewAt) || "Not scheduled"],
    ],
  });
  if (stats.length) blocks.push({ t: "stats", items: stats });

  // ── Profile ───────────────────────────────────────────────────────────
  if (on("profile")) {
    const a = (i.address ?? {}) as Row;
    const td = (i.typeDetails ?? {}) as ClientTypeDetails;
    blocks.push({ t: "h1", text: "Profile & KYC" });
    blocks.push({ t: "h2", text: "Personal & contact" });
    blocks.push({
      t: "kv",
      items: [
        ["Name as per PAN", txt(i.nameAsPerPan)],
        ["Date of birth", show.dob ? d(i.dob) : ""],
        ["Gender", i.gender === "M" ? "Male" : i.gender === "F" ? "Female" : i.gender === "O" ? "Other" : ""],
        ["Occupation", label(i.occupation)],
        ["Employer", txt(i.employerName)],
        ["Income", txt(i.incomeRange)],
        ["Mobile", show.phone ? txt(i.phone) : ""],
        ["Alternate mobile", show.phone ? txt(i.alternatePhone) : ""],
        ["WhatsApp", show.phone ? txt(i.whatsappPhone) : ""],
        ["Email", show.email ? txt(i.email) : ""],
        ["Residency", label(i.residencyStatus)],
        ["Language", txt(i.languagePref)],
      ],
    });
    if (show.address && (a.line1 || a.city)) {
      blocks.push({ t: "kv", cols: 1, items: [["Address", [a.line1, a.city, a.state, a.pincode, a.country].map(txt).filter(Boolean).join(", ")]] });
    }
    // The type's own details (guardian, Karta, entity, NRI, business).
    const typeItems: [string, string][] = [];
    if (td.guardian?.name) typeItems.push(["Guardian", join(td.guardian.name, label(td.guardian.relation), show.pan ? td.guardian.pan : "", show.phone ? td.guardian.mobile : "")]);
    if (td.karta?.name) typeItems.push(["Karta", join(td.karta.name, show.pan ? td.karta.pan : "", show.phone ? td.karta.mobile : "")]);
    if (td.coparceners?.length) typeItems.push(["Coparceners", td.coparceners.map((c) => join(c.name, c.relation)).join("; ")]);
    if (td.entity) {
      typeItems.push(["Formed / incorporated", d(td.entity.formedOn)], ["Registration no.", txt(td.entity.registrationNo)], ["Nature of business", txt(td.entity.natureOfBusiness)]);
      if (td.entity.netWorth) typeItems.push(["Net worth", join(inr(td.entity.netWorth), td.entity.netWorthAsOn ? `as on ${d(td.entity.netWorthAsOn)}` : "")]);
      typeItems.push(["FATCA / CRS class", label(td.entity.fatcaClass)]);
    }
    if (td.signatories?.length) typeItems.push(["Authorised signatories", td.signatories.map((s) => join(s.name, s.designation)).join("; ")]);
    if (td.ubos?.length) typeItems.push(["Beneficial owners", td.ubos.map((u) => join(u.name, u.holdingPct !== "" && u.holdingPct != null ? `${u.holdingPct}%` : "")).join("; ")]);
    if (td.nri) typeItems.push(["Country of residence", txt(td.nri.countryOfResidence)], ["Tax residency", txt(td.nri.taxResidencyCountry)], ["NRE / NRO", label(td.nri.accountType)], ["Overseas address", show.address ? txt(td.nri.overseasAddress) : ""]);
    if (td.businessName) typeItems.push(["Business name", txt(td.businessName)]);
    if (typeItems.some(([, v]) => v)) {
      blocks.push({ t: "h2", text: `${clientTypeLabel(i.investorCategory)} details` });
      blocks.push({ t: "kv", items: typeItems });
    }

    if (show.kyc) {
      blocks.push({ t: "h2", text: "KYC & compliance" });
      blocks.push({
        t: "kv",
        items: [
          ["KYC status", label(i.kycStatus) || "Not on record"],
          ["KRA", txt(i.kraName)],
          ["KYC validated", d(i.kycValidatedAt)],
          ["CKYC no.", txt(i.ckycNumber)],
          ["PAN–Aadhaar link", label(i.panAadhaarLinkStatus)],
          ["FATCA", label(i.fatcaStatus)],
          ["IPV", label(i.ipvStatus)],
          ["UBO", label(i.uboStatus)],
          ["KYC remark", txt(i.kycStatusRemark)],
          ["BSE UCC", txt(i.bseUccCode)],
          ["NSE CAN", txt(i.nseCanCode)],
          ["Mandate", join(label(i.mandateStatus), i.mandateAmount ? inr(i.mandateAmount) : "", i.mandateRefNo)],
        ],
      });
    }
    if (show.risk) {
      blocks.push({ t: "h2", text: "Risk profile" });
      blocks.push({
        t: "kv",
        items: [
          ["Category", i.riskProfile ? label(i.riskProfile) : "Not completed"],
          ["Score", i.riskProfileScore != null ? String(i.riskProfileScore) : ""],
          ["Signed", d(i.riskProfileSignedAt)],
          ["Review by", d(i.riskProfileExpiresOn)],
          ["Basis", i.riskProfile ? (i.riskProfileProvisional ? "Provisional (not confirmed by the client)" : "Confirmed by the client") : ""],
        ],
      });
    }
    if (show.bank) {
      const banks = (Array.isArray(i.bankAccounts) && i.bankAccounts.length
        ? i.bankAccounts
        : i.bankName ? [{ bankName: i.bankName, accountMasked: i.bankAccountNumberMasked, ifsc: i.bankIfsc }] : []) as Row[];
      blocks.push({ t: "h2", text: "Bank accounts" });
      blocks.push(banks.length
        ? table([{ h: "Bank", w: 3 }, { h: "Account", w: 2 }, { h: "IFSC", w: 2 }, { h: "Type", w: 1.5 }],
            banks.map((b) => [txt(b.bankName), txt(b.accountMasked), txt(b.ifsc), label(b.accountType)]))
        : { t: "empty", text: "No bank account on record." });
    }
    if (show.nominee && canNominate(i.investorCategory)) {
      const noms = (Array.isArray(i.nominees) && i.nominees.length
        ? i.nominees
        : i.nomineeName ? [{ name: i.nomineeName, relation: i.nomineeRelation, dob: i.nomineeDob }] : []) as Row[];
      blocks.push({ t: "h2", text: "Nominees" });
      blocks.push(noms.length
        ? table([{ h: "Nominee", w: 3 }, { h: "Relation", w: 1.6 }, { h: "Date of birth", w: 1.6 }, { h: "Mobile", w: 1.8 }, { h: "Share", w: 1, right: true }],
            noms.map((n) => [txt(n.name), label(n.relation), show.dob ? d(n.dob) : "", show.phone ? txt(n.mobile) : "", n.sharePct != null ? `${n.sharePct}%` : ""]))
        : { t: "empty", text: td.nominationOptOut ? "The client has opted out of nomination." : "No nominee on record." });
    }
  }

  // ── Family ────────────────────────────────────────────────────────────
  if (on("family")) {
    blocks.push({ t: "h1", text: "Family" });
    if (!family) {
      blocks.push({ t: "empty", text: "Not mapped to a family." });
    } else {
      blocks.push({ t: "kv", items: [["Family", txt(family.family_name)], ["Code", txt(family.family_code)], ["Head", txt(family.head_name)], ["Review frequency", label(family.review_frequency)], ["Next family review", d(family.next_review_at)]] });
      const scope = await investorScopeCondition(tx, session);
      const members = await tx
        .select({ id: investors.id, name: investors.name, role: investors.familyRole, aum: investors.aum, sip: investors.activeSipAmount, status: investors.status, dob: investors.dob })
        .from(investors)
        .where(and(eq(investors.tenantId, tenantId), eq(investors.familyId, family.id), isNull(investors.deletedAt), isNull(investors.mergedIntoId), scope));
      const [all] = await rows(tx, sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${tenantId}::uuid AND family_id = ${family.id}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL`);
      members.sort((a, b) => Number(b.id === family.primary_investor_id) - Number(a.id === family.primary_investor_id) || a.name.localeCompare(b.name));
      blocks.push(table(
        [{ h: "Member", w: 3.2 }, { h: "Role", w: 1.6 }, { h: "Status", w: 1.3 }, { h: "AUM", w: 1.6, right: true }, { h: "Monthly SIP", w: 1.5, right: true }],
        members.map((m) => [
          `${m.name}${m.id === id ? " (this client)" : ""}`,
          m.id === family.primary_investor_id ? "Head" : label(m.role),
          label(m.status),
          show.aum ? inr(m.aum) : "",
          show.sip ? inr(m.sip) : "",
        ]),
      ));
      const hidden = Number(all?.n ?? 0) - members.length;
      if (hidden > 0) blocks.push({ t: "para", muted: true, text: `${hidden} more member${hidden === 1 ? " is" : "s are"} outside your book and not listed.` });
    }
  }

  // ── Mutual funds ──────────────────────────────────────────────────────
  if (on("portfolio") && valuation && show.aum) {
    const v = valuation;
    blocks.push({ t: "h1", text: "Mutual fund portfolio", note: v.asOf ? `NAV as on ${formatDate(v.asOf)}` : undefined });
    blocks.push({
      t: "stats",
      items: [
        { label: "Current value", value: formatMoneyFull(v.currentValue) },
        { label: "Invested (net)", value: v.investedNet != null ? formatMoneyFull(v.investedNet) : v.investedEstimate != null ? `~${formatMoneyFull(v.investedEstimate)}` : "Not known" },
        { label: "Gain", value: v.gain != null ? formatMoneyFull(v.gain) : "Not known", sub: v.absoluteReturn != null ? `${formatPercent(v.absoluteReturn * 100)} absolute` : undefined },
        { label: "XIRR", value: v.xirr != null ? formatPercent(v.xirr * 100) : v.xirrPartial != null ? `~${formatPercent(v.xirrPartial * 100)}` : "Not known" },
      ],
    });
    const open = v.holdings.filter((h) => h.netUnits > 0.0005);
    if (!open.length) {
      blocks.push({ t: "empty", text: "No mutual fund holdings on record." });
    } else {
      open.sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));
      blocks.push({ t: "h2", text: `Holdings (${open.length})` });
      blocks.push(table(
        [
          { h: "Scheme", w: 4.4 }, { h: "Folio", w: 1.6 }, { h: "Units", w: 1.3, right: true }, { h: "NAV", w: 1.3, right: true },
          { h: "Value", w: 1.6, right: true }, { h: "Invested", w: 1.6, right: true }, { h: "Gain", w: 1.5, right: true }, { h: "XIRR", w: 1, right: true },
        ],
        open.map((h) => [
          txt(h.schemeName ?? h.schemeCode),
          (h.folioNumbers?.length ? h.folioNumbers : [h.folioNumber]).filter(Boolean).join(", "),
          num(h.netUnits),
          h.latestNav != null ? num(h.latestNav, 4) : "",
          inr(h.currentValue),
          h.investedNet != null ? inr(h.investedNet) : h.investedEstimate != null ? `~${inr(h.investedEstimate)}` : "",
          inr(h.gain),
          h.xirr != null ? formatPercent(h.xirr * 100) : "",
        ]),
        3,
      ));
      // Where the money sits, by fund house.
      const byAmc = new Map<string, number>();
      for (const h of open) byAmc.set(txt(h.amcName) || "Fund house not recorded", (byAmc.get(txt(h.amcName) || "Fund house not recorded") ?? 0) + (h.currentValue ?? 0));
      if (byAmc.size > 1 && v.currentValue > 0) {
        blocks.push({ t: "h2", text: "By fund house" });
        blocks.push(table(
          [{ h: "Fund house", w: 5 }, { h: "Value", w: 2, right: true }, { h: "Share", w: 1.2, right: true }],
          [...byAmc.entries()].sort((a, b) => b[1] - a[1]).map(([amc, val]) => [amc, inr(val), formatPercent((val / v.currentValue) * 100)]),
        ));
      }
      if (v.unpricedSchemes > 0) blocks.push({ t: "para", muted: true, text: `${v.unpricedSchemes} scheme(s) have no current NAV and are valued at nil.` });
    }
  }

  // ── SIPs ──────────────────────────────────────────────────────────────
  if (on("sips")) {
    const list = await rows(tx, sql`
      SELECT scheme_name, scheme_code, folio_number, amount, frequency, sip_date, start_date, end_date, next_installment_at, status
        FROM sips WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid
       ORDER BY (status = 'active') DESC, start_date DESC NULLS LAST LIMIT 200`);
    blocks.push({ t: "h1", text: "SIPs", note: Number(sipBook?.n) ? `${sipBook.n} active · ${formatMoneyFull(sipBook.amount)}` : undefined });
    blocks.push(list.length
      ? table(
          [{ h: "Scheme", w: 4.2 }, { h: "Folio", w: 1.6 }, { h: "Amount", w: 1.4, right: true }, { h: "Frequency", w: 1.3 }, { h: "Day", w: 0.7 }, { h: "Start", w: 1.4 }, { h: "End", w: 1.4 }, { h: "Next", w: 1.4 }, { h: "Status", w: 1.2 }],
          list.map((s) => [txt(s.scheme_name ?? s.scheme_code), txt(s.folio_number), inr(s.amount), label(s.frequency), txt(s.sip_date), d(s.start_date), d(s.end_date), s.status === "active" ? d(s.next_installment_at) : "", label(s.status)]),
          3,
        )
      : { t: "empty", text: "No SIPs on record." });
  }

  // ── Transactions ──────────────────────────────────────────────────────
  if (on("transactions")) {
    const list = await rows(tx, sql`
      SELECT order_date, scheme_name, scheme_code, folio_number, type, direction, amount, units, nav, status
        FROM transactions WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid
         AND (order_date IS NULL OR order_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 730)
       ORDER BY order_date DESC NULLS LAST, created_at DESC LIMIT 300`);
    blocks.push({ t: "h1", text: "Transactions", note: "Last 24 months" });
    blocks.push(list.length
      ? table(
          [{ h: "Date", w: 1.4 }, { h: "Scheme", w: 4.2 }, { h: "Folio", w: 1.5 }, { h: "Type", w: 1.4 }, { h: "Amount", w: 1.5, right: true }, { h: "Units", w: 1.3, right: true }, { h: "NAV", w: 1.2, right: true }, { h: "Status", w: 1.2 }],
          list.map((t) => [d(t.order_date), txt(t.scheme_name ?? t.scheme_code), txt(t.folio_number), label(t.type), inr(t.amount), num(t.units), num(t.nav, 4), label(t.status)]),
          3,
        )
      : { t: "empty", text: "No transactions in the last 24 months." });
    if (list.length === 300) blocks.push({ t: "para", muted: true, text: "The latest 300 transactions are shown." });
  }

  // ── Fixed deposits ────────────────────────────────────────────────────
  if (on("fds")) {
    const list = await rows(tx, sql`
      SELECT issuer, scheme_name, fd_number, deposit_date, maturity_date, principal, interest_rate, payout,
             maturity_amount, tenure_months, tenure_days, status, nominee_name
        FROM fixed_deposits WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid AND deleted_at IS NULL
       ORDER BY (status = 'active') DESC, maturity_date DESC NULLS LAST`);
    if (list.length || sections.length > 1) {
      blocks.push({ t: "h1", text: "Fixed deposits" });
      blocks.push(list.length
        ? table(
            [{ h: "Issuer / scheme", w: 3.4 }, { h: "FD no.", w: 1.5 }, { h: "Deposited", w: 1.4 }, { h: "Principal", w: 1.5, right: true }, { h: "Rate", w: 0.9, right: true }, { h: "Payout", w: 1.3 }, { h: "Matures", w: 1.4 }, { h: "Maturity value", w: 1.6, right: true }, { h: "Status", w: 1.1 }],
            list.map((f) => [join(f.issuer, f.scheme_name), txt(f.fd_number), d(f.deposit_date), inr(f.principal), f.interest_rate ? `${Number(f.interest_rate)}%` : "", label(f.payout), d(f.maturity_date), inr(f.maturity_amount), label(f.status)]),
          )
        : { t: "empty", text: "No fixed deposits on record." });
    }
  }

  // ── Goals ─────────────────────────────────────────────────────────────
  if (on("goals")) {
    const list = await rows(tx, sql`
      SELECT name, category, target_amount, target_date, current_value, progress_pct, required_monthly_sip, existing_monthly_sip, status
        FROM goals WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid ORDER BY target_date NULLS LAST`);
    blocks.push({ t: "h1", text: "Goals" });
    blocks.push(list.length
      ? table(
          [{ h: "Goal", w: 3 }, { h: "Category", w: 1.5 }, { h: "Target", w: 1.6, right: true }, { h: "By", w: 1.4 }, { h: "Current value", w: 1.6, right: true }, { h: "Progress", w: 1.1, right: true }, { h: "SIP needed / mo", w: 1.6, right: true }, { h: "Status", w: 1.2 }],
          list.map((g) => [txt(g.name), label(g.category), inr(g.target_amount), d(g.target_date), inr(g.current_value), g.progress_pct != null ? formatPercent(Number(g.progress_pct)) : "", inr(g.required_monthly_sip), label(g.status)]),
        )
      : { t: "empty", text: "No goals on record." });
  }

  // ── Insurance ─────────────────────────────────────────────────────────
  if (on("insurance") && caps.insurance) {
    const list = await rows(tx, sql`
      SELECT id, policy_number, insurer, plan_name, policy_type, sum_assured, annual_premium, premium_frequency,
             policy_start_date, risk_cover_start_date, maturity_date, next_premium_due_date, last_premium_date,
             policy_term_years, premium_paying_term_years, lives_covered, nominee_name, nominee_relation, riders,
             details, remarks, lapse_reason, status
        FROM insurance_policies WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid
       ORDER BY (status = ANY(ARRAY['active','claim_filed','claim_settled']::text[])) DESC,
                COALESCE(risk_cover_start_date, policy_start_date) DESC NULLS LAST`);
    blocks.push({ t: "h1", text: "Insurance policies", note: list.length ? `${list.length} on record` : undefined });
    if (!list.length) {
      blocks.push({ t: "empty", text: "No insurance policy on record in the CRM." });
    } else {
      blocks.push(table(
        [{ h: "Policy no.", w: 1.9 }, { h: "Insurer / plan", w: 3.4 }, { h: "Type", w: 1.5 }, { h: "Sum insured", w: 1.6, right: true }, { h: "Premium", w: 1.5, right: true }, { h: "Start", w: 1.4 }, { h: "Renewal / due", w: 1.4 }, { h: "Status", w: 1.2 }],
        list.map((p) => [
          txt(p.policy_number), join(p.insurer, p.plan_name), policyTypeLabel(p.policy_type), inr(p.sum_assured),
          join(inr(p.annual_premium), p.premium_frequency && p.premium_frequency !== "annual" ? label(p.premium_frequency) : ""),
          d(p.risk_cover_start_date ?? p.policy_start_date), d(p.next_premium_due_date ?? p.maturity_date), POLICY_STATUS_LABEL[p.status] ?? label(p.status),
        ]),
        3,
      ));
      // Every policy's full details — in force first, then the ones that ended:
      // the core fields, the line's own fields and its tables (insured members,
      // covers, premium breakdown).
      blocks.push({ t: "h1", text: "Policy details" });
      const detailed = list.slice(0, 100);
      for (const p of detailed) {
        const det = (p.details ?? {}) as Row;
        const live = (STATUS_IN_FORCE as readonly string[]).includes(p.status);
        blocks.push({ t: "h2", text: `${policyTypeLabel(p.policy_type)} · ${join(p.insurer, p.plan_name)} · ${txt(p.policy_number) || "No policy no."}${live ? "" : ` (${POLICY_STATUS_LABEL[p.status] ?? label(p.status)})`}` });
        const items: [string, string][] = [
          ["Status", POLICY_STATUS_LABEL[p.status] ?? label(p.status)],
          ["Sum insured", inr(p.sum_assured)],
          ["Premium", join(inr(p.annual_premium), label(p.premium_frequency))],
          ["Cover from", d(p.risk_cover_start_date ?? p.policy_start_date)],
          ["Renewal / next premium", d(p.next_premium_due_date)],
          ["Last premium paid", d(p.last_premium_date)],
          ["Maturity", d(p.maturity_date)],
          ["Policy term", p.policy_term_years ? `${p.policy_term_years} years` : ""],
          ["Premium paying term", p.premium_paying_term_years ? `${p.premium_paying_term_years} years` : ""],
          ["Lives covered", p.lives_covered ? String(p.lives_covered) : ""],
          ["Nominee", join(p.nominee_name, label(p.nominee_relation))],
          ["Riders", Array.isArray(p.riders) ? p.riders.map((r: any) => (typeof r === "string" ? r : txt(r?.name))).filter(Boolean).join(", ") : ""],
          ...policyDetailLines(p.policy_type, det).map((l) => [plainLabel(l.label), asShown(l.label, l.value)] as [string, string]),
          ["Lapse reason", txt(p.lapse_reason)],
          ["Remarks", txt(p.remarks)],
        ];
        blocks.push({ t: "kv", items });
        for (const tb of policyDetailTables(p.policy_type)) {
          const data = Array.isArray(det[tb.key]) ? (det[tb.key] as Row[]) : [];
          if (!data.length) continue;
          const cols = tb.columns.filter((c) => data.some((r) => cellText(r?.[c.key]).trim()));
          if (!cols.length) continue;
          blocks.push({ t: "para", muted: true, text: tb.label });
          blocks.push(table(
            cols.map((c) => ({ h: plainLabel(c.label), w: c.key === "name" || c.key === "description" ? 3 : 1.5, right: /₹/.test(c.label) })),
            data.map((r) => cols.map((c) => asShown(c.label, cellText(r?.[c.key]).trim()))),
          ));
        }
      }
      if (list.length > detailed.length) blocks.push({ t: "para", muted: true, text: `Details are shown for the latest ${detailed.length} policies; all ${list.length} are in the table above.` });
    }
  }

  // ── Claims ────────────────────────────────────────────────────────────
  if (on("claims") && caps.insurance) {
    const list = await rows(tx, sql`
      SELECT policy_number, insurer, claim_type, claim_mode, claim_status, admission_date, intimation_date,
             submission_date, settlement_date, claimed_amount, settled_amount, comments, details
        FROM insurance_claims WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid
       ORDER BY COALESCE(intimation_date, admission_date) DESC NULLS LAST`);
    blocks.push({ t: "h1", text: "Insurance claims" });
    blocks.push(list.length
      ? table(
          [{ h: "Policy / insurer", w: 2.6 }, { h: "Type", w: 1.4 }, { h: "Admitted", w: 1.3 }, { h: "Intimated", w: 1.3 }, { h: "Claimed", w: 1.4, right: true }, { h: "Settled", w: 1.4, right: true }, { h: "Status", w: 1.3 }, { h: "Details", w: 3.4 }],
          list.map((c) => [
            join(c.policy_number, c.insurer), join(label(c.claim_type), label(c.claim_mode)), d(c.admission_date), d(c.intimation_date),
            inr(c.claimed_amount), inr(c.settled_amount), join(label(c.claim_status), c.settlement_date ? `on ${d(c.settlement_date)}` : ""),
            [...claimDetailLines(c.details).map((l) => `${plainLabel(l.label)}: ${asShown(l.label, l.value)}`), txt(c.comments)].filter(Boolean).join("; "),
          ]),
          8,
        )
      : { t: "empty", text: "No insurance claims on record." });
  }

  // ── Meetings ──────────────────────────────────────────────────────────
  if (on("meetings")) {
    const list = await rows(tx, sql`
      SELECT m.meeting_date, m.subject, m.meeting_type, m.meeting_mode, m.status, m.outcome, m.outcome_notes,
             m.discussion_points, m.meeting_notes, m.action_items, m.attendees, m.next_review_date, u.name AS rm_name
        FROM review_meetings m LEFT JOIN users u ON u.id = m.rm_id
       WHERE m.tenant_id = ${tenantId}::uuid
         AND (m.investor_id = ${id}::uuid OR ${attendeeIs("client", id)})
       ORDER BY m.meeting_date DESC NULLS LAST LIMIT 100`);
    blocks.push({ t: "h1", text: "Meetings", note: list.length ? `${list.length} on record` : undefined });
    blocks.push(list.length
      ? table(
          [{ h: "Date", w: 1.6 }, { h: "Meeting", w: 2.6 }, { h: "Mode", w: 1.1 }, { h: "Status", w: 1.2 }, { h: "With", w: 2.2 }, { h: "Notes & action items", w: 5 }],
          list.map((m) => {
            const att = (Array.isArray(m.attendees) ? m.attendees : []).map((a: any) => txt(a?.name)).filter(Boolean);
            const actions = (Array.isArray(m.action_items) ? m.action_items : []).map((a: any) => `Action: ${txt(a?.title)}${a?.dueAt ? ` (due ${d(a.dueAt)})` : ""}`);
            return [
              dt(m.meeting_date),
              join(m.subject, label(m.meeting_type)),
              label(m.meeting_mode),
              join(label(m.status), label(m.outcome)),
              [txt(m.rm_name), ...att].filter((v, k, xs) => v && xs.indexOf(v) === k).join(", "),
              [txt(m.discussion_points), txt(m.meeting_notes), txt(m.outcome_notes), ...actions, m.next_review_date ? `Next review ${d(m.next_review_date)}` : ""].filter(Boolean).join("\n"),
            ];
          }),
          14,
        )
      : { t: "empty", text: "No meetings on record." });
  }

  // ── Opportunities ─────────────────────────────────────────────────────
  if (on("opportunities")) {
    const list = await rows(tx, sql`
      SELECT o.product, o.status, o.expected_value, o.created_at, o.revisit_on, o.parked_reason, o.won_at, o.lost_at,
             o.lost_reason, o.notes, u.name AS owner
        FROM client_opportunities o LEFT JOIN users u ON u.id = o.owner_id
       WHERE o.tenant_id = ${tenantId}::uuid AND o.investor_id = ${id}::uuid ORDER BY o.created_at DESC`);
    blocks.push({ t: "h1", text: "Opportunities" });
    blocks.push(list.length
      ? table(
          [{ h: "Product", w: 2 }, { h: "Stage", w: 1.6 }, { h: "Expected", w: 1.4, right: true }, { h: "Owner", w: 1.6 }, { h: "Opened", w: 1.3 }, { h: "Outcome / notes", w: 4 }],
          list.map((o) => [
            productLabel(o.product), label(o.status), inr(o.expected_value), txt(o.owner), d(o.created_at),
            [o.won_at ? `Won ${d(o.won_at)}` : "", o.lost_at ? `Lost ${d(o.lost_at)}${o.lost_reason ? `: ${txt(o.lost_reason)}` : ""}` : "",
              o.revisit_on ? `Later — revisit ${d(o.revisit_on)}${o.parked_reason ? ` (${txt(o.parked_reason)})` : ""}` : "", txt(o.notes)].filter(Boolean).join("; "),
          ]),
          6,
        )
      : { t: "empty", text: "No opportunities on record." });
  }

  // ── Calls, visits & notes ─────────────────────────────────────────────
  if (on("activity")) {
    const list = await rows(tx, sql`
      SELECT a.kind, a.direction, a.status, a.subject, a.notes, a.occurred_at, a.duration_sec, a.location_label,
             a.next_followup_at, u.name AS owner
        FROM activities a LEFT JOIN users u ON u.id = a.owner_user_id
       WHERE a.tenant_id = ${tenantId}::uuid AND a.subject_type = 'investor' AND a.subject_id = ${id}::uuid
       ORDER BY a.occurred_at DESC NULLS LAST LIMIT 300`);
    const kind = (k: string, dir: string) =>
      k === "call" ? (dir === "inbound" ? "Incoming call" : "Call") : k === "visit" ? "Visit" : k === "note" ? "Note" : label(k);
    blocks.push({ t: "h1", text: "Calls, visits & notes", note: list.length ? `${list.length} logged` : undefined });
    blocks.push(list.length
      ? table(
          [{ h: "When", w: 1.7 }, { h: "Type", w: 1.2 }, { h: "By", w: 1.5 }, { h: "Details", w: 6 }, { h: "Follow-up", w: 1.4 }],
          list.map((a) => [
            dt(a.occurred_at),
            join(kind(a.kind, a.direction), a.duration_sec ? `${Math.max(1, Math.round(Number(a.duration_sec) / 60))} min` : ""),
            txt(a.owner),
            [txt(a.subject), txt(a.notes), a.location_label ? `At ${txt(a.location_label)}` : "", a.status && a.status !== "completed" ? label(a.status) : ""].filter(Boolean).join("\n"),
            d(a.next_followup_at),
          ]),
          12,
        )
      : { t: "empty", text: "No calls, visits or notes logged." });
  }

  // ── Tasks ─────────────────────────────────────────────────────────────
  if (on("tasks")) {
    const list = await rows(tx, sql`
      SELECT t.title, t.type, t.status, t.priority, t.due_at, t.completed_at, t.created_at, t.remarks, u.name AS assignee
        FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.tenant_id = ${tenantId}::uuid AND t.deleted_at IS NULL
         AND (t.related_investor_id = ${id}::uuid OR (t.subject_type = 'investor' AND t.subject_id = ${id}::uuid))
       ORDER BY (t.status NOT IN ('completed','cancelled','done')) DESC, COALESCE(t.completed_at, t.due_at, t.created_at) DESC
       LIMIT 200`);
    const open = list.filter((t) => !["completed", "cancelled", "done"].includes(t.status)).length;
    blocks.push({ t: "h1", text: "Tasks", note: list.length ? `${open} open · ${list.length - open} closed` : undefined });
    blocks.push(list.length
      ? table(
          [{ h: "Task", w: 4 }, { h: "Assigned to", w: 1.7 }, { h: "Created", w: 1.3 }, { h: "Due", w: 1.3 }, { h: "Status", w: 1.4 }, { h: "Remarks", w: 3 }],
          list.map((t) => [join(t.title, label(t.type)), txt(t.assignee), d(t.created_at), d(t.due_at), join(label(t.status), t.completed_at ? d(t.completed_at) : ""), txt(t.remarks)]),
          5,
        )
      : { t: "empty", text: "No tasks about this client." });
  }

  // ── Service requests ──────────────────────────────────────────────────
  if (on("service")) {
    const list = await rows(tx, sql`
      SELECT ticket_no, type, subject, status, priority, created_at, resolved_at, resolution_notes
        FROM service_requests WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid
       ORDER BY created_at DESC LIMIT 100`);
    blocks.push({ t: "h1", text: "Service requests" });
    blocks.push(list.length
      ? table(
          [{ h: "Ticket", w: 1.4 }, { h: "Type", w: 1.4 }, { h: "Subject", w: 3.6 }, { h: "Opened", w: 1.3 }, { h: "Status", w: 1.3 }, { h: "Resolved", w: 1.3 }, { h: "Resolution", w: 3 }],
          list.map((s) => [txt(s.ticket_no), label(s.type), txt(s.subject), d(s.created_at), join(label(s.status), label(s.priority)), d(s.resolved_at), txt(s.resolution_notes)]),
          5,
        )
      : { t: "empty", text: "No service requests on record." });
  }

  // ── Messages ──────────────────────────────────────────────────────────
  if (on("messages")) {
    const list = await rows(tx, sql`
      SELECT created_at, channel, direction, status,
             COALESCE(payload->>'subject', payload->>'templateName', template_key) AS what
        FROM communications WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${id}::uuid
       ORDER BY created_at DESC LIMIT 100`);
    blocks.push({ t: "h1", text: "Emails & WhatsApp", note: list.length ? "Latest 100" : undefined });
    blocks.push(list.length
      ? table(
          [{ h: "When", w: 1.7 }, { h: "Channel", w: 1.2 }, { h: "In / out", w: 1 }, { h: "Message", w: 5 }, { h: "Status", w: 1.6 }],
          list.map((c) => [dt(c.created_at), label(c.channel), label(c.direction), label(c.what) || "", label(c.status)]),
          3,
        )
      : { t: "empty", text: "No messages on record." });
  }

  // ── Documents ─────────────────────────────────────────────────────────
  if (on("documents") && caps.documents) {
    const list = await rows(tx, sql`
      SELECT name, category, issued_on, expires_on, created_at
        FROM compliance_documents
       WHERE tenant_id = ${tenantId}::uuid AND related_entity_type = 'investor' AND related_entity_id = ${id}::uuid
         AND superseded_by_id IS NULL
       ORDER BY created_at DESC`);
    blocks.push({ t: "h1", text: "Documents on file" });
    blocks.push(list.length
      ? table(
          [{ h: "Document", w: 4 }, { h: "Category", w: 2 }, { h: "Issued", w: 1.3 }, { h: "Expires", w: 1.3 }, { h: "Uploaded", w: 1.3 }],
          list.map((x) => [txt(x.name), label(x.category), d(x.issued_on), d(x.expires_on), d(x.created_at)]),
        )
      : { t: "empty", text: "No documents uploaded." });
  }

  // ── Record gaps ───────────────────────────────────────────────────────
  if (on("gaps")) {
    const c = clientCompleteness(i);
    const extra: string[] = [];
    if (!i.nextReviewAt) extra.push("No review scheduled");
    if (show.risk && i.riskProfile && i.riskProfileProvisional) extra.push("Risk profile is provisional — not confirmed by the client");
    if (show.risk && i.riskProfileExpiresOn && String(i.riskProfileExpiresOn) < new Date().toISOString().slice(0, 10)) extra.push("Risk profile is past its review date");
    blocks.push({ t: "h1", text: "Record gaps", note: `Record ${c.score}% complete` });
    const gaps = [...c.missing.map((m) => `Not on record: ${m.label}`), ...extra];
    blocks.push(gaps.length ? table([{ h: "What to complete", w: 1 }], gaps.map((g) => [g])) : { t: "empty", text: "Nothing missing from the client record." });
  }

  const now = new Date();
  return {
    clientName: i.name,
    subtitles: [
      i.name,
      opts.clientCopy ? "Client copy" : "Complete client record",
      `As on ${formatDate(now, "dateTime")}`,
    ],
    blocks,
    pii: { pan: show.pan, dob: show.dob && !!i.dob, address: show.address && !!i.address, phone: show.phone, email: show.email, bank: show.bank },
  };
}
