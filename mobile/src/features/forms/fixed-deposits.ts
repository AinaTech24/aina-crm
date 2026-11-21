/**
 * Fixed deposit — record one receipt (POST /api/fixed-deposits), edit it
 * (?editId=), or renew one (?renew=<id> with its terms carried over in the
 * URL: the new row carries renewedFromId and the server marks the old one
 * renewed). ?investorId=&name= starts it for that client.
 *
 * The tenure and the maturity date stay in step (either can be typed); the
 * maturity amount is computed the CRM's way unless the receipt's is typed.
 * The interest payout date follows the deposit, maturity and payout choice
 * (firstPayoutDate) until a date of the person's own is picked (the CRM's
 * FdForm, 2026-11-17).
 */

import type { FormSpec, FormValues } from "./types";
import {
  ISSUER_TYPE_LABELS, PAYOUT_LABELS, COMPOUNDING_LABELS, HOLDING_LABELS, TAX_FORM_LABELS, STATUS_LABELS,
  options, maturityDateFor, tenureBetween, computeMaturity, indiaToday, tenureLabel, firstPayoutDate,
} from "../fixed-deposits/terms";
import { inr } from "../../lib/format";
import { clientPickerLine } from "../investors/picker";
import { clientNameById } from "./pickers";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const u = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: any) => {
  const x = parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : null;
};
const int = (v: any) => Math.max(0, Math.round(n(v) ?? 0));
const str = (v: any) => (v == null ? "" : String(v));

/** Commission at rate × amount — what the web records when no amount is typed. */
function commissionEstimate(f: FormValues): number | null {
  const rate = n(f.commissionRate), p = n(f.principal);
  return rate != null && p != null && p > 0 ? Math.round(p * rate) / 100 : null;
}

function figures(f: FormValues) {
  return computeMaturity({
    principal: n(f.principal) ?? 0, rate: n(f.interestRate) ?? -1,
    depositDate: f.depositDate, maturityDate: f.maturityDate, payout: f.payout, compounding: f.compounding,
  });
}

export const fixedDepositForm: FormSpec = {
  title: "Record a fixed deposit",
  editTitle: "Edit fixed deposit",
  endpoint: "/api/fixed-deposits",
  submitLabel: "Save deposit",
  invalidate: ["fixed-deposits", "fixed-deposit", "client-opportunities", "investor-full"],
  editRecordEnvelope: "fixedDeposit",

  initial: (p) => {
    const depositDate = DAY.test(p.depositDate ?? "") ? p.depositDate! : indiaToday();
    // A renewal keeps the old deposit's tenure (months + days); a new one starts at a year.
    const keep = !!p.renew && (int(p.tenureMonths) > 0 || int(p.tenureDays) > 0);
    const months = keep ? int(p.tenureMonths) : 12;
    const days = keep ? int(p.tenureDays) : 0;
    const maturityDate = maturityDateFor(depositDate, months, days);
    const payout = p.payout ?? "cumulative";
    const interestPayoutDate = firstPayoutDate(depositDate, maturityDate, payout);
    return {
      _edit: "",
      investorId: p.investorId ?? "",
      _investorName: p.name ?? "",
      renewedFromId: p.renew ?? "",
      issuer: p.issuer ?? "",
      issuerType: p.issuerType ?? "bank",
      schemeName: p.schemeName ?? "",
      fdNumber: "",
      depositDate,
      tenureMonths: String(months),
      tenureDays: String(days),
      maturityDate,
      _tk: `${depositDate}|${months}|${days}`,
      _mk: maturityDate,
      principal: p.principal ?? "",
      interestRate: p.interestRate ?? "",
      payout,
      compounding: p.compounding ?? "quarterly",
      interestPayoutDate,
      _pk: interestPayoutDate,
      _pt: "",
      maturityAmount: "",
      holding: p.holding ?? "single",
      jointHolders: p.jointHolders ?? "",
      nomineeName: p.nomineeName ?? "",
      seniorCitizen: p.seniorCitizen === "1",
      taxForm: p.taxForm ?? "none",
      autoRenew: p.autoRenew === "1",
      status: "active",
      closedOn: "",
      commissionRate: "",
      commissionAmount: "",
      remarks: "",
    };
  },

  // Tenure ⇄ maturity date: whichever was changed last decides the other.
  // Then the interest payout date follows them (and the payout choice) until
  // the person picks a date of their own (_pt), as on the web form.
  derive: (v) => {
    const out: FormValues = {};
    if (DAY.test(v.depositDate ?? "")) {
      const key = `${v.depositDate}|${int(v.tenureMonths)}|${int(v.tenureDays)}`;
      if (key !== v._tk) {
        const maturityDate = maturityDateFor(v.depositDate, int(v.tenureMonths), int(v.tenureDays));
        Object.assign(out, { maturityDate, _tk: key, _mk: maturityDate });
      } else if (v.maturityDate !== v._mk && DAY.test(v.maturityDate ?? "") && v.maturityDate > v.depositDate) {
        const t = tenureBetween(v.depositDate, v.maturityDate);
        Object.assign(out, { tenureMonths: String(t.months), tenureDays: String(t.days), _tk: `${v.depositDate}|${t.months}|${t.days}`, _mk: v.maturityDate });
      }
    }
    const cur = { ...v, ...out };
    if (!cur._pt) {
      if ((cur.interestPayoutDate ?? "") !== (cur._pk ?? "")) {
        out._pt = "1"; // picked by hand — never moved again
      } else {
        const next = firstPayoutDate(cur.depositDate ?? "", cur.maturityDate ?? "", cur.payout);
        if (next !== (cur.interestPayoutDate ?? "")) Object.assign(out, { interestPayoutDate: next, _pk: next });
      }
    }
    return Object.keys(out).length ? out : null;
  },

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v._edit && !v.investorId) e.investorId = "Pick the client";
    if (!v.issuer?.trim()) e.issuer = "Enter the bank or company";
    if (!(n(v.principal)! > 0)) e.principal = "Enter the amount deposited";
    const r = n(v.interestRate);
    if (r == null || r < 0 || r > 30) e.interestRate = "Enter the interest rate (0–30%)";
    if (!DAY.test(v.depositDate ?? "")) e.depositDate = "Pick the deposit date";
    if (!DAY.test(v.maturityDate ?? "") || v.maturityDate <= v.depositDate) e.maturityDate = "Maturity must be after the deposit date";
    if (v.interestPayoutDate && DAY.test(v.depositDate ?? "") && DAY.test(v.maturityDate ?? "")
      && (v.interestPayoutDate < v.depositDate || v.interestPayoutDate > v.maturityDate)) {
      e.interestPayoutDate = "Must fall between the deposit and maturity dates";
    }
    const typed = n(v.maturityAmount);
    if (v.payout === "cumulative" && typed && typed < (n(v.principal) ?? 0)) e.maturityAmount = "The maturity amount cannot be less than the amount deposited";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Client",
      fields: [
        { key: "_investorName", label: "Client", type: "readonly", visibleIf: (v) => !!v._investorName && !v._edit },
        {
          key: "investorId", label: "Client", type: "typeahead", required: true, searchEndpoint: "/api/search", searchEnvelope: "investors",
          searchLabel: (i) => i.name, searchSublabel: clientPickerLine, searchInitialLabel: clientNameById, placeholder: "Search a client by name, PAN, mobile…",
          visibleIf: (v) => !v._investorName && !v._edit,
        },
      ],
    },
    {
      title: "Deposit",
      fields: [
        { key: "issuer", label: "Bank / company", required: true, placeholder: "e.g. HDFC Bank, Bajaj Finance" },
        { key: "issuerType", label: "Issuer type", type: "select", options: options(ISSUER_TYPE_LABELS) },
        { key: "schemeName", label: "Scheme (optional)" },
        { key: "fdNumber", label: "FD / receipt number" },
        { key: "principal", label: "Amount deposited (₹)", type: "number", required: true },
        { key: "interestRate", label: "Interest rate (% a year)", type: "number", required: true },
        { key: "depositDate", label: "Deposit date", type: "date", required: true },
        { key: "tenureMonths", label: "Tenure — months", type: "number" },
        { key: "tenureDays", label: "Tenure — days", type: "number" },
        { key: "maturityDate", label: "Maturity date", type: "date", required: true },
        { key: "payout", label: "Interest", type: "select", options: options(PAYOUT_LABELS) },
        {
          key: "interestPayoutDate", label: "Interest payout date (optional)", type: "date",
          help: "The first interest payment of a payout FD; a cumulative FD pays on the maturity date. Change it if the receipt shows another.",
        },
        { key: "compounding", label: "Compounding", type: "select", options: options(COMPOUNDING_LABELS), visibleIf: (v) => v.payout === "cumulative" },
        {
          key: "_figures", label: "Computed", type: "readonly",
          format: (_x, f) => {
            const m = figures(f);
            if (!m) return "Enter the amount, rate and dates";
            const tenure = tenureLabel(int(f.tenureMonths), int(f.tenureDays));
            // The receipt's figure, when typed (and not below the deposit), wins — as on the web.
            const receipt = n(f.maturityAmount);
            const P = n(f.principal) ?? 0;
            if (f.payout === "cumulative" && receipt && receipt >= P) return `${inr(receipt)} at maturity (receipt) · interest ${inr(receipt - P)} · ${tenure}`;
            return f.payout === "cumulative"
              ? `${inr(m.maturityAmount)} at maturity · interest ${inr(m.interest)} · ${tenure}`
              : `${inr(m.periodicInterest)} a payout · interest ${inr(m.interest)} · ${tenure}`;
          },
        },
        { key: "maturityAmount", label: "Maturity amount on the receipt (₹, optional)", type: "number", help: "Leave blank to use the computed amount.", visibleIf: (v) => v.payout === "cumulative" },
      ],
    },
    {
      title: "Holder & tax",
      fields: [
        { key: "holding", label: "Holding", type: "select", options: options(HOLDING_LABELS) },
        { key: "jointHolders", label: "Joint holders", visibleIf: (v) => v.holding !== "single" },
        { key: "nomineeName", label: "Nominee" },
        { key: "seniorCitizen", label: "Senior citizen rate", type: "switch" },
        { key: "taxForm", label: "Form 15G / 15H", type: "select", options: options(TAX_FORM_LABELS) },
        { key: "autoRenew", label: "Auto-renews at maturity", type: "switch" },
      ],
    },
    {
      title: "Status",
      fields: [
        { key: "status", label: "Status", type: "select", options: options(STATUS_LABELS), help: "Applied = form submitted, receipt not yet issued." },
        { key: "closedOn", label: "Closed on", type: "date", maxToday: true, visibleIf: (v) => v._edit === "1" && ["closed_early", "matured", "cancelled"].includes(v.status) },
      ],
    },
    {
      title: "Other",
      fields: [
        { key: "commissionRate", label: "Commission rate (%)", type: "number" },
        { key: "commissionAmount", label: "Commission amount (₹, optional)", type: "number", help: "Leave blank to record rate × amount." },
        { key: "remarks", label: "Remarks", type: "textarea" },
      ],
    },
  ],

  buildBody: (f) => ({
    ...(f._edit ? {} : { investorId: f.investorId, renewedFromId: f.renewedFromId || null }),
    issuer: f.issuer.trim(),
    issuerType: f.issuerType,
    schemeName: u(f.schemeName),
    fdNumber: u(f.fdNumber),
    depositDate: f.depositDate,
    maturityDate: f.maturityDate,
    tenureMonths: int(f.tenureMonths),
    tenureDays: int(f.tenureDays),
    principal: n(f.principal),
    interestRate: n(f.interestRate),
    payout: f.payout,
    compounding: f.compounding,
    interestPayoutDate: DAY.test(f.interestPayoutDate ?? "") ? f.interestPayoutDate : null,
    // The receipt's amount is a cumulative FD's figure; a payout FD returns the principal.
    maturityAmount: f.payout === "cumulative" ? n(f.maturityAmount) || null : null,
    holding: f.holding,
    jointHolders: f.holding === "single" ? null : u(f.jointHolders),
    nomineeName: u(f.nomineeName),
    seniorCitizen: !!f.seniorCitizen,
    taxForm: f.taxForm,
    autoRenew: !!f.autoRenew,
    status: f.status,
    ...(f._edit ? { closedOn: u(f.closedOn) } : {}),
    commissionRate: n(f.commissionRate),
    commissionAmount: n(f.commissionAmount) ?? commissionEstimate(f),
    remarks: u(f.remarks),
  }),

  editInitial: (r) => ({
    _edit: "1",
    investorId: r.investorId,
    _investorName: "",
    renewedFromId: "",
    issuer: str(r.issuer),
    issuerType: r.issuerType ?? "bank",
    schemeName: str(r.schemeName),
    fdNumber: str(r.fdNumber),
    depositDate: str(r.depositDate).slice(0, 10),
    tenureMonths: str(r.tenureMonths ?? 0),
    tenureDays: str(r.tenureDays ?? 0),
    maturityDate: str(r.maturityDate).slice(0, 10),
    _tk: `${str(r.depositDate).slice(0, 10)}|${int(r.tenureMonths)}|${int(r.tenureDays)}`,
    _mk: str(r.maturityDate).slice(0, 10),
    principal: str(n(r.principal) ?? ""),
    interestRate: str(n(r.interestRate) ?? ""),
    payout: r.payout ?? "cumulative",
    compounding: r.compounding ?? "quarterly",
    // A saved payout date is the person's own; with none, the form fills one (as the web).
    interestPayoutDate: str(r.interestPayoutDate).slice(0, 10),
    _pk: "",
    _pt: r.interestPayoutDate ? "1" : "",
    // Only the receipt's own amount is shown for editing; a computed one is recomputed.
    maturityAmount: r.maturityAmountEntered && r.maturityAmount != null ? str(n(r.maturityAmount)) : "",
    holding: r.holding ?? "single",
    jointHolders: str(r.jointHolders),
    nomineeName: str(r.nomineeName),
    seniorCitizen: !!r.seniorCitizen,
    taxForm: r.taxForm ?? "none",
    autoRenew: !!r.autoRenew,
    status: r.status ?? "active",
    closedOn: str(r.closedOn).slice(0, 10),
    commissionRate: r.commissionRate != null ? str(n(r.commissionRate)) : "",
    commissionAmount: r.commissionAmount != null ? str(n(r.commissionAmount)) : "",
    remarks: str(r.remarks),
  }),

  redirect: (json) => (json?.fixedDeposit?.id ? `/m/fixed-deposits/${json.fixedDeposit.id}` : null),
};
