/**
 * Client master PDF — the DATA, gathered once and handed to the renderer
 * (./render.ts). SERVER-ONLY.
 *
 * Everything the client page shows about a person, in the order the PDF prints it:
 * the Client Master pages (KYC & profile, bank, nominees, referrals, risk profile),
 * the portfolio, fixed deposits, cross-sell holdings, review details, and — only when
 * the person asked for them — meetings, service requests, tasks, emails and gifts.
 * Notes come last.
 *
 * A field the viewer's licence does not show (PAN, mobile, bank …) is left out the
 * same way the client page leaves it out (`isFieldAllowed`), and an optional
 * section the viewer's role cannot see is never loaded.
 */

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import {
  clientOpportunities, communications, fixedDeposits, investors, reviewMeetings, riskProfileResponses,
  serviceRequests, sips, tasks, tenants,
} from "@/db/schema";
import { loadViewableInvestor } from "@/lib/investors/access";
import { can } from "@/lib/auth/rbac";
import { isFieldAllowed } from "@/lib/auth/field-gate";
import { loadTenantLicense } from "@/lib/auth/license";
import { ownPan } from "@/lib/investors/pan-display";
import { CROSS_SELL_PRODUCTS, CROSS_SELL_STATUSES } from "@/lib/investors/cross-sell";
import { clientTypeLabel } from "@/lib/investors/client-types";
import { valueInvestor } from "@/lib/finance/valuation";
import { loadRecordNotes } from "@/lib/notes/record-notes";
import type { ClientMasterData, OptionalKey, PdfCell, PdfKv, PdfTable } from "./types";

export * from "./types";

/* ───────────────────────────── helpers ───────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-11-25 or an ISO timestamp → 25 Nov 2026 (India date for timestamps). */
export function fmtD(v: string | Date | null | undefined): string {
  if (!v) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
  }
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
const fmtDT = (v: string | Date | null | undefined): string => {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
};
const inr = (n: number | string | null | undefined): string => {
  if (n == null || n === "") return "—";
  const x = Number(n);
  return Number.isFinite(x) ? "₹" + Math.round(x).toLocaleString("en-IN") : "—";
};
const num = (n: number | null | undefined, dp: number): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (dec: number | null | undefined): string => (dec == null || !Number.isFinite(dec) ? "—" : `${dec >= 0 ? "+" : ""}${(dec * 100).toFixed(1)}%`);
const words = (s: string | null | undefined): string => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");
const dash = (s: string | null | undefined): string => (s && String(s).trim() ? String(s).trim() : "—");
const tone = (t: string, kind: "good" | "warn" | "bad" | "muted"): PdfCell => ({ t, tone: kind });

const kv = (label: string, value: string | null | undefined, span?: 2 | 3): PdfKv => ({ label, value: dash(value), span });

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "muted"> = {
  active: "good", completed: "good", closed: "good", resolved: "good", delivered: "good", read: "good", replied: "good", sent: "good",
  open: "warn", in_progress: "warn", scheduled: "warn", pending: "warn", confirmed: "warn", waiting_customer: "warn", blocked: "warn", queued: "warn",
  cancelled: "muted", expired: "muted", stopped: "muted", paused: "muted", matured: "muted", renewed: "muted", rescheduled: "muted",
  failed: "bad", bounced: "bad", escalated: "bad", rejected: "bad", no_show: "bad", unsubscribed: "bad",
};
const statusCell = (s: string | null | undefined): PdfCell => tone(words(s), STATUS_TONE[String(s)] ?? "muted");

const CS_LABEL = new Map<string, string>(CROSS_SELL_PRODUCTS.map(([k, l]) => [k, l]));
const CS_STATUS = new Map<string, string>(CROSS_SELL_STATUSES.map(([k, l]) => [k, l]));

const ANSWER_CAP = 12;

/* ───────────────────────────── loader ───────────────────────────── */

export async function loadClientMaster(
  tx: Tx,
  session: SessionUser,
  investorId: string,
  include: OptionalKey[],
): Promise<ClientMasterData | null> {
  const inv = await loadViewableInvestor(tx, session, investorId);
  if (!inv) return null;
  const tenantId = session.tenantId;
  const license = await loadTenantLicense(tenantId, session.roles);
  const show = (f: string) => isFieldAllowed(license, "investor", f);
  const showPan = show("pan");
  const showDob = show("dob");
  const showPhone = show("phone");
  const showEmail = show("email");
  const showAddress = show("address") || show("city") || show("state") || show("pincode");
  const showKyc = show("kyc_status") || show("kyc");
  const showRisk = show("risk_profile") || show("risk");
  const showNominee = show("nominee_name") || show("nominee");
  const showBank = show("bank_account_number_masked") || show("bank");
  const showAum = show("aum");
  const showSip = show("active_sip_amount") || show("sip");

  const available: Record<OptionalKey, boolean> = {
    meetings: can(session.roles, "review_meeting.manage.all", session.permissions) || can(session.roles, "review_meeting.manage.assigned", session.permissions),
    serviceRequests: can(session.roles, "service_request.view.all", session.permissions) || can(session.roles, "service_request.view.assigned", session.permissions) || can(session.roles, "service_request.manage", session.permissions),
    tasks: can(session.roles, "task.view.all", session.permissions) || can(session.roles, "task.view.assigned", session.permissions),
    emails: true,
    gifts: true,
  };
  const want = (k: OptionalKey) => include.includes(k) && available[k];

  const nameOf = async (table: "users" | "branches" | "families", id: string | null | undefined): Promise<string | null> => {
    if (!id) return null;
    const col = table === "families" ? sql.raw("COALESCE(family_name, head_name)") : sql.raw("name");
    const r = await tx.execute(sql`SELECT ${col} AS n FROM ${sql.raw(table)} WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`);
    return ((r.rows[0] as { n?: string | null } | undefined)?.n ?? null) || null;
  };
  const rmName = await nameOf("users", inv.rmId);
  const branchName = await nameOf("branches", inv.branchId);
  const familyName = await nameOf("families", inv.familyId);

  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  const adult = !inv.isMinor;
  const addr = inv.address ?? {};
  const pan = showPan ? ownPan(inv.pan) : null;

  /* ── Client Master ── */
  const identity: PdfKv[] = [
    ...(showPan ? [kv("PAN", pan)] : []),
    kv("Name", inv.name),
    kv("Name as per PAN", inv.nameAsPerPan),
    ...(showDob ? [kv("Date of birth", inv.dob ? fmtD(inv.dob) : null)] : []),
    kv("Gender", inv.gender === "M" ? "Male" : inv.gender === "F" ? "Female" : inv.gender === "O" ? "Other" : null),
    ...(adult ? [kv("Marital status", words(inv.maritalStatus) === "—" ? null : words(inv.maritalStatus))] : []),
    kv("Mother's name", inv.motherName),
    kv("Place of birth", inv.birthPlace),
    kv("Aadhaar (last 4)", inv.aadhaarLast4 ? `••••${inv.aadhaarLast4}` : null),
    kv("Client since", inv.onboardedAt ? fmtD(inv.onboardedAt) : null),
    ...(inv.dateOfDemise ? [kv("Date of demise", fmtD(inv.dateOfDemise))] : []),
    ...(adult && inv.anniversaryDate ? [kv("Anniversary", fmtD(inv.anniversaryDate))] : []),
  ];
  const addrLine = [addr.line1, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(", ");
  const contact: PdfKv[] = [
    ...(showPhone ? [kv("Mobile", inv.phone), kv("Mobile belongs to", words(inv.mobileRelation) === "—" ? null : words(inv.mobileRelation)), kv("Alternate mobile", inv.alternatePhone)] : []),
    ...(showEmail ? [kv("Email", inv.email), kv("Email belongs to", words(inv.emailRelation) === "—" ? null : words(inv.emailRelation))] : []),
    ...(showPhone ? [kv("WhatsApp", inv.whatsappPhone)] : []),
    ...(showAddress ? [kv("Address", addrLine || null, 3)] : []),
  ];
  const profile: PdfKv[] = [
    ...(adult ? [kv("Occupation", inv.occupation), kv("Employer", inv.employerName)] : []),
    kv("Income range", inv.incomeRange),
    kv("Client type", inv.investorCategory ? clientTypeLabel(inv.investorCategory) : null),
    kv("Segment", inv.segmentTag),
    kv("Client category", inv.clientCategory),
    kv("Mode of holding", inv.modeOfHolding ? words(inv.modeOfHolding) : null),
    kv("Household type", inv.householdType),
    kv("Family head", inv.familyOwnerName),
    kv("Assigned RM", rmName),
    kv("Family group", familyName ? `${familyName}${inv.familyRole ? ` (${inv.familyRole})` : ""}` : null),
    kv("Referral client", inv.referralClientName),
  ];
  const compliance: PdfKv[] = [
    ...(showKyc ? [kv("KYC status", words(inv.kycStatus)), kv("KRA check", inv.kycStatusRemark ? `${inv.kycStatusRemark}${inv.kycCheckedAt ? ` · checked ${fmtD(inv.kycCheckedAt)}` : ""}` : null), kv("KRA", inv.kraName)] : []),
    kv("KYC validated on", inv.kycValidatedAt ? fmtD(inv.kycValidatedAt) : null),
    kv("CKYC number", inv.ckycNumber),
    kv("FATCA status", words(inv.fatcaStatus) === "—" ? null : words(inv.fatcaStatus)),
    kv("Residential status", words(inv.residencyStatus) === "—" ? null : words(inv.residencyStatus)),
    kv("Tax status", inv.taxStatus),
    ...(adult ? [kv("PAN–Aadhaar link", words(inv.panAadhaarLinkStatus) === "—" ? null : words(inv.panAadhaarLinkStatus))] : []),
    ...(showPan ? [kv("UCC (BSE)", inv.bseUccCode), kv("CAN (NSE)", inv.nseCanCode), kv("Other UCCs", (inv.uccCodes ?? []).join(", ") || null)] : []),
    kv("Mandate", words(inv.mandateStatus ?? "none")),
    kv("Mandate ref", inv.mandateRefNo),
    kv("Mandate amount", inv.mandateAmount != null ? inr(inv.mandateAmount) : null),
  ];

  const accounts = Array.isArray(inv.bankAccounts) ? inv.bankAccounts : [];
  const bankRows: PdfCell[][] = [];
  if (inv.bankName || inv.bankAccountNumberMasked || inv.bankIfsc) {
    bankRows.push(["1 (primary)", dash(inv.bankName), dash(inv.bankAccountNumberMasked), dash(inv.bankIfsc), "—"]);
  }
  accounts.slice(1).forEach((b, i) => bankRows.push([String(i + 2), dash(b.bankName), dash(b.accountMasked), dash(b.ifsc), dash(b.accountType)]));
  const bank: PdfTable | null = showBank
    ? { heads: ["#", "Bank", "Account no.", "IFSC", "Type"], rows: bankRows, widths: [0.14, 0.34, 0.22, 0.16, 0.14], empty: "No bank account recorded." }
    : null;

  const secondName = [inv.secondHolderFirstName, inv.secondHolderLastName].filter(Boolean).join(" ");
  const secondHolder: PdfKv[] | null =
    secondName || inv.secondHolderOccupation || inv.secondHolderCompanyName
      ? [kv("Name", secondName), kv("Occupation", inv.secondHolderOccupation), kv("Company", inv.secondHolderCompanyName),
         kv("Birth place", inv.secondHolderBirthPlace), kv("Mother's name", inv.secondHolderMotherName), kv("Marital status", inv.secondHolderMaritalStatus)]
      : null;

  const lifetime: PdfKv[] = [
    kv("Lifetime inflow", show("lifetime_inflow") ? inr(inv.lifetimeInflow) : null),
    kv("Lifetime outflow", show("lifetime_inflow") ? inr(inv.lifetimeOutflow) : null),
    kv("Last transaction", inv.lastTransactionAt ? fmtD(inv.lastTransactionAt) : "Never"),
    kv("Client status", words(inv.status)),
  ];

  /* ── Nominees ── */
  const nomineeList = Array.isArray(inv.nominees) ? inv.nominees : [];
  const nominees: ClientMasterData["nominees"] = showNominee && adult
    ? {
        note: nomineeList.length || inv.nomineeName ? "Nomination recorded." : "No nominee recorded.",
        table: {
          heads: ["Nominee", "Relationship", "Date of birth", "Share", "Mobile"],
          rows: nomineeList.length
            ? nomineeList.map((n) => [dash(n.name), dash(n.relation), n.dob ? fmtD(n.dob) : "—", n.sharePct != null ? `${n.sharePct}%` : "—", dash(n.mobile)])
            : inv.nomineeName ? [[dash(inv.nomineeName), dash(inv.nomineeRelation), inv.nomineeDob ? fmtD(inv.nomineeDob) : "—", "—", "—"]] : [],
          widths: [0.3, 0.2, 0.18, 0.1, 0.22], align: ["l", "l", "l", "r", "l"], empty: "No nominee recorded.",
        },
      }
    : null;

  /* ── Referrals ── */
  const referredLeadRows = (await tx.execute(sql`
    SELECT l.name, l.stage, l.created_at, l.converted_at, ci.name AS converted_name
      FROM leads l
      LEFT JOIN investors ci ON ci.id = l.converted_investor_id AND ci.deleted_at IS NULL
     WHERE l.tenant_id = ${tenantId}::uuid AND l.referred_by_investor_id = ${investorId}::uuid
     ORDER BY l.created_at DESC LIMIT 50
  `)).rows as Array<{ name: string | null; stage: string | null; created_at: string | null; converted_at: string | null; converted_name: string | null }>;
  const typedReferrals = Array.isArray(inv.referrals) ? inv.referrals : [];
  const referrals: ClientMasterData["referrals"] = {
    referredBy: [kv("Referred by", inv.referralClientName)],
    typed: typedReferrals.length
      ? { heads: ["Name", "Relation", "Mobile", "Note"], rows: typedReferrals.map((r) => [dash(r.name), dash(r.relation), dash(r.mobile), dash(r.note)]), widths: [0.26, 0.18, 0.2, 0.36] }
      : null,
    leads: {
      heads: ["Referred person", "Became", "Stage / status", "Referred on"],
      rows: referredLeadRows.map((r) => [
        dash(r.name), r.converted_name ? `Client: ${r.converted_name}` : "Lead",
        r.converted_name ? tone("Converted", "good") : statusCell(r.stage), fmtD(r.created_at),
      ]),
      widths: [0.3, 0.28, 0.24, 0.18], empty: "Nobody referred by this client has been recorded.",
    },
  };

  /* ── Risk profile ── */
  let risk: ClientMasterData["risk"] = null;
  if (showRisk) {
    const [rp] = await tx.select().from(riskProfileResponses)
      .where(and(eq(riskProfileResponses.tenantId, tenantId), eq(riskProfileResponses.investorId, investorId)))
      .orderBy(desc(riskProfileResponses.profileDate)).limit(1);
    const answers = (rp?.responses ?? []).slice(0, ANSWER_CAP);
    risk = {
      summary: [
        kv("Category", words(inv.riskProfile ?? "not_assessed")),
        kv("Score", inv.riskProfileScore != null ? String(inv.riskProfileScore) : rp ? String(rp.totalScore) : null),
        kv("Status", inv.riskProfileSignedAt ? (inv.riskProfileProvisional ? "Provisional (not confirmed by the client)" : "Confirmed by the client") : "Not completed"),
        kv("Signed on", inv.riskProfileSignedAt ? fmtD(inv.riskProfileSignedAt) : null),
        kv("Valid till", inv.riskProfileExpiresOn ? fmtD(inv.riskProfileExpiresOn) : null),
        kv("Questionnaire date", rp ? fmtD(rp.profileDate) : null),
      ],
      answers: answers.length
        ? { heads: ["Question", "Client's answer"], rows: answers.map((a) => [dash(a.question), words(a.answer)]), widths: [0.55, 0.45] }
        : null,
    };
  }

  /* ── Portfolio ── */
  let portfolio: ClientMasterData["portfolio"] = null;
  const sipRows = await tx.select().from(sips).where(and(eq(sips.tenantId, tenantId), eq(sips.investorId, investorId))).orderBy(desc(sips.startDate));
  if (showAum || showSip) {
    const v = await valueInvestor(tx, investorId);
    const open = v.holdings.filter((h) => (h.currentValue ?? 0) > 0 || h.netUnits > 0);
    const byClass = new Map<string, number>();
    for (const h of open) {
      const c = assetClass(h.schemeName);
      byClass.set(c, (byClass.get(c) ?? 0) + (h.currentValue ?? 0));
    }
    const total = [...byClass.values()].reduce((a, b) => a + b, 0);
    const activeSips = sipRows.filter((s) => s.status === "active");
    portfolio = {
      tiles: [
        { label: "Current value", value: inr(v.currentValue) },
        { label: "Invested", value: inr(v.pricedInvested) },
        { label: "Gain", value: v.gain != null ? inr(v.gain) : "—", tone: (v.gain ?? 0) >= 0 ? "good" : "bad" },
        { label: "Return", value: pct(v.absoluteReturn), tone: (v.absoluteReturn ?? 0) >= 0 ? "good" : "bad" },
        { label: "XIRR (p.a.)", value: pct(v.xirr ?? v.xirrPartial), tone: (v.xirr ?? v.xirrPartial ?? 0) >= 0 ? "good" : "bad" },
      ],
      holdings: {
        heads: ["Scheme", "Folio", "Units", "Avg NAV", "Invested", "NAV", "Value", "Gain"],
        rows: open.map((h) => {
          const cost = h.investedNet ?? h.investedEstimate;
          const avg = cost != null && h.netUnits > 0 ? cost / h.netUnits : null;
          return [dash(h.schemeName ?? h.schemeCode), dash(h.folioNumber), num(h.netUnits, 3), num(avg, 2), inr(cost), num(h.latestNav, 2), inr(h.currentValue),
            h.gain != null ? tone(inr(h.gain), h.gain >= 0 ? "good" : "bad") : "—"];
        }),
        widths: [0.25, 0.12, 0.1, 0.1, 0.11, 0.09, 0.12, 0.11], align: ["l", "l", "r", "r", "r", "r", "r", "r"],
        empty: "No mutual fund holdings on record.",
      },
      allocation: [...byClass.entries()].filter(([, val]) => val > 0).map(([label, value]) => ({ label, value, pct: total ? (value / total) * 100 : 0 })).sort((a, b) => b.value - a.value),
      sips: {
        heads: ["Scheme", "Amount", "Frequency", "SIP day", "Started", "Status"],
        rows: sipRows.map((s) => [dash(s.schemeName ?? s.schemeCode), inr(s.amount), words(s.frequency), dash(s.sipDate), s.startDate ? fmtD(s.startDate) : "—", statusCell(s.status)]),
        widths: [0.34, 0.12, 0.13, 0.09, 0.15, 0.17], align: ["l", "r", "l", "r", "l", "l"], empty: "No SIPs on record.",
      },
      sipNote: `SIP book (active SIPs, monthly equivalent): ${inr(inv.activeSipAmount)} · ${activeSips.length} active SIP${activeSips.length === 1 ? "" : "s"}`,
      note: v.dataQuality.unknownCostHoldings > 0 ? `${v.dataQuality.unknownCostHoldings} holding(s) have no full purchase history, so their invested amount and gain are partial or blank.` : null,
    };
  }

  /* ── Fixed deposits ── */
  const fdRows = await tx.select().from(fixedDeposits)
    .where(and(eq(fixedDeposits.tenantId, tenantId), eq(fixedDeposits.investorId, investorId), isNull(fixedDeposits.deletedAt)))
    .orderBy(desc(fixedDeposits.depositDate));
  const liveFds = fdRows.filter((f) => f.status === "active");
  const nextMat = liveFds.map((f) => f.maturityDate).sort()[0];
  const fds: ClientMasterData["fds"] = {
    tiles: [
      { label: "Live deposits", value: String(liveFds.length) },
      { label: "Principal (live)", value: inr(liveFds.reduce((a, f) => a + Number(f.principal), 0)) },
      { label: "Maturity value (live)", value: liveFds.some((f) => f.maturityAmount != null) ? inr(liveFds.reduce((a, f) => a + Number(f.maturityAmount ?? f.principal), 0)) : "—" },
      { label: "Next maturity", value: nextMat ? fmtD(nextMat) : "—" },
    ],
    table: {
      heads: ["Issuer", "Receipt no.", "Deposited", "Rate", "Payout", "Matures", "Principal", "Maturity amt", "Status"],
      rows: fdRows.map((f) => [dash(f.issuer), dash(f.fdNumber), fmtD(f.depositDate), `${Number(f.interestRate)}%`, words(f.payout), fmtD(f.maturityDate), inr(f.principal), inr(f.maturityAmount), statusCell(f.status)]),
      widths: [0.14, 0.11, 0.1, 0.06, 0.1, 0.1, 0.12, 0.13, 0.14], align: ["l", "l", "l", "r", "l", "l", "r", "r", "l"],
      empty: "No fixed deposits recorded for this client.",
    },
  };

  /* ── Cross-sell ── */
  const csMap = (inv.crossSell ?? {}) as Record<string, string>;
  const opps = await tx.select().from(clientOpportunities)
    .where(and(eq(clientOpportunities.tenantId, tenantId), eq(clientOpportunities.investorId, investorId)))
    .orderBy(desc(clientOpportunities.createdAt)).limit(100);
  const ownerIds = [...new Set(opps.map((o) => o.ownerId).filter((x): x is string => !!x))];
  const ownerNames = new Map<string, string>();
  for (const oid of ownerIds) ownerNames.set(oid, (await nameOf("users", oid)) ?? "—");
  const yearAgo = new Date(Date.now() - 365 * 86_400_000);
  const csTone = (s: string | undefined): PdfCell =>
    !s ? tone("Not recorded", "muted") : tone(CS_STATUS.get(s) ?? words(s), s === "held_with_us" ? "good" : s === "interested" ? "warn" : "muted");
  const crossSell: ClientMasterData["crossSell"] = {
    holdings: {
      heads: ["Product", "Status"],
      rows: CROSS_SELL_PRODUCTS.map(([k, label]) => [label, csTone(csMap[k])]),
      widths: [0.5, 0.5],
    },
    open: {
      heads: ["Product", "Mode", "Owner", "Opened", "Expected value", "Waiting"],
      rows: opps.filter((o) => o.status === "open").map((o) => [
        CS_LABEL.get(o.product) ?? words(o.product), o.investmentMode ? words(o.investmentMode) : "—", o.ownerId ? ownerNames.get(o.ownerId) ?? "—" : "—",
        fmtD(o.createdAt), inr(o.expectedValue), o.parkedAt ? `Later${o.revisitOn ? ` — ${fmtD(o.revisitOn)}` : ""}` : "—",
      ]),
      widths: [0.24, 0.12, 0.2, 0.14, 0.15, 0.15], empty: "No open opportunities.",
    },
    closed: {
      heads: ["Product", "Outcome", "On", "Detail"],
      rows: opps.filter((o) => o.status !== "open" && (o.wonAt ?? o.lostAt ?? o.createdAt) >= yearAgo).map((o) => [
        CS_LABEL.get(o.product) ?? words(o.product), o.status === "won" ? tone("Won", "good") : tone("Lost", "bad"),
        fmtD(o.wonAt ?? o.lostAt), o.status === "lost" ? dash(o.lostReason) : dash(o.notes),
      ]),
      widths: [0.25, 0.12, 0.15, 0.48], empty: "Nothing won or lost in the last 12 months.",
    },
  };

  /* ── Review details ── */
  const reviewMeetingRows = await tx.select().from(reviewMeetings)
    .where(and(eq(reviewMeetings.tenantId, tenantId), eq(reviewMeetings.investorId, investorId), eq(reviewMeetings.category, "review")))
    .orderBy(desc(reviewMeetings.meetingDate)).limit(8);
  const lastDone = reviewMeetingRows.find((m) => m.status === "completed");
  const lastActions = lastDone?.actionItems ?? [];
  const review: ClientMasterData["review"] = {
    schedule: [
      kv("Review frequency", inv.reviewFrequency ? words(inv.reviewFrequency) : null),
      kv("Last review", inv.lastReviewAt ? fmtD(inv.lastReviewAt) : null),
      kv("Next review due", inv.nextReviewAt ? fmtD(inv.nextReviewAt) : "Not scheduled"),
      kv("Review owner", rmName),
      kv("Health score", `${inv.healthScore} / 100`),
      kv("Last contact", inv.lastContactAt ? fmtD(inv.lastContactAt) : null),
    ],
    last: lastDone
      ? {
          facts: [kv("Date", fmtDT(lastDone.meetingDate)), kv("Mode", words(lastDone.meetingMode)), kv("Subject", lastDone.subject ?? words(lastDone.meetingType))],
          points: [lastDone.discussionPoints, lastDone.meetingNotes].filter((x) => x && x.trim()).join("\n\n") || null,
          actions: {
            heads: ["Action item", "Due"],
            rows: lastActions.map((a) => [dash(a.title), a.dueAt ? fmtD(a.dueAt) : "—"]),
            widths: [0.78, 0.22], empty: "No action items recorded.",
          },
        }
      : null,
    history: {
      heads: ["Date", "Type", "Mode", "Status"],
      rows: reviewMeetingRows.map((m) => [fmtDT(m.meetingDate), dash(m.subject ?? words(m.meetingType)), words(m.meetingMode), statusCell(m.status)]),
      widths: [0.26, 0.4, 0.14, 0.2], empty: "No review meetings recorded.",
    },
  };

  /* ── Optional sections ── */
  const optional: ClientMasterData["optional"] = {};

  if (want("meetings")) {
    const rows = await tx.select({ m: reviewMeetings, rm: sql<string | null>`(SELECT name FROM users u WHERE u.id = ${reviewMeetings.rmId})` })
      .from(reviewMeetings)
      .where(and(eq(reviewMeetings.tenantId, tenantId), eq(reviewMeetings.investorId, investorId)))
      .orderBy(desc(reviewMeetings.meetingDate)).limit(300);
    optional.meetings = {
      title: `Meetings (${rows.length})`,
      table: {
        heads: ["Date", "Type", "Mode", "RM", "Status", "Notes"],
        rows: rows.map(({ m, rm }) => [fmtDT(m.meetingDate), dash(m.subject ?? words(m.meetingType)), words(m.meetingMode), dash(rm), statusCell(m.status), dash(m.meetingNotes ? m.meetingNotes.slice(0, 160) : null)]),
        widths: [0.2, 0.18, 0.09, 0.13, 0.12, 0.28], empty: "No meetings with this client.",
      },
    };
  }

  if (want("serviceRequests")) {
    const rows = await tx.select({ s: serviceRequests, who: sql<string | null>`(SELECT name FROM users u WHERE u.id = ${serviceRequests.assignedToUserId})` })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.tenantId, tenantId), eq(serviceRequests.investorId, investorId)))
      .orderBy(desc(serviceRequests.createdAt)).limit(300);
    optional.serviceRequests = {
      title: `Service requests (${rows.length})`,
      table: {
        heads: ["Service ID", "Type", "Subject", "Opened", "Resolved", "Handler", "Status"],
        rows: rows.map(({ s, who }) => [dash(s.ticketNo), words(s.type), dash(s.subject), fmtD(s.createdAt), s.resolvedAt ? fmtD(s.resolvedAt) : "—", dash(who), statusCell(s.status)]),
        widths: [0.13, 0.13, 0.22, 0.12, 0.12, 0.12, 0.16], empty: "No service requests from this client.",
      },
    };
  }

  if (want("tasks")) {
    const rows = await tx.select({ k: tasks, who: sql<string | null>`(SELECT name FROM users u WHERE u.id = ${tasks.assigneeId})` })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), or(eq(tasks.relatedInvestorId, investorId), and(eq(tasks.subjectType, "investor"), eq(tasks.subjectId, investorId)))))
      .orderBy(desc(tasks.createdAt)).limit(300);
    optional.tasks = {
      title: `Tasks (${rows.length})`,
      table: {
        heads: ["Task", "Type", "Assignee", "Entered", "Due", "Priority", "Status"],
        rows: rows.map(({ k, who }) => [dash(k.title), words(k.type), dash(who), k.entryDate ? fmtD(k.entryDate) : fmtD(k.createdAt), k.dueAt ? fmtD(k.dueAt) : "—", words(k.priority), statusCell(k.status)]),
        widths: [0.26, 0.12, 0.12, 0.12, 0.12, 0.09, 0.17], empty: "No tasks linked to this client.",
      },
    };
  }

  if (want("emails")) {
    const rows = await tx.select({
      status: communications.status, sentAt: communications.sentAt, createdAt: communications.createdAt, readAt: communications.readAt,
      templateKey: communications.templateKey, direction: communications.direction,
      subject: sql<string | null>`(${communications.payload}->'rendered'->>'subject')`,
    }).from(communications)
      .where(and(eq(communications.tenantId, tenantId), eq(communications.investorId, investorId), eq(communications.channel, "email")))
      .orderBy(desc(communications.createdAt)).limit(300);
    optional.emails = {
      title: `Emails (${rows.length})`,
      table: {
        heads: ["Date", "Subject", "Template", "Direction", "Status", "Opened"],
        rows: rows.map((r) => [fmtD(r.sentAt ?? r.createdAt), dash(r.subject), r.templateKey ? words(r.templateKey) : "—", words(r.direction), statusCell(r.status), r.readAt ? fmtD(r.readAt) : "—"]),
        widths: [0.13, 0.33, 0.2, 0.1, 0.12, 0.12], empty: "No emails to or from this client.",
      },
    };
  }

  if (want("gifts")) {
    const rows = (await tx.execute(sql`
      SELECT occasion, title, amount, given_on, notes
        FROM client_gifts
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid
       ORDER BY given_on DESC LIMIT 300
    `)).rows as Array<{ occasion: string | null; title: string | null; amount: number | string | null; given_on: string | Date | null; notes: string | null }>;
    const spent = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);
    optional.gifts = {
      title: `Gifts (${rows.length}) · total ${inr(spent)}`,
      table: {
        heads: ["Date", "Occasion", "Gift", "Value", "Notes"],
        rows: rows.map((r) => [fmtD(typeof r.given_on === "string" ? r.given_on.slice(0, 10) : r.given_on), words(r.occasion), dash(r.title), inr(r.amount), dash(r.notes)]),
        widths: [0.14, 0.15, 0.27, 0.12, 0.32], align: ["l", "l", "l", "r", "l"], empty: "No gifts recorded for this client.",
      },
    };
  }

  /* ── Notes ── */
  const noteRows = await loadRecordNotes(tx, tenantId, { type: "investor", id: investorId });
  const notes = noteRows.map((n) => ({ by: n.meta ? String(n.meta) : "", at: fmtDT(n.at), title: n.title, text: n.body ?? "" }));

  return {
    generatedAt: new Date().toISOString(),
    refId: investorId.slice(0, 8).toUpperCase(),
    brand: {
      displayName: t?.displayName ?? null, legalName: t?.legalName ?? null, arn: t?.arn ?? null,
      primaryColor: t?.primaryColor ?? null, secondaryColor: t?.secondaryColor ?? null, logoUrl: t?.logoUrl ?? null,
    },
    client: {
      name: inv.name, pan, status: words(inv.status), typeLabel: inv.investorCategory ? clientTypeLabel(inv.investorCategory) : "Client",
      since: inv.onboardedAt ? fmtD(inv.onboardedAt) : null, rm: rmName, branch: branchName, family: familyName,
      aum: showAum ? Number(inv.aum ?? 0) : null, sipBook: showSip ? Number(inv.activeSipAmount ?? 0) : null,
    },
    master: { identity, contact, profile, compliance, bank, secondHolder, lifetime },
    nominees, referrals, risk, portfolio, fds, crossSell, review, optional, notes, available,
  };
}

/** Broad asset class from a scheme name — the same words the rest of the CRM uses. */
function assetClass(name: string | null | undefined): string {
  const n = (name ?? "").toLowerCase();
  if (/gold|silver/.test(n)) return "Gold";
  if (/liquid|overnight|money market|ultra short|low duration|short duration|medium duration|long duration|gilt|bond|debt|credit risk|corporate bond|banking & psu|floater|dynamic bond/.test(n)) return "Debt";
  if (/hybrid|balanced|arbitrage|multi asset|equity savings|asset allocation|retirement|children/.test(n)) return "Hybrid";
  return "Equity";
}

/** For the popup: what each optional section holds, so the person sees what ticking it adds. */
export async function countClientMasterSections(
  tx: Tx,
  session: SessionUser,
  investorId: string,
): Promise<{ counts: Record<OptionalKey, number>; available: Record<OptionalKey, boolean>; name: string } | null> {
  const inv = await loadViewableInvestor(tx, session, investorId);
  if (!inv) return null;
  const tenantId = session.tenantId;
  const n = async (q: ReturnType<typeof sql>): Promise<number> => Number(((await tx.execute(q)).rows[0] as { n?: number } | undefined)?.n ?? 0);
  const counts: Record<OptionalKey, number> = {
    meetings: await n(sql`SELECT count(*)::int AS n FROM review_meetings WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid`),
    serviceRequests: await n(sql`SELECT count(*)::int AS n FROM service_requests WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid`),
    tasks: await n(sql`SELECT count(*)::int AS n FROM tasks WHERE tenant_id = ${tenantId}::uuid AND (related_investor_id = ${investorId}::uuid OR (subject_type = 'investor' AND subject_id = ${investorId}::uuid))`),
    emails: await n(sql`SELECT count(*)::int AS n FROM communications WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid AND channel = 'email'`),
    gifts: await n(sql`SELECT count(*)::int AS n FROM client_gifts WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${investorId}::uuid`),
  };
  const roles = session.roles;
  const p = session.permissions;
  const available: Record<OptionalKey, boolean> = {
    meetings: can(roles, "review_meeting.manage.all", p) || can(roles, "review_meeting.manage.assigned", p),
    serviceRequests: can(roles, "service_request.view.all", p) || can(roles, "service_request.view.assigned", p) || can(roles, "service_request.manage", p),
    tasks: can(roles, "task.view.all", p) || can(roles, "task.view.assigned", p),
    emails: true,
    gifts: true,
  };
  return { counts, available, name: inv.name };
}
