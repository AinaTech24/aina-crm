/**
 * What an existing client can ask for — the cross-sell vocabulary
 * (lib/investors/cross-sell.ts) plus "Other", so an opportunity and the
 * client's Cross-sell card always talk about the same products.
 *
 * The pipeline decides the journey's product branch:
 *   mf         KYC → UCC → mandate → transaction
 *   insurance  proposal form → underwriting → policy issued
 *   general    executed (NPS, FD, PMS, demat, loan, other)
 */

import { CROSS_SELL_PRODUCTS } from "@/lib/investors/cross-sell";

export type OpportunityPipeline = "mf" | "insurance" | "general";

const PIPELINE_OF: Record<string, OpportunityPipeline> = {
  mutual_funds: "mf",
  life_insurance: "insurance",
  general_insurance: "insurance",
  health_insurance: "insurance",
};

export const OPPORTUNITY_PRODUCTS: Array<{ key: string; label: string; pipeline: OpportunityPipeline }> = [
  ...CROSS_SELL_PRODUCTS.map(([key, label]) => ({ key, label, pipeline: PIPELINE_OF[key] ?? ("general" as const) })),
  { key: "other", label: "Other", pipeline: "general" },
];

export const OPPORTUNITY_PRODUCT_KEYS = OPPORTUNITY_PRODUCTS.map((p) => p.key);

export function isOpportunityProduct(v: unknown): v is string {
  return typeof v === "string" && OPPORTUNITY_PRODUCT_KEYS.includes(v);
}

export function productPipeline(product: string): OpportunityPipeline {
  return OPPORTUNITY_PRODUCTS.find((p) => p.key === product)?.pipeline ?? "general";
}

export function productLabel(product: string): string {
  return OPPORTUNITY_PRODUCTS.find((p) => p.key === product)?.label ?? product;
}

/** Is this product on the client's Cross-sell card (so won/interest can be written back)? */
export function isCrossSellProduct(product: string): boolean {
  return CROSS_SELL_PRODUCTS.some(([k]) => k === product);
}

/**
 * The proposal types that answer an opportunity for this product. A
 * comprehensive or mixed proposal can carry any product line.
 */
export function proposalTypesFor(product: string): string[] {
  const p = productPipeline(product);
  if (p === "mf") return ["mutual_fund", "mixed", "comprehensive"];
  if (p === "insurance") return ["insurance", "mixed", "comprehensive"];
  if (product === "pms") return ["pms", "mixed", "comprehensive"];
  return ["mixed", "comprehensive"];
}

/** A lead's product interest (LEAD_PRODUCTS) as an opportunity product. */
export function fromLeadProduct(v: string): string {
  switch (v) {
    case "mutual_funds": return "mutual_funds";
    case "insurance": return "life_insurance";
    case "stocks_pms_aif": return "pms";
    case "nps": return "nps";
    case "fd_bonds": return "fd_bonds_ncd";
    default: return "other";
  }
}

export const OPPORTUNITY_SOURCES = ["manual", "cross_sell", "lead_match", "review", "automation"] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];
