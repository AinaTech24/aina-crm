/**
 * How a proposal recommendation is named, labelled and added up — everywhere.
 *
 * The client's approval page, the RM's builder, the PDF, the pipeline totals
 * and the execution matcher all have to agree on what "₹15,000/mo SIP" means
 * for one line. Plain module (no "use client"), so server and client code can
 * both call it.
 */

import type { ProposalLineItem, RecommendationType } from "@/db/schema/proposals";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

/** The product's own name, whichever kind it is. */
export function itemName(item: ProposalLineItem | any): string {
  return String(
    item?.schemeName ?? item?.policyName ?? item?.strategyName ?? item?.fundName ?? item?.productName ?? "Recommendation"
  ).trim() || "Recommendation";
}

/** For MF lines: SIP unless said otherwise (the default the old form assumed). */
export function recommendationType(item: ProposalLineItem | any): RecommendationType | null {
  if (item?.kind !== "mf") return null;
  const t = item.recommendationType as RecommendationType | undefined;
  if (t === "sip" || t === "lumpsum" || t === "swp" || t === "stp") return t;
  // Older lines carry no type: a lumpsum with no monthly amount is a lumpsum.
  return num(item.lumpsum) && !num(item.monthlyAmount) ? "lumpsum" : "sip";
}

/** Short badge text: SIP / Lumpsum / SWP / STP / Insurance / PMS / AIF / Other. */
export function itemKindLabel(item: ProposalLineItem | any): string {
  const rt = recommendationType(item);
  if (rt) return { sip: "SIP", lumpsum: "Lumpsum", swp: "SWP", stp: "STP" }[rt];
  return { insurance: "Insurance", pms: "PMS", aif: "AIF", other: "Other" }[item?.kind as string] ?? "Other";
}

/** Money going in each month (SIP), or null. */
export function itemMonthly(item: ProposalLineItem | any): number | null {
  return recommendationType(item) === "sip" ? num(item.monthlyAmount) : null;
}

/** Money going in once (lumpsum, PMS, AIF, other), or null. */
export function itemOneTime(item: ProposalLineItem | any): number | null {
  const rt = recommendationType(item);
  if (rt === "lumpsum") return num(item.lumpsum);
  if (rt === "sip") return num(item.lumpsum); // a SIP may carry a starting lumpsum
  if (item?.kind === "pms" || item?.kind === "aif") return num(item.proposedAmount);
  if (item?.kind === "other") return num(item.amount);
  return null;
}

/** Money moved between schemes (STP), or null. */
export function itemTransfers(item: ProposalLineItem | any): number | null {
  if (recommendationType(item) !== "stp") return null;
  const m = num(item.monthlyTransfer), n = num(item.numInstallments);
  return m && n ? m * n : m;
}

/** One human line describing the money: "₹15,000/mo · 10% step-up". */
export function itemAmountText(item: ProposalLineItem | any): string {
  const rt = recommendationType(item);
  if (rt === "sip") {
    const m = num(item.monthlyAmount);
    const parts = [m ? `${inr(m)}/mo` : null, num(item.stepUpPct) ? `${item.stepUpPct}% step-up` : null, num(item.lumpsum) ? `+ ${inr(item.lumpsum)} now` : null];
    return parts.filter(Boolean).join(" · ") || "—";
  }
  if (rt === "lumpsum") return num(item.lumpsum) ? inr(item.lumpsum) : "—";
  if (rt === "swp") {
    const w = num(item.monthlyWithdrawal);
    return w ? `${inr(w)}/mo out${num(item.swpPeriodMonths) ? ` for ${item.swpPeriodMonths} months` : ""}` : "—";
  }
  if (rt === "stp") {
    const m = num(item.monthlyTransfer);
    return m ? `${inr(m)}${num(item.numInstallments) ? ` × ${item.numInstallments}` : "/mo"} into ${item.toSchemeName ?? "the target scheme"}` : "—";
  }
  if (item?.kind === "insurance") {
    const sa = num(item.sumAssured), pr = num(item.annualPremium);
    return [sa ? `${inr(sa)} cover` : null, pr ? `${inr(pr)}/yr premium` : null].filter(Boolean).join(" · ") || "—";
  }
  const one = itemOneTime(item);
  return one ? inr(one) : "—";
}

/** AMFI riskometer level in words, or null. */
export function itemRiskLabel(item: ProposalLineItem | any): string | null {
  const r = item?.riskRating as string | undefined;
  if (!r) return null;
  return r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Totals across a set of lines — what the builder footer and pipeline show. */
export function totals(items: Array<ProposalLineItem | any>): { monthly: number; oneTime: number; transfers: number } {
  let monthly = 0, oneTime = 0, transfers = 0;
  for (const it of items) {
    monthly += itemMonthly(it) ?? 0;
    oneTime += itemOneTime(it) ?? 0;
    transfers += itemTransfers(it) ?? 0;
  }
  return { monthly, oneTime, transfers };
}

/** One rupee figure for "how big is this proposal": a year of SIP + one-time money. */
export function proposalValue(items: Array<ProposalLineItem | any>): number {
  const t = totals(items);
  return t.monthly * 12 + t.oneTime;
}
