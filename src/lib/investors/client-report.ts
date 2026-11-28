/**
 * The consolidated client and FAMILY reports — the DATA side (2026-11-25,
 * Investment Options, flag `clientReportPdf`). Loads everything the CRM holds
 * about one client, or about every member of a family, and turns it into the
 * blocks client-report-pdf.ts lays out. SERVER-ONLY.
 *
 * One engine for both: every section takes the list of members. A family
 * report adds a "Member" column to each table and one profile per member;
 * a client report is the same engine with one member and no such column.
 *
 * Rules it keeps (CLAUDE.md):
 *   - a client is loaded through the viewer's scope (loadViewableInvestor);
 *     a family through the family rule (loadViewableFamily) — the family page
 *     shows every member, and so does its report;
 *   - field-level licence gates (PAN, phone, AUM …) apply as on the client page;
 *   - insurance needs an insurance capability, documents `document.view`;
 *   - a task reaches the client through EITHER link (related_investor_id or
 *     subject investor);
 *   - a blank field is "Not on record", never a fact about the client.
 */

import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import type { LicenseState } from "@/lib/auth/license";
import { investors } from "@/db/schema";
import { investorScopeCondition, loadViewableInvestor } from "@/lib/investors/access";
import { loadViewableFamily } from "@/lib/families/access";
import { valueInvestor, type InvestorValuation } from "@/lib/finance/valuation";
import { clientCompleteness } from "@/lib/investors/completeness";
import { canNominate, clientTypeLabel, type ClientTypeDetails } from "@/lib/investors/client-types";
import { policyTypeLabel, POLICY_STATUS_LABEL, STATUS_IN_FORCE } from "@/lib/insurance/book";
import { cellText, claimDetailLines, policyDetailLines, policyDetailTables } from "@/lib/insurance/extra-fields";
import { productLabel } from "@/lib/opportunities/products";
import { attendeeIs } from "@/lib/review-meetings/attendees";
import { formatDate, formatMoney, formatMoneyFull, formatPercent, humanise } from "@/lib/format";
import type { ReportBlock, ReportColumn } from "./client-report-pdf";
import { NO_POLICY_TYPE, type ClientReportSection, type PolicyFilter } from "./client-report-sections";

type Row = Record<string, any>;

const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)).rows as Row[];
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
const LIVE_POLICY = sql`ARRAY['active','claim_filed','claim_settled']::text[]`;

function table(cols: ReportColumn[], data: string[][], maxLines?: number): ReportBlock {
  return { t: "table", cols, rows: data, maxLines };
}

type Show = Record<"pan" | "dob" | "phone" | "email" | "address" | "aum" | "sip" | "kyc" | "risk" | "nominee" | "bank" | "rm", boolean>;
type Member = { id: string; inv: Row; role: string };

/** What every section needs: who, what may be printed, and how to scope SQL. */
type Ctx = {
  tx: Tx;
  tenantId: string;
  show: Show;
  caps: { insurance: boolean; documents: boolean };
  members: Member[];
  /** A family report: a Member column on every table. */
  multi: boolean;
  familyId: string | null;
  /** `(id1, id2, …)` for `investor_id IN …`. */
  idList: SQL;
  nameOf: (investorId: unknown) => string;
  valuations: Map<string, InvestorValuation>;
  /** The insurance section's status / type choice (null = every policy). */
  policyFilter: PolicyFilter | null;
};

/** The Member column, first in each table of a family report. */
const withMember = (c: Ctx, cols: ReportColumn[]): ReportColumn[] => (c.multi ? [{ h: "Member", w: 1.8 }, ...cols] : cols);
const withName = (c: Ctx, investorId: unknown, cells: string[]): string[] => (c.multi ? [c.nameOf(investorId), ...cells] : cells);

function showFor(license: LicenseState | null): Show {
  const allow = (f: string) => isFieldAllowed(license, "investor", f);
  return {
    pan: allow("pan"), dob: allow("dob"), phone: allow("phone"), email: allow("email"),
    address: allow("address") || allow("city"), aum: allow("aum"),
    sip: allow("active_sip_amount") || allow("sip"), kyc: allow("kyc_status") || allow("kyc"),
    risk: allow("risk_profile") || allow("risk"), nominee: allow("nominee_name") || allow("nominee"),
    bank: allow("bank_account_number_masked") || allow("bank"), rm: allow("rm_id") || allow("rm"),
  };
}

function capsFor(session: SessionUser) {
  return {
    insurance: (["insurance.view", "insurance.view.all", "insurance.write"] as const).some((c) => can(session.roles, c, session.permissions)),
    documents: can(session.roles, "document.view", session.permissions),
  };
}

async function makeCtx(
  tx: Tx,
  session: SessionUser,
  license: LicenseState | null,
  members: Member[],
  familyId: string | null,
  multi: boolean,
  needValuation: boolean,
): Promise<Ctx> {
  const show = showFor(license);
  const names = new Map(members.map((m) => [m.id, txt(m.inv.name)]));
  const valuations = new Map<string, InvestorValuation>();
  if (needValuation && show.aum) for (const m of members) valuations.set(m.id, await valueInvestor(tx, m.id));
  return {
    tx,
    tenantId: session.tenantId,
    show,
    caps: capsFor(session),
    members,
    multi,
    familyId,
    idList: sql.join(members.map((m) => sql`${m.id}::uuid`), sql`, `),
    nameOf: (id) => (id ? names.get(String(id)) ?? "" : "Family"),
    valuations,
    policyFilter: null,
  };
}

const openHoldings = (v: InvestorValuation | undefined) => (v ? v.holdings.filter((h) => h.netUnits > 0.0005) : []);

/** Headline totals over the members: active SIPs, insurance in force, live FDs. */
async function totals(c: Ctx) {
  const [ins] = c.caps.insurance
    ? await rows(c.tx, sql`
        SELECT count(*) FILTER (WHERE status = ANY(${LIVE_POLICY}))::int AS live,
               COALESCE(sum(annual_premium::numeric) FILTER (WHERE status = ANY(${LIVE_POLICY})), 0) AS premium,
               COALESCE(sum(sum_assured::numeric) FILTER (WHERE status = ANY(${LIVE_POLICY})), 0) AS cover
          FROM insurance_policies WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})`)
    : [];
  const [fd] = await rows(c.tx, sql`
    SELECT count(*)::int AS n, COALESCE(sum(principal::numeric), 0) AS principal
      FROM fixed_deposits WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})
       AND deleted_at IS NULL AND status = 'active'`);
  const [sip] = await rows(c.tx, sql`
    SELECT count(*)::int AS n, COALESCE(sum(amount::numeric), 0) AS amount
      FROM sips WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList}) AND status = 'active'`);
  return { ins, fd, sip };
}

function headlineStats(c: Ctx, t: Awaited<ReturnType<typeof totals>>) {
  const stats: { label: string; value: string; sub?: string }[] = [];
  const vals = [...c.valuations.values()];
  const held = vals.some((v) => openHoldings(v).length > 0);
  if (c.show.aum && vals.length && !held) {
    stats.push({ label: "Mutual funds", value: "No holdings", sub: "None on record in the CRM" });
  } else if (c.show.aum && vals.length) {
    const value = vals.reduce((s, v) => s + v.currentValue, 0);
    const asOf = vals.map((v) => v.asOf).filter(Boolean).sort().pop();
    stats.push({ label: "Mutual fund value", value: formatMoney(value), sub: asOf ? `NAV as on ${formatDate(asOf)}` : undefined });
    const gains = vals.filter((v) => openHoldings(v).length > 0 || v.gain != null);
    if (gains.length && gains.every((v) => v.gain != null)) {
      stats.push({ label: "Gain", value: formatMoney(gains.reduce((s, v) => s + (v.gain ?? 0), 0)), sub: !c.multi && vals[0].absoluteReturn != null ? `${formatPercent(vals[0].absoluteReturn * 100)} absolute` : undefined });
    }
    if (!c.multi) {
      const v = vals[0];
      stats.push({ label: "XIRR", value: v.xirr != null ? formatPercent(v.xirr * 100) : v.xirrPartial != null ? `~${formatPercent(v.xirrPartial * 100)}` : "Not known", sub: v.xirr == null && v.xirrPartial == null ? "Needs the transaction history" : "Annualised" });
    }
  }
  if (c.show.sip) stats.push({ label: "Active SIPs", value: Number(t.sip?.n) ? formatMoney(t.sip.amount) : "None", sub: Number(t.sip?.n) ? `${t.sip.n} SIP${t.sip.n === 1 ? "" : "s"} a month` : undefined });
  if (t.ins) stats.push({ label: "Insurance in force", value: Number(t.ins.live) ? `${t.ins.live} polic${t.ins.live === 1 ? "y" : "ies"}` : "None on record", sub: Number(t.ins.live) ? `Cover ${formatMoney(t.ins.cover)} · premium ${formatMoney(t.ins.premium)}/yr` : undefined });
  if (Number(t.fd?.n)) stats.push({ label: "Fixed deposits", value: formatMoney(t.fd.principal), sub: `${t.fd.n} live FD${t.fd.n === 1 ? "" : "s"}` });
  return stats;
}

// ── Sections ────────────────────────────────────────────────────────────

function profileOf(c: Ctx, i: Row, blocks: ReportBlock[], sub: "h2" | "h3") {
  const { show } = c;
  const a = (i.address ?? {}) as Row;
  const td = (i.typeDetails ?? {}) as ClientTypeDetails;
  blocks.push({ t: sub, text: "Personal & contact" });
  blocks.push({
    t: "kv",
    items: [
      ...(c.multi ? ([["Client type", clientTypeLabel(i.investorCategory)], ["PAN", show.pan ? txt(i.pan).replace(/^NOPAN:.*/, "") : ""], ["Status", label(i.status)]] as [string, string][]) : []),
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
  if (td.coparceners?.length) typeItems.push(["Coparceners", td.coparceners.map((x) => join(x.name, x.relation)).join("; ")]);
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
    blocks.push({ t: sub, text: `${clientTypeLabel(i.investorCategory)} details` });
    blocks.push({ t: "kv", items: typeItems });
  }
  if (show.kyc) {
    blocks.push({ t: sub, text: "KYC & compliance" });
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
    blocks.push({ t: sub, text: "Risk profile" });
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
    blocks.push({ t: sub, text: "Bank accounts" });
    blocks.push(banks.length
      ? table([{ h: "Bank", w: 3 }, { h: "Account", w: 2 }, { h: "IFSC", w: 2 }, { h: "Type", w: 1.5 }],
          banks.map((b) => [txt(b.bankName), txt(b.accountMasked), txt(b.ifsc), label(b.accountType)]))
      : { t: "empty", text: "No bank account on record." });
  }
  if (show.nominee && canNominate(i.investorCategory)) {
    const noms = (Array.isArray(i.nominees) && i.nominees.length
      ? i.nominees
      : i.nomineeName ? [{ name: i.nomineeName, relation: i.nomineeRelation, dob: i.nomineeDob }] : []) as Row[];
    blocks.push({ t: sub, text: "Nominees" });
    blocks.push(noms.length
      ? table([{ h: "Nominee", w: 3 }, { h: "Relation", w: 1.6 }, { h: "Date of birth", w: 1.6 }, { h: "Mobile", w: 1.8 }, { h: "Share", w: 1, right: true }],
          noms.map((n) => [txt(n.name), label(n.relation), show.dob ? d(n.dob) : "", show.phone ? txt(n.mobile) : "", n.sharePct != null ? `${n.sharePct}%` : ""]))
      : { t: "empty", text: td.nominationOptOut ? "Opted out of nomination." : "No nominee on record." });
  }
}

function profileSection(c: Ctx, blocks: ReportBlock[]) {
  if (!c.multi) {
    blocks.push({ t: "h1", text: "Profile & KYC" });
    profileOf(c, c.members[0].inv, blocks, "h2");
    return;
  }
  blocks.push({ t: "h1", text: "Members — profile & KYC", note: `${c.members.length} member${c.members.length === 1 ? "" : "s"}` });
  for (const m of c.members) {
    blocks.push({ t: "h2", text: join(m.inv.name, m.role) });
    profileOf(c, m.inv, blocks, "h3");
  }
}

function portfolioSection(c: Ctx, blocks: ReportBlock[]) {
  if (!c.show.aum || !c.valuations.size) return;
  const vals = [...c.valuations.entries()];
  const asOf = vals.map(([, v]) => v.asOf).filter(Boolean).sort().pop();
  blocks.push({ t: "h1", text: "Mutual fund portfolio", note: asOf ? `NAV as on ${formatDate(asOf)}` : undefined });
  const open = vals.flatMap(([id, v]) => openHoldings(v).map((h) => ({ id, h })));
  if (!open.length) {
    blocks.push({ t: "empty", text: "No mutual fund holdings on record." });
    return;
  }
  const value = vals.reduce((s, [, v]) => s + v.currentValue, 0);
  if (!c.multi) {
    const v = vals[0][1];
    blocks.push({
      t: "stats",
      items: [
        { label: "Current value", value: formatMoneyFull(v.currentValue) },
        { label: "Invested (net)", value: v.investedNet != null ? formatMoneyFull(v.investedNet) : v.investedEstimate != null ? `~${formatMoneyFull(v.investedEstimate)}` : "Not known" },
        { label: "Gain", value: v.gain != null ? formatMoneyFull(v.gain) : "Not known", sub: v.absoluteReturn != null ? `${formatPercent(v.absoluteReturn * 100)} absolute` : undefined },
        { label: "XIRR", value: v.xirr != null ? formatPercent(v.xirr * 100) : v.xirrPartial != null ? `~${formatPercent(v.xirrPartial * 100)}` : "Not known" },
      ],
    });
  } else {
    // Each member's own figures — an XIRR is per person, never summed.
    blocks.push({ t: "h2", text: "By member" });
    blocks.push(table(
      [{ h: "Member", w: 3 }, { h: "Value", w: 1.7, right: true }, { h: "Invested (net)", w: 1.7, right: true }, { h: "Gain", w: 1.6, right: true }, { h: "XIRR", w: 1, right: true }, { h: "Share", w: 1, right: true }],
      vals.filter(([, v]) => openHoldings(v).length > 0).sort((a, b) => b[1].currentValue - a[1].currentValue).map(([id, v]) => [
        c.nameOf(id),
        inr(v.currentValue),
        v.investedNet != null ? inr(v.investedNet) : v.investedEstimate != null ? `~${inr(v.investedEstimate)}` : "",
        inr(v.gain),
        v.xirr != null ? formatPercent(v.xirr * 100) : v.xirrPartial != null ? `~${formatPercent(v.xirrPartial * 100)}` : "",
        value > 0 ? formatPercent((v.currentValue / value) * 100) : "",
      ]),
    ));
  }
  open.sort((a, b) => (b.h.currentValue ?? 0) - (a.h.currentValue ?? 0));
  blocks.push({ t: "h2", text: `Holdings (${open.length})` });
  blocks.push(table(
    withMember(c, [
      { h: "Scheme", w: 4.4 }, { h: "Folio", w: 1.6 }, { h: "Units", w: 1.3, right: true }, { h: "NAV", w: 1.3, right: true },
      { h: "Value", w: 1.6, right: true }, { h: "Invested", w: 1.6, right: true }, { h: "Gain", w: 1.5, right: true }, { h: "XIRR", w: 1, right: true },
    ]),
    open.map(({ id, h }) => withName(c, id, [
      txt(h.schemeName ?? h.schemeCode),
      (h.folioNumbers?.length ? h.folioNumbers : [h.folioNumber]).filter(Boolean).join(", "),
      num(h.netUnits),
      h.latestNav != null ? num(h.latestNav, 4) : "",
      inr(h.currentValue),
      h.investedNet != null ? inr(h.investedNet) : h.investedEstimate != null ? `~${inr(h.investedEstimate)}` : "",
      inr(h.gain),
      h.xirr != null ? formatPercent(h.xirr * 100) : "",
    ])),
    3,
  ));
  // Where the money sits, by fund house.
  const byAmc = new Map<string, number>();
  for (const { h } of open) {
    const k = txt(h.amcName) || "Fund house not recorded";
    byAmc.set(k, (byAmc.get(k) ?? 0) + (h.currentValue ?? 0));
  }
  if (byAmc.size > 1 && value > 0) {
    blocks.push({ t: "h2", text: "By fund house" });
    blocks.push(table(
      [{ h: "Fund house", w: 5 }, { h: "Value", w: 2, right: true }, { h: "Share", w: 1.2, right: true }],
      [...byAmc.entries()].sort((a, b) => b[1] - a[1]).map(([amc, val]) => [amc, inr(val), formatPercent((val / value) * 100)]),
    ));
  }
  const unpriced = vals.reduce((s, [, v]) => s + v.unpricedSchemes, 0);
  if (unpriced > 0) blocks.push({ t: "para", muted: true, text: `${unpriced} scheme(s) have no current NAV and are valued at nil.` });
}

async function sipsSection(c: Ctx, blocks: ReportBlock[], t: Awaited<ReturnType<typeof totals>>) {
  const list = await rows(c.tx, sql`
    SELECT investor_id, scheme_name, scheme_code, folio_number, amount, frequency, sip_date, start_date, end_date, next_installment_at, status
      FROM sips WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})
     ORDER BY (status = 'active') DESC, start_date DESC NULLS LAST LIMIT 400`);
  blocks.push({ t: "h1", text: "SIPs", note: Number(t.sip?.n) ? `${t.sip.n} active · ${formatMoneyFull(t.sip.amount)}` : undefined });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Scheme", w: 4.2 }, { h: "Folio", w: 1.6 }, { h: "Amount", w: 1.4, right: true }, { h: "Frequency", w: 1.3 }, { h: "Day", w: 0.7 }, { h: "Start", w: 1.4 }, { h: "End", w: 1.4 }, { h: "Next", w: 1.4 }, { h: "Status", w: 1.2 }]),
        list.map((s) => withName(c, s.investor_id, [txt(s.scheme_name ?? s.scheme_code), txt(s.folio_number), inr(s.amount), label(s.frequency), txt(s.sip_date), d(s.start_date), d(s.end_date), s.status === "active" ? d(s.next_installment_at) : "", label(s.status)])),
        3,
      )
    : { t: "empty", text: "No SIPs on record." });
}

async function transactionsSection(c: Ctx, blocks: ReportBlock[]) {
  const cap = c.multi ? 500 : 300;
  const list = await rows(c.tx, sql`
    SELECT investor_id, order_date, scheme_name, scheme_code, folio_number, type, amount, units, nav, status
      FROM transactions WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})
       AND (order_date IS NULL OR order_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 730)
     ORDER BY order_date DESC NULLS LAST, created_at DESC LIMIT ${cap}`);
  blocks.push({ t: "h1", text: "Transactions", note: "Last 24 months" });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Date", w: 1.4 }, { h: "Scheme", w: 4.2 }, { h: "Folio", w: 1.5 }, { h: "Type", w: 1.4 }, { h: "Amount", w: 1.5, right: true }, { h: "Units", w: 1.3, right: true }, { h: "NAV", w: 1.2, right: true }, { h: "Status", w: 1.2 }]),
        list.map((x) => withName(c, x.investor_id, [d(x.order_date), txt(x.scheme_name ?? x.scheme_code), txt(x.folio_number), label(x.type), inr(x.amount), num(x.units), num(x.nav, 4), label(x.status)])),
        3,
      )
    : { t: "empty", text: "No transactions in the last 24 months." });
  if (list.length === cap) blocks.push({ t: "para", muted: true, text: `The latest ${cap} transactions are shown.` });
}

async function fdsSection(c: Ctx, blocks: ReportBlock[]) {
  const list = await rows(c.tx, sql`
    SELECT investor_id, issuer, scheme_name, fd_number, deposit_date, maturity_date, principal, interest_rate, payout, maturity_amount, status
      FROM fixed_deposits WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList}) AND deleted_at IS NULL
     ORDER BY (status = 'active') DESC, maturity_date DESC NULLS LAST`);
  blocks.push({ t: "h1", text: "Fixed deposits" });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Issuer / scheme", w: 3.4 }, { h: "FD no.", w: 1.5 }, { h: "Deposited", w: 1.4 }, { h: "Principal", w: 1.5, right: true }, { h: "Rate", w: 0.9, right: true }, { h: "Payout", w: 1.3 }, { h: "Matures", w: 1.4 }, { h: "Maturity value", w: 1.6, right: true }, { h: "Status", w: 1.1 }]),
        list.map((f) => withName(c, f.investor_id, [join(f.issuer, f.scheme_name), txt(f.fd_number), d(f.deposit_date), inr(f.principal), f.interest_rate ? `${Number(f.interest_rate)}%` : "", label(f.payout), d(f.maturity_date), inr(f.maturity_amount), label(f.status)])),
      )
    : { t: "empty", text: "No fixed deposits on record." });
}

async function goalsSection(c: Ctx, blocks: ReportBlock[]) {
  const list = await rows(c.tx, sql`
    SELECT investor_id, name, category, target_amount, target_date, current_value, progress_pct, required_monthly_sip, status
      FROM goals WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList}) ORDER BY target_date NULLS LAST`);
  blocks.push({ t: "h1", text: "Goals" });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Goal", w: 3 }, { h: "Category", w: 1.5 }, { h: "Target", w: 1.6, right: true }, { h: "By", w: 1.4 }, { h: "Current value", w: 1.6, right: true }, { h: "Progress", w: 1.1, right: true }, { h: "SIP needed / mo", w: 1.6, right: true }, { h: "Status", w: 1.2 }]),
        list.map((g) => withName(c, g.investor_id, [txt(g.name), label(g.category), inr(g.target_amount), d(g.target_date), inr(g.current_value), g.progress_pct != null ? formatPercent(Number(g.progress_pct)) : "", inr(g.required_monthly_sip), label(g.status)])),
      )
    : { t: "empty", text: "No goals on record." });
}

/** SQL for the status / type choice; and the words that say what was chosen. */
function policyFilterSql(f: PolicyFilter | null): SQL {
  const parts: SQL[] = [];
  if (f?.statuses?.length) parts.push(sql`status IN (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`);
  if (f?.types?.length) {
    const real = f.types.filter((t) => t !== NO_POLICY_TYPE);
    const none = f.types.includes(NO_POLICY_TYPE);
    const inReal = real.length ? sql`policy_type IN (${sql.join(real.map((t) => sql`${t}`), sql`, `)})` : sql`FALSE`;
    parts.push(none ? sql`(${inReal} OR policy_type IS NULL OR policy_type = '')` : inReal);
  }
  return parts.length ? sql` AND ${sql.join(parts, sql` AND `)}` : sql``;
}

function policyFilterNote(f: PolicyFilter | null): string {
  const bits: string[] = [];
  if (f?.statuses?.length) bits.push(f.statuses.map((s) => POLICY_STATUS_LABEL[s] ?? label(s)).join(", "));
  if (f?.types?.length) bits.push(f.types.map((t) => (t === NO_POLICY_TYPE ? "Type not recorded" : policyTypeLabel(t))).join(", "));
  return bits.join(" · ");
}

async function insuranceSection(c: Ctx, blocks: ReportBlock[]) {
  const filtered = !!(c.policyFilter?.statuses?.length || c.policyFilter?.types?.length);
  const list = await rows(c.tx, sql`
    SELECT investor_id, policy_number, insurer, plan_name, policy_type, sum_assured, annual_premium, premium_frequency,
           policy_start_date, risk_cover_start_date, maturity_date, next_premium_due_date, last_premium_date,
           policy_term_years, premium_paying_term_years, lives_covered, nominee_name, nominee_relation, riders,
           details, remarks, lapse_reason, status
      FROM insurance_policies WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})${policyFilterSql(c.policyFilter)}
     ORDER BY (status = ANY(${LIVE_POLICY})) DESC, COALESCE(risk_cover_start_date, policy_start_date) DESC NULLS LAST`);
  blocks.push({ t: "h1", text: "Insurance policies", note: list.length ? `${list.length} ${filtered ? "selected" : "on record"}` : undefined });
  if (filtered) blocks.push({ t: "para", muted: true, text: `Showing: ${policyFilterNote(c.policyFilter)}` });
  if (!list.length) {
    blocks.push({ t: "empty", text: filtered ? "No policy matches the statuses and types chosen." : "No insurance policy on record in the CRM." });
    return;
  }
  blocks.push(table(
    withMember(c, [{ h: "Policy no.", w: 1.9 }, { h: "Insurer / plan", w: 3.4 }, { h: "Type", w: 1.5 }, { h: "Sum insured", w: 1.6, right: true }, { h: "Premium", w: 1.5, right: true }, { h: "Start", w: 1.4 }, { h: "Renewal / due", w: 1.4 }, { h: "Status", w: 1.2 }]),
    list.map((p) => withName(c, p.investor_id, [
      txt(p.policy_number), join(p.insurer, p.plan_name), policyTypeLabel(p.policy_type), inr(p.sum_assured),
      join(inr(p.annual_premium), p.premium_frequency && p.premium_frequency !== "annual" ? label(p.premium_frequency) : ""),
      d(p.risk_cover_start_date ?? p.policy_start_date), d(p.next_premium_due_date ?? p.maturity_date), POLICY_STATUS_LABEL[p.status] ?? label(p.status),
    ])),
    3,
  ));
  // Every policy's full details — in force first, then the ones that ended:
  // the core fields, the line's own fields and its tables (insured members,
  // covers, premium breakdown).
  blocks.push({ t: "h1", text: "Policy details" });
  const detailed = list.slice(0, c.multi ? 150 : 100);
  for (const p of detailed) {
    const det = (p.details ?? {}) as Row;
    const live = (STATUS_IN_FORCE as readonly string[]).includes(p.status);
    blocks.push({ t: "h2", text: `${c.multi ? `${c.nameOf(p.investor_id)} · ` : ""}${policyTypeLabel(p.policy_type)} · ${join(p.insurer, p.plan_name)} · ${txt(p.policy_number) || "No policy no."}${live ? "" : ` (${POLICY_STATUS_LABEL[p.status] ?? label(p.status)})`}` });
    blocks.push({
      t: "kv",
      items: [
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
        ["Riders", Array.isArray(p.riders) ? p.riders.map((r: unknown) => (typeof r === "string" ? r : txt((r as Row | null)?.name))).filter(Boolean).join(", ") : ""],
        ...policyDetailLines(p.policy_type, det).map((l) => [plainLabel(l.label), asShown(l.label, l.value)] as [string, string]),
        ["Lapse reason", txt(p.lapse_reason)],
        ["Remarks", txt(p.remarks)],
      ],
    });
    for (const tb of policyDetailTables(p.policy_type)) {
      const data = Array.isArray(det[tb.key]) ? (det[tb.key] as Row[]) : [];
      if (!data.length) continue;
      const cols = tb.columns.filter((col) => data.some((r) => cellText(r?.[col.key]).trim()));
      if (!cols.length) continue;
      blocks.push({ t: "para", muted: true, text: tb.label });
      blocks.push(table(
        cols.map((col) => ({ h: plainLabel(col.label), w: col.key === "name" || col.key === "description" ? 3 : 1.5, right: /₹/.test(col.label) })),
        data.map((r) => cols.map((col) => asShown(col.label, cellText(r?.[col.key]).trim()))),
      ));
    }
  }
  if (list.length > detailed.length) blocks.push({ t: "para", muted: true, text: `Details are shown for the latest ${detailed.length} policies; all ${list.length} are in the table above.` });
}

async function claimsSection(c: Ctx, blocks: ReportBlock[]) {
  const list = await rows(c.tx, sql`
    SELECT investor_id, policy_number, insurer, claim_type, claim_mode, claim_status, admission_date, intimation_date,
           settlement_date, claimed_amount, settled_amount, comments, details
      FROM insurance_claims WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})
     ORDER BY COALESCE(intimation_date, admission_date) DESC NULLS LAST`);
  blocks.push({ t: "h1", text: "Insurance claims" });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Policy / insurer", w: 2.6 }, { h: "Type", w: 1.4 }, { h: "Admitted", w: 1.3 }, { h: "Intimated", w: 1.3 }, { h: "Claimed", w: 1.4, right: true }, { h: "Settled", w: 1.4, right: true }, { h: "Status", w: 1.3 }, { h: "Details", w: 3.4 }]),
        list.map((x) => withName(c, x.investor_id, [
          join(x.policy_number, x.insurer), join(label(x.claim_type), label(x.claim_mode)), d(x.admission_date), d(x.intimation_date),
          inr(x.claimed_amount), inr(x.settled_amount), join(label(x.claim_status), x.settlement_date ? `on ${d(x.settlement_date)}` : ""),
          [...claimDetailLines(x.details).map((l) => `${plainLabel(l.label)}: ${asShown(l.label, l.value)}`), txt(x.comments)].filter(Boolean).join("; "),
        ])),
        8,
      )
    : { t: "empty", text: "No insurance claims on record." });
}

async function meetingsSection(c: Ctx, blocks: ReportBlock[]) {
  const anyMember = sql.join(c.members.map((m) => attendeeIs("client", m.id)), sql` OR `);
  const family = c.familyId ? sql` OR m.family_id = ${c.familyId}::uuid` : sql``;
  const list = await rows(c.tx, sql`
    SELECT m.investor_id, m.meeting_date, m.subject, m.meeting_type, m.meeting_mode, m.status, m.outcome, m.outcome_notes,
           m.discussion_points, m.meeting_notes, m.action_items, m.attendees, m.next_review_date, u.name AS rm_name
      FROM review_meetings m LEFT JOIN users u ON u.id = m.rm_id
     WHERE m.tenant_id = ${c.tenantId}::uuid
       AND (m.investor_id IN (${c.idList}) OR ${anyMember}${family})
     ORDER BY m.meeting_date DESC NULLS LAST LIMIT 150`);
  blocks.push({ t: "h1", text: "Meetings", note: list.length ? `${list.length} on record` : undefined });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Date", w: 1.6 }, { h: "Meeting", w: 2.6 }, { h: "Mode", w: 1.1 }, { h: "Status", w: 1.2 }, { h: "With", w: 2.2 }, { h: "Notes & action items", w: 5 }]),
        list.map((m) => {
          const att = (Array.isArray(m.attendees) ? m.attendees : []).map((a: Row) => txt(a?.name)).filter(Boolean);
          const actions = (Array.isArray(m.action_items) ? m.action_items : []).map((a: Row) => `Action: ${txt(a?.title)}${a?.dueAt ? ` (due ${d(a.dueAt)})` : ""}`);
          return withName(c, m.investor_id, [
            dt(m.meeting_date),
            join(m.subject, label(m.meeting_type)),
            label(m.meeting_mode),
            join(label(m.status), label(m.outcome)),
            [txt(m.rm_name), ...att].filter((v, k, xs) => v && xs.indexOf(v) === k).join(", "),
            [txt(m.discussion_points), txt(m.meeting_notes), txt(m.outcome_notes), ...actions, m.next_review_date ? `Next review ${d(m.next_review_date)}` : ""].filter(Boolean).join("\n"),
          ]);
        }),
        14,
      )
    : { t: "empty", text: "No meetings on record." });
}

async function opportunitiesSection(c: Ctx, blocks: ReportBlock[]) {
  const list = await rows(c.tx, sql`
    SELECT o.investor_id, o.product, o.status, o.expected_value, o.created_at, o.revisit_on, o.parked_reason, o.won_at, o.lost_at,
           o.lost_reason, o.notes, u.name AS owner
      FROM client_opportunities o LEFT JOIN users u ON u.id = o.owner_id
     WHERE o.tenant_id = ${c.tenantId}::uuid AND o.investor_id IN (${c.idList}) ORDER BY o.created_at DESC`);
  blocks.push({ t: "h1", text: "Opportunities" });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Product", w: 2 }, { h: "Stage", w: 1.6 }, { h: "Expected", w: 1.4, right: true }, { h: "Owner", w: 1.6 }, { h: "Opened", w: 1.3 }, { h: "Outcome / notes", w: 4 }]),
        list.map((o) => withName(c, o.investor_id, [
          productLabel(o.product), label(o.status), inr(o.expected_value), txt(o.owner), d(o.created_at),
          [o.won_at ? `Won ${d(o.won_at)}` : "", o.lost_at ? `Lost ${d(o.lost_at)}${o.lost_reason ? `: ${txt(o.lost_reason)}` : ""}` : "",
            o.revisit_on ? `Later — revisit ${d(o.revisit_on)}${o.parked_reason ? ` (${txt(o.parked_reason)})` : ""}` : "", txt(o.notes)].filter(Boolean).join("; "),
        ])),
        6,
      )
    : { t: "empty", text: "No opportunities on record." });
}

async function activitySection(c: Ctx, blocks: ReportBlock[]) {
  const family = c.familyId ? sql` OR (a.subject_type = 'family' AND a.subject_id = ${c.familyId}::uuid)` : sql``;
  const list = await rows(c.tx, sql`
    SELECT CASE WHEN a.subject_type = 'investor' THEN a.subject_id END AS investor_id,
           a.kind, a.direction, a.status, a.subject, a.notes, a.occurred_at, a.duration_sec, a.location_label,
           a.next_followup_at, u.name AS owner
      FROM activities a LEFT JOIN users u ON u.id = a.owner_user_id
     WHERE a.tenant_id = ${c.tenantId}::uuid
       AND ((a.subject_type = 'investor' AND a.subject_id IN (${c.idList}))${family})
     ORDER BY a.occurred_at DESC NULLS LAST LIMIT 400`);
  const kind = (k: string, dir: string) =>
    k === "call" ? (dir === "inbound" ? "Incoming call" : "Call") : k === "visit" ? "Visit" : k === "note" ? "Note" : label(k);
  blocks.push({ t: "h1", text: "Calls, visits & notes", note: list.length ? `${list.length} logged` : undefined });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "When", w: 1.7 }, { h: "Type", w: 1.2 }, { h: "By", w: 1.5 }, { h: "Details", w: 6 }, { h: "Follow-up", w: 1.4 }]),
        list.map((a) => withName(c, a.investor_id, [
          dt(a.occurred_at),
          join(kind(a.kind, a.direction), a.duration_sec ? `${Math.max(1, Math.round(Number(a.duration_sec) / 60))} min` : ""),
          txt(a.owner),
          [txt(a.subject), txt(a.notes), a.location_label ? `At ${txt(a.location_label)}` : "", a.status && a.status !== "completed" ? label(a.status) : ""].filter(Boolean).join("\n"),
          d(a.next_followup_at),
        ])),
        12,
      )
    : { t: "empty", text: "No calls, visits or notes logged." });
}

async function tasksSection(c: Ctx, blocks: ReportBlock[]) {
  const list = await rows(c.tx, sql`
    SELECT COALESCE(t.related_investor_id, CASE WHEN t.subject_type = 'investor' THEN t.subject_id END) AS investor_id,
           t.title, t.type, t.status, t.due_at, t.completed_at, t.created_at, t.remarks, u.name AS assignee
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.tenant_id = ${c.tenantId}::uuid AND t.deleted_at IS NULL
       AND (t.related_investor_id IN (${c.idList}) OR (t.subject_type = 'investor' AND t.subject_id IN (${c.idList})))
     ORDER BY (t.status NOT IN ('completed','cancelled','done')) DESC, COALESCE(t.completed_at, t.due_at, t.created_at) DESC
     LIMIT ${c.multi ? 300 : 200}`);
  const open = list.filter((x) => !["completed", "cancelled", "done"].includes(x.status)).length;
  blocks.push({ t: "h1", text: "Tasks", note: list.length ? `${open} open · ${list.length - open} closed` : undefined });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Task", w: 4 }, { h: "Assigned to", w: 1.7 }, { h: "Created", w: 1.3 }, { h: "Due", w: 1.3 }, { h: "Status", w: 1.4 }, { h: "Remarks", w: 3 }]),
        list.map((x) => withName(c, x.investor_id, [join(x.title, label(x.type)), txt(x.assignee), d(x.created_at), d(x.due_at), join(label(x.status), x.completed_at ? d(x.completed_at) : ""), txt(x.remarks)])),
        5,
      )
    : { t: "empty", text: c.multi ? "No tasks about the family's members." : "No tasks about this client." });
}

async function serviceSection(c: Ctx, blocks: ReportBlock[]) {
  const list = await rows(c.tx, sql`
    SELECT investor_id, ticket_no, type, subject, status, priority, created_at, resolved_at, resolution_notes
      FROM service_requests WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})
     ORDER BY created_at DESC LIMIT 150`);
  blocks.push({ t: "h1", text: "Service requests" });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Ticket", w: 1.4 }, { h: "Type", w: 1.4 }, { h: "Subject", w: 3.6 }, { h: "Opened", w: 1.3 }, { h: "Status", w: 1.3 }, { h: "Resolved", w: 1.3 }, { h: "Resolution", w: 3 }]),
        list.map((s) => withName(c, s.investor_id, [txt(s.ticket_no), label(s.type), txt(s.subject), d(s.created_at), join(label(s.status), label(s.priority)), d(s.resolved_at), txt(s.resolution_notes)])),
        5,
      )
    : { t: "empty", text: "No service requests on record." });
}

async function messagesSection(c: Ctx, blocks: ReportBlock[]) {
  const cap = c.multi ? 150 : 100;
  const list = await rows(c.tx, sql`
    SELECT investor_id, created_at, channel, direction, status,
           COALESCE(payload->>'subject', payload->>'templateName', template_key) AS what
      FROM communications WHERE tenant_id = ${c.tenantId}::uuid AND investor_id IN (${c.idList})
     ORDER BY created_at DESC LIMIT ${cap}`);
  blocks.push({ t: "h1", text: "Emails & WhatsApp", note: list.length ? `Latest ${cap}` : undefined });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "When", w: 1.7 }, { h: "Channel", w: 1.2 }, { h: "In / out", w: 1 }, { h: "Message", w: 5 }, { h: "Status", w: 1.6 }]),
        list.map((m) => withName(c, m.investor_id, [dt(m.created_at), label(m.channel), label(m.direction), label(m.what), label(m.status)])),
        3,
      )
    : { t: "empty", text: "No messages on record." });
}

async function documentsSection(c: Ctx, blocks: ReportBlock[]) {
  const list = await rows(c.tx, sql`
    SELECT related_entity_id AS investor_id, name, category, issued_on, expires_on, created_at
      FROM compliance_documents
     WHERE tenant_id = ${c.tenantId}::uuid AND related_entity_type = 'investor' AND related_entity_id IN (${c.idList})
       AND superseded_by_id IS NULL
     ORDER BY created_at DESC`);
  blocks.push({ t: "h1", text: "Documents on file" });
  blocks.push(list.length
    ? table(
        withMember(c, [{ h: "Document", w: 4 }, { h: "Category", w: 2 }, { h: "Issued", w: 1.3 }, { h: "Expires", w: 1.3 }, { h: "Uploaded", w: 1.3 }]),
        list.map((x) => withName(c, x.investor_id, [txt(x.name), label(x.category), d(x.issued_on), d(x.expires_on), d(x.created_at)])),
      )
    : { t: "empty", text: "No documents uploaded." });
}

function gapsSection(c: Ctx, blocks: ReportBlock[]) {
  const today = new Date().toISOString().slice(0, 10);
  const all: string[][] = [];
  let scores = 0;
  for (const m of c.members) {
    const i = m.inv;
    const comp = clientCompleteness(i);
    scores += comp.score;
    const gaps = comp.missing.map((x) => `Not on record: ${x.label}`);
    if (!i.nextReviewAt) gaps.push("No review scheduled");
    if (c.show.risk && i.riskProfile && i.riskProfileProvisional) gaps.push("Risk profile is provisional — not confirmed by the client");
    if (c.show.risk && i.riskProfileExpiresOn && String(i.riskProfileExpiresOn) < today) gaps.push("Risk profile is past its review date");
    for (const g of gaps) all.push(withName(c, m.id, [g]));
  }
  const avg = Math.round(scores / Math.max(1, c.members.length));
  blocks.push({ t: "h1", text: "Record gaps", note: c.multi ? `Records ${avg}% complete on average` : `Record ${avg}% complete` });
  blocks.push(all.length
    ? table(withMember(c, [{ h: "What to complete", w: 5 }]), all)
    : { t: "empty", text: c.multi ? "Nothing missing from the members' records." : "Nothing missing from the client record." });
}

/** Every section asked for, in report order (the summary is the caller's). */
async function sectionsFor(c: Ctx, sections: ClientReportSection[], blocks: ReportBlock[], t: Awaited<ReturnType<typeof totals>>, familyBlock?: () => Promise<void>) {
  const on = new Set(sections);
  if (on.has("profile")) profileSection(c, blocks);
  if (on.has("family") && familyBlock) await familyBlock();
  if (on.has("portfolio")) portfolioSection(c, blocks);
  if (on.has("sips")) await sipsSection(c, blocks, t);
  if (on.has("transactions")) await transactionsSection(c, blocks);
  if (on.has("fds")) await fdsSection(c, blocks);
  if (on.has("goals")) await goalsSection(c, blocks);
  if (on.has("insurance") && c.caps.insurance) await insuranceSection(c, blocks);
  if (on.has("claims") && c.caps.insurance) await claimsSection(c, blocks);
  if (on.has("meetings")) await meetingsSection(c, blocks);
  if (on.has("opportunities")) await opportunitiesSection(c, blocks);
  if (on.has("activity")) await activitySection(c, blocks);
  if (on.has("tasks")) await tasksSection(c, blocks);
  if (on.has("service")) await serviceSection(c, blocks);
  if (on.has("messages")) await messagesSection(c, blocks);
  if (on.has("documents") && c.caps.documents) await documentsSection(c, blocks);
  if (on.has("gaps")) gapsSection(c, blocks);
}

// ── Entry points ────────────────────────────────────────────────────────

export type ClientReport = {
  clientName: string;
  subtitles: string[];
  blocks: ReportBlock[];
  /** What the report printed, for the audit row. */
  pii: { pan: boolean; dob: boolean; address: boolean; phone: boolean; email: boolean; bank: boolean };
};

const piiOf = (show: Show, members: Member[]): ClientReport["pii"] => ({
  pan: show.pan, dob: show.dob && members.some((m) => !!m.inv.dob), address: show.address && members.some((m) => !!m.inv.address),
  phone: show.phone, email: show.email, bank: show.bank,
});

export async function buildClientReport(
  tx: Tx,
  session: SessionUser,
  license: LicenseState | null,
  id: string,
  sections: ClientReportSection[],
  opts: { clientCopy: boolean; policyFilter?: PolicyFilter | null },
): Promise<ClientReport | null> {
  const inv = await loadViewableInvestor(tx, session, id).catch((e: { status?: number }) => {
    if (e?.status === 403) return null;
    throw e;
  });
  if (!inv || inv.deletedAt) return null;
  const i: Row = inv;
  const c = await makeCtx(tx, session, license, [{ id, inv: i, role: "" }], null, false, sections.includes("portfolio") || showFor(license).aum);
  c.policyFilter = opts.policyFilter ?? null;
  const { show } = c;
  const blocks: ReportBlock[] = [];

  const [rm] = i.rmId ? await rows(tx, sql`SELECT name FROM users WHERE id = ${i.rmId}::uuid`) : [];
  const [branch] = i.branchId ? await rows(tx, sql`SELECT name FROM branches WHERE id = ${i.branchId}::uuid`) : [];
  const [family] = i.familyId
    ? await rows(tx, sql`SELECT id, family_name, family_code, head_name, primary_investor_id, review_frequency, next_review_at FROM families WHERE id = ${i.familyId}::uuid`)
    : [];
  const t = await totals(c);

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
  const stats = headlineStats(c, t);
  if (stats.length) blocks.push({ t: "stats", items: stats });

  await sectionsFor(c, sections, blocks, t, async () => {
    blocks.push({ t: "h1", text: "Family" });
    if (!family) {
      blocks.push({ t: "empty", text: "Not mapped to a family." });
      return;
    }
    blocks.push({ t: "kv", items: [["Family", txt(family.family_name)], ["Code", txt(family.family_code)], ["Head", txt(family.head_name)], ["Review frequency", label(family.review_frequency)], ["Next family review", d(family.next_review_at)]] });
    const scope = await investorScopeCondition(tx, session);
    const members = await tx
      .select({ id: investors.id, name: investors.name, role: investors.familyRole, aum: investors.aum, sip: investors.activeSipAmount, status: investors.status })
      .from(investors)
      .where(and(eq(investors.tenantId, session.tenantId), eq(investors.familyId, family.id), isNull(investors.deletedAt), isNull(investors.mergedIntoId), scope));
    const [all] = await rows(tx, sql`SELECT count(*)::int AS n FROM investors WHERE tenant_id = ${session.tenantId}::uuid AND family_id = ${family.id}::uuid AND deleted_at IS NULL AND merged_into_id IS NULL`);
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
  });

  return {
    clientName: i.name,
    subtitles: [i.name, opts.clientCopy ? "Client copy" : "Complete client record", `As on ${formatDate(new Date(), "dateTime")}`],
    blocks,
    pii: piiOf(show, c.members),
  };
}

/**
 * The FAMILY report: the family's summary and every member, then each
 * section across all members with a Member column. Members are the family's
 * own (not deleted, not merged away) — closed / exited ones included, as on
 * the family page, since their history is the family's.
 */
export async function buildFamilyReport(
  tx: Tx,
  session: SessionUser,
  license: LicenseState | null,
  familyId: string,
  sections: ClientReportSection[],
  opts: { clientCopy: boolean; policyFilter?: PolicyFilter | null },
): Promise<ClientReport | null> {
  if (!(await loadViewableFamily(tx, session, familyId))) return null;
  const [fam] = await rows(tx, sql`
    SELECT f.id, f.family_name, f.family_code, f.head_name, f.primary_investor_id, f.review_frequency, f.family_category,
           f.last_review_at, f.next_review_at, f.first_meeting_date, u.name AS rm_name, b.name AS branch_name
      FROM families f LEFT JOIN users u ON u.id = f.rm_id LEFT JOIN branches b ON b.id = f.branch_id
     WHERE f.id = ${familyId}::uuid AND f.tenant_id = ${session.tenantId}::uuid`);
  if (!fam) return null;
  const invRows = await tx
    .select()
    .from(investors)
    .where(and(eq(investors.tenantId, session.tenantId), eq(investors.familyId, familyId), isNull(investors.deletedAt), isNull(investors.mergedIntoId)));
  // Head first, then by AUM.
  invRows.sort((a, b) =>
    a.id === fam.primary_investor_id ? -1 : b.id === fam.primary_investor_id ? 1 : Number(b.aum ?? 0) - Number(a.aum ?? 0),
  );
  const members: Member[] = invRows.map((r) => ({
    id: r.id,
    inv: r as Row,
    role: r.id === fam.primary_investor_id ? "Head of family" : label(r.familyRole),
  }));
  const familyName = txt(fam.family_name) || `${txt(fam.head_name)} Family`;
  const blocks: ReportBlock[] = [];
  if (!members.length) {
    blocks.push({ t: "h1", text: "Summary" });
    blocks.push({ t: "empty", text: "This family has no members yet." });
    return { clientName: familyName, subtitles: [familyName, `As on ${formatDate(new Date(), "dateTime")}`], blocks, pii: piiOf(showFor(license), []) };
  }
  const c = await makeCtx(tx, session, license, members, familyId, true, true);
  c.policyFilter = opts.policyFilter ?? null;
  const { show } = c;
  const t = await totals(c);

  blocks.push({ t: "h1", text: "Family summary" });
  blocks.push({
    t: "kv",
    cols: 3,
    items: [
      ["Family", familyName],
      ["Family code", txt(fam.family_code)],
      ["Head of family", txt(members.find((m) => m.id === fam.primary_investor_id)?.inv.name ?? fam.head_name) || "Not set"],
      ["Relationship manager", show.rm ? txt(fam.rm_name) : ""],
      ["Branch", txt(fam.branch_name)],
      ["Category", txt(fam.family_category)],
      ["Members", String(members.length)],
      ["Review frequency", label(fam.review_frequency)],
      ["First meeting", d(fam.first_meeting_date)],
      ["Last family review", d(fam.last_review_at) || "Not on record"],
      ["Next family review", d(fam.next_review_at) || "Not scheduled"],
    ],
  });
  const stats = headlineStats(c, t);
  if (stats.length) blocks.push({ t: "stats", items: stats });

  // Every member at a glance.
  const [policies, sipsBy] = await Promise.all([
    c.caps.insurance
      ? rows(tx, sql`SELECT investor_id, count(*)::int AS n FROM insurance_policies
           WHERE tenant_id = ${session.tenantId}::uuid AND investor_id IN (${c.idList}) AND status = ANY(${LIVE_POLICY}) GROUP BY investor_id`)
      : Promise.resolve([] as Row[]),
    rows(tx, sql`SELECT investor_id, COALESCE(sum(amount::numeric), 0) AS amount FROM sips
           WHERE tenant_id = ${session.tenantId}::uuid AND investor_id IN (${c.idList}) AND status = 'active' GROUP BY investor_id`),
  ]);
  const polBy = new Map(policies.map((r) => [String(r.investor_id), Number(r.n)]));
  const sipBy = new Map(sipsBy.map((r) => [String(r.investor_id), Number(r.amount)]));
  blocks.push({ t: "h1", text: "Members", note: `${members.length} member${members.length === 1 ? "" : "s"}` });
  blocks.push(table(
    [
      { h: "Member", w: 3 }, { h: "Relationship", w: 1.6 }, { h: "Type", w: 1.3 }, { h: "PAN", w: 1.6 }, { h: "Status", w: 1.1 },
      { h: "MF value", w: 1.6, right: true }, { h: "Monthly SIP", w: 1.4, right: true }, { h: "Policies", w: 1.3, right: true }, { h: "Risk profile", w: 1.5 },
    ],
    members.map((m) => {
      const v = c.valuations.get(m.id);
      return [
        txt(m.inv.name),
        m.role,
        clientTypeLabel(m.inv.investorCategory),
        show.pan ? txt(m.inv.pan).replace(/^NOPAN:.*/, "") : "",
        label(m.inv.status),
        show.aum && v ? (openHoldings(v).length ? inr(v.currentValue) : "None") : "",
        show.sip ? (sipBy.get(m.id) ? inr(sipBy.get(m.id)) : "None") : "",
        c.caps.insurance ? String(polBy.get(m.id) ?? 0) : "",
        show.risk ? (m.inv.riskProfile ? join(label(m.inv.riskProfile), m.inv.riskProfileProvisional ? "provisional" : "") : "Not completed") : "",
      ];
    }),
  ));

  await sectionsFor(c, sections.filter((s) => s !== "family"), blocks, t);

  return {
    clientName: familyName,
    subtitles: [familyName, opts.clientCopy ? "Family copy" : "Complete family record", `As on ${formatDate(new Date(), "dateTime")}`],
    blocks,
    pii: piiOf(show, members),
  };
}

// ── Insurance choice for the download dialog ────────────────────────────

export type PolicyFacets = {
  statuses: Array<{ key: string; label: string; n: number }>;
  types: Array<{ key: string; label: string; n: number }>;
};

/**
 * The statuses and types of the policies this report would print, with
 * counts, for the dialog's "which policies" choice. Same access as the
 * report: the client (or family) must be viewable and the viewer must hold an
 * insurance capability; otherwise null.
 */
export async function insuranceFacets(
  tx: Tx,
  session: SessionUser,
  target: { investorId: string } | { familyId: string },
): Promise<PolicyFacets | null> {
  if (!capsFor(session).insurance) return null;
  let ids: string[];
  if ("investorId" in target) {
    const inv = await loadViewableInvestor(tx, session, target.investorId).catch(() => null);
    if (!inv) return null;
    ids = [inv.id];
  } else {
    if (!(await loadViewableFamily(tx, session, target.familyId))) return null;
    const m = await tx
      .select({ id: investors.id })
      .from(investors)
      .where(and(eq(investors.tenantId, session.tenantId), eq(investors.familyId, target.familyId), isNull(investors.deletedAt), isNull(investors.mergedIntoId)));
    ids = m.map((r) => r.id);
  }
  if (!ids.length) return { statuses: [], types: [] };
  const list = await rows(tx, sql`
    SELECT status, NULLIF(policy_type, '') AS policy_type, count(*)::int AS n
      FROM insurance_policies
     WHERE tenant_id = ${session.tenantId}::uuid AND investor_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
     GROUP BY 1, 2`);
  const statuses = new Map<string, number>();
  const types = new Map<string, number>();
  for (const r of list) {
    const st = txt(r.status) || "active";
    const ty = txt(r.policy_type) || NO_POLICY_TYPE;
    statuses.set(st, (statuses.get(st) ?? 0) + Number(r.n));
    types.set(ty, (types.get(ty) ?? 0) + Number(r.n));
  }
  const statusOrder = Object.keys(POLICY_STATUS_LABEL);
  return {
    statuses: [...statuses]
      .sort((a, b) => (statusOrder.indexOf(a[0]) + 1 || 99) - (statusOrder.indexOf(b[0]) + 1 || 99))
      .map(([key, n]) => ({ key, label: POLICY_STATUS_LABEL[key] ?? label(key), n })),
    types: [...types]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, n]) => ({ key, label: key === NO_POLICY_TYPE ? "Type not recorded" : policyTypeLabel(key), n })),
  };
}
