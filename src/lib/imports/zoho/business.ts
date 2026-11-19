/**
 * A Zoho "MF Transaction" export — the parent sheet plus its two subforms,
 * "SIP and SIP Stop" and "Purchase and Redemption" — into Business Entries.
 * Pure; tested in tests/zoho-import.test.ts.
 *
 * Decisions (We Care Freedom Wealth, 2026-11-18):
 *  - One entry per MF Transaction (MFT number) and product; lines from both
 *    subforms. A subform row finds its parent by the MFT number ("Parent ID").
 *  - Zoho's own values keep their label (lib/business/zoho-types.ts) and count
 *    the way Zoho's totals counted them.
 *  - A line Zoho marked Rejected is kept but never counts (type "other", label
 *    "<type> (rejected)").
 *  - SIP Pause is kept as a line that does not count.
 *  - SIF / AIF / PMS rows become their own entry of that product.
 */

import { ZOHO_TYPES } from "@/lib/business/zoho-types";
import { cell, isoDate, zohoId } from "./values";

export type Product = "mutual_fund" | "sif" | "aif" | "pms" | "direct_equity";
export type AssetClass = "equity" | "debt" | "liquid" | "hybrid" | "gold" | "other";

export type PlannedLine = {
  schemeName: string;
  txnType: "sip" | "sip_stop" | "lumpsum" | "switch" | "stp" | "swp" | "redemption" | "other";
  typeLabel: string | null;
  amount: number;
  assetClass: AssetClass | null;
  fromSchemeName: string | null;
  fromAssetClass: AssetClass | null;
  frequency: "monthly" | "weekly" | null;
  sipDate: string | null;
  notes: string | null;
  /** Lines the registrar will never show as a purchase/redemption of ours. */
  rtaNotApplicable: string | null;
  /** Zoho's own "Type" on the line (Liquid / Equity / Liquid to Equity …). */
  sourceType?: string | null;
  /** Zoho's own "Purchase/Redemption" on the line. */
  sourceKind?: string | null;
};

export type PlannedEntry = {
  mft: string;
  product: Product;
  ownerText: string;
  clientZohoId: string;
  clientName: string;
  businessDate: string | null;
  platform: string | null;
  notes: string;
  lines: PlannedLine[];
};

export type BusinessPlan = {
  entries: PlannedEntry[];
  skipped: Array<{ mft: string; reason: string }>;
  /** Zoho's own totals over the parents, to compare with what the CRM will count. */
  zohoTotals: { purchase: number; redemption: number; sipAdded: number; sipStop: number };
  orphanLines: number;
};

export const BUSINESS_SHEETS = {
  parent: ["MF Transaction Name", "MF Transaction Owner"],
  sip: ["Parent ID", "SIP Amount", "Type"],
  purchase: ["Parent ID", "Purchase/Redemption"],
};

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const has = (labels: string, l: string) => labels.toLowerCase() === l.toLowerCase();
const zoho = (label: string) => ZOHO_TYPES.find((t) => t.label.toLowerCase() === label.toLowerCase())?.label ?? label;

const STANDARD_NAME: Record<string, string> = {
  sip: "SIP", sip_stop: "SIP Stop", lumpsum: "Purchase", switch: "Switch", stp: "STP", swp: "SWP", redemption: "Redemption", other: "Other",
};

function rejected(line: PlannedLine): PlannedLine {
  const name = line.typeLabel ?? STANDARD_NAME[line.txnType] ?? "Line";
  return {
    ...line,
    txnType: "other",
    typeLabel: `${name} (rejected)`.slice(0, 60),
    rtaNotApplicable: "Rejected in Zoho",
    notes: ["Rejected in Zoho", line.notes].filter(Boolean).join(" · "),
  };
}

function assetFromZoho(type: string): AssetClass | null {
  if (/^liquid$/i.test(type)) return "liquid";
  if (/^equity$/i.test(type)) return "equity";
  return null;
}

/** One "Purchase and Redemption" subform row. */
export function mapPurchaseRow(r: Record<string, unknown>): { product: Product; line: PlannedLine } {
  const g = (c: string) => cell(r[c]);
  const kind = g("Purchase/Redemption");
  const type = g("Type");
  const options = g("Options");
  const scheme = g("Scheme") || "Scheme not recorded";
  const toScheme = g("To Scheme");
  const pa = num(r["Purchase Amount"]);
  const ra = num(r["Redemption Amount"]);
  const stpAmt = num(r["STP/SWP Amount"]);
  // "Direct Equity" (Smallcase, RSP …) comes from We Care's Direct Equity module, written in this shape.
  const product: Product = has(kind, "SIF") ? "sif" : has(kind, "AIF") ? "aif" : has(kind, "PMS") ? "pms" : has(kind, "Direct Equity") ? "direct_equity" : "mutual_fund";
  const remarks = g("Remarks");
  const status = g("Status");
  const liquidToEquity = /liquid\s*to\s*equity/i.test(type);

  let line: PlannedLine = {
    schemeName: scheme.slice(0, 250),
    txnType: "lumpsum",
    typeLabel: null,
    amount: pa || ra,
    assetClass: product === "mutual_fund" ? assetFromZoho(type) : product === "aif" ? "other" : "equity",
    fromSchemeName: null,
    fromAssetClass: null,
    frequency: null,
    sipDate: null,
    notes: [remarks, status && !/reject/i.test(status) ? `Zoho status: ${status}` : ""].filter(Boolean).join(" · ") || null,
    rtaNotApplicable: null,
    sourceType: type || (product !== "mutual_fund" ? zoho(kind) : null),
    sourceKind: kind ? zoho(kind) : pa ? "Purchase" : ra ? "Redemption" : null,
  };

  if (/stp/i.test(options)) {
    line = {
      ...line,
      txnType: "stp",
      schemeName: (toScheme || scheme).slice(0, 250),
      fromSchemeName: toScheme ? scheme : null,
      assetClass: liquidToEquity ? "equity" : line.assetClass,
      fromAssetClass: liquidToEquity ? "liquid" : null,
      frequency: /monthly/i.test(options) ? "monthly" : "weekly",
      amount: stpAmt || pa || ra,
      notes: [options, line.notes].filter(Boolean).join(" · "),
    };
  } else if (/^switch$/i.test(options)) {
    line = {
      ...line,
      txnType: "switch",
      schemeName: (toScheme || scheme).slice(0, 250),
      fromSchemeName: toScheme ? scheme : null,
      assetClass: liquidToEquity ? "equity" : line.assetClass,
      fromAssetClass: liquidToEquity ? "liquid" : null,
    };
  } else if (/^swp$/i.test(options)) {
    line = { ...line, txnType: "swp", amount: stpAmt || ra || pa };
  } else if (has(kind, "Red. Done by Client") || has(kind, "Transfer Out from Our Code")) {
    line = { ...line, txnType: "redemption", typeLabel: zoho(kind), amount: ra || pa, rtaNotApplicable: `${zoho(kind)} (Zoho)` };
  } else if (has(kind, "Broker Code Change in Our Code")) {
    line = { ...line, txnType: "lumpsum", typeLabel: zoho(kind), amount: pa || ra, rtaNotApplicable: `${zoho(kind)} (Zoho)` };
  } else if (has(kind, "Switch In Our Code")) {
    line = { ...line, txnType: "switch", typeLabel: zoho(kind), amount: pa || ra, rtaNotApplicable: `${zoho(kind)} (Zoho)` };
  } else if (has(kind, "Redemption") || (!pa && ra)) {
    line = { ...line, txnType: "redemption", amount: ra || pa };
  } else if (liquidToEquity) {
    // Parked in liquid to move into equity later.
    line = { ...line, assetClass: "liquid", notes: ["Liquid to Equity", line.notes].filter(Boolean).join(" · ") };
  }
  if (/reject/i.test(status)) line = rejected(line);
  return { product, line };
}

/** One "SIP and SIP Stop" subform row. */
export function mapSipRow(r: Record<string, unknown>): PlannedLine {
  const g = (c: string) => cell(r[c]);
  const type = g("Type");
  const amt = num(r["SIP Amount"]);
  const stopAmt = num(r["SIP Stop/Pause Amount"]);
  const day = Math.trunc(num(r["Auto Debit Date"]));
  const start = isoDate(r["Auto Start Date"]);
  const status = g("Status");
  const notes = [
    start ? `Starts ${start.split("-").reverse().join("-")}` : "",
    day > 28 ? `Debit day ${day}` : "",
    status && !/reject/i.test(status) ? `Zoho status: ${status}` : "",
  ];
  let line: PlannedLine = {
    schemeName: (g("Scheme Name") || "Scheme not recorded").slice(0, 250),
    txnType: "sip",
    typeLabel: null,
    amount: amt || stopAmt,
    assetClass: null,
    fromSchemeName: null,
    fromAssetClass: null,
    frequency: "monthly",
    sipDate: day >= 1 && day <= 28 ? String(day) : null,
    notes: null,
    rtaNotApplicable: null,
  };
  if (/^daily\s*sip$/i.test(type)) line = { ...line, typeLabel: "Daily SIP" };
  else if (/^sip\s*auto\s*stop$/i.test(type)) line = { ...line, txnType: "sip_stop", typeLabel: "SIP Auto Stop", amount: stopAmt || amt, sipDate: null };
  else if (/^sip\s*stop$/i.test(type)) line = { ...line, txnType: "sip_stop", amount: stopAmt || amt, sipDate: null };
  else if (/^sip\s*pause$/i.test(type)) {
    const months = Math.trunc(num(r["SIP Pause (Months)"]));
    line = { ...line, txnType: "other", typeLabel: "SIP Pause", amount: stopAmt || amt, sipDate: null, rtaNotApplicable: "SIP Pause (Zoho)" };
    notes.unshift(months ? `Paused ${months} month${months === 1 ? "" : "s"}` : "Paused");
  }
  line.notes = notes.filter(Boolean).join(" · ") || null;
  if (/reject/i.test(status)) line = rejected(line);
  return line;
}

/** Which sheet is which, by its columns. */
export function identifySheets(sheets: Record<string, Record<string, unknown>[]>, headers: Record<string, string[]>) {
  const find = (need: string[], not: string[] = []) =>
    Object.keys(headers).find((n) => need.every((h) => headers[n].includes(h)) && !not.some((h) => headers[n].includes(h)));
  const parent = find(BUSINESS_SHEETS.parent);
  const purchase = find(BUSINESS_SHEETS.purchase);
  const sip = find(BUSINESS_SHEETS.sip, ["Purchase/Redemption"]);
  return { parent: parent ? sheets[parent] : null, sip: sip ? sheets[sip] : [], purchase: purchase ? sheets[purchase] : [], names: { parent, sip, purchase } };
}

export function planBusiness(parents: Record<string, unknown>[], sipRows: Record<string, unknown>[], purchaseRows: Record<string, unknown>[]): BusinessPlan {
  const plan: BusinessPlan = { entries: [], skipped: [], zohoTotals: { purchase: 0, redemption: 0, sipAdded: 0, sipStop: 0 }, orphanLines: 0 };
  const byMft = new Map<string, Record<string, unknown>>();
  const mftOfId = new Map<string, string>();
  for (const p of parents) {
    const mft = cell(p["MF Transaction Name"]);
    if (!mft) continue;
    byMft.set(mft, p);
    mftOfId.set(zohoId(p["Record Id"]), mft);
    plan.zohoTotals.purchase += num(p["Total Purchase"]);
    plan.zohoTotals.redemption += num(p["Total Redemption"]);
    plan.zohoTotals.sipAdded += num(p["SIP Added"]);
    plan.zohoTotals.sipStop += num(p["SIP Stop"]);
  }

  const linesOf = new Map<string, Array<{ product: Product; line: PlannedLine }>>();
  const add = (mft: string, x: { product: Product; line: PlannedLine }) => {
    if (!byMft.has(mft)) {
      plan.orphanLines++;
      return;
    }
    if (!linesOf.has(mft)) linesOf.set(mft, []);
    linesOf.get(mft)!.push(x);
  };
  for (const r of purchaseRows) add(mftOfId.get(zohoId(r["Parent ID.id"])) ?? cell(r["Parent ID"]), mapPurchaseRow(r));
  for (const r of sipRows) add(cell(r["Parent ID"]), { product: "mutual_fund", line: mapSipRow(r) });

  for (const [mft, p] of byMft) {
    const g = (c: string) => cell(p[c]);
    const lines = linesOf.get(mft) ?? [];
    // PMS / SIF on the parent only, when the record has no subform line at all.
    if (!lines.length) {
      const base = { typeLabel: null, fromSchemeName: null, fromAssetClass: null, frequency: null, sipDate: null, notes: null, rtaNotApplicable: null } as const;
      if (num(p["PMS Amount"])) lines.push({ product: "pms", line: { ...base, schemeName: g("PMS Scheme") || "PMS", txnType: "lumpsum", amount: num(p["PMS Amount"]), assetClass: "equity" } });
      if (num(p["PMS Redemption"])) lines.push({ product: "pms", line: { ...base, schemeName: g("PMS Scheme") || "PMS", txnType: "redemption", amount: num(p["PMS Redemption"]), assetClass: "equity" } });
      if (num(p["SIF Amount"])) lines.push({ product: "sif", line: { ...base, schemeName: g("SIF Scheme") || "SIF", txnType: "lumpsum", amount: num(p["SIF Amount"]), assetClass: "equity" } });
    }
    if (!lines.length) {
      plan.skipped.push({ mft, reason: "No scheme lines on the Zoho record" });
      continue;
    }
    const businessDate = isoDate(p["Date"]);
    if (!businessDate) {
      plan.skipped.push({ mft, reason: "No date on the Zoho record" });
      continue;
    }
    const notes = [
      `Zoho ${mft}`,
      g("Transaction Type"),
      g("Associate Name") ? `Associate: ${g("Associate Name")}` : "",
      g("Remarks"),
    ].filter(Boolean).join(" · ").slice(0, 4000);
    const byProduct = new Map<Product, PlannedLine[]>();
    for (const x of lines) {
      if (!byProduct.has(x.product)) byProduct.set(x.product, []);
      byProduct.get(x.product)!.push(x.line);
    }
    for (const [product, ls] of byProduct) {
      plan.entries.push({
        mft,
        product,
        ownerText: g("MF Transaction Owner"),
        clientZohoId: zohoId(p["Client Name.id"]),
        clientName: g("Client Name"),
        businessDate,
        platform: g("Transact Through") || null,
        notes,
        lines: ls,
      });
    }
  }
  return plan;
}

/** The dedupe key an imported entry carries: its MFT number in notes + its product. */
export const entryKey = (mft: string, product: string) => `${mft}|${product}`;
