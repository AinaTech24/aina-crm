/**
 * A scheme's asset class and category, from the AMFI category the CRM holds
 * for it (scheme_nav.scheme_category: "Equity Scheme - Large Cap Fund") or,
 * failing that, the category text the registrar file carried. Pure — the
 * AUM treemap (getAssetClassMix) and its test use it.
 */

export const ASSET_CLASSES = ["Equity", "Hybrid", "Debt", "Solution oriented", "Other", "Category not recorded"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

const tidy = (s: string) =>
  s.replace(/\s+/g, " ").replace(/\b(fund|funds|scheme|schemes)\b/gi, "").replace(/\s+/g, " ").replace(/^[\s-]+|[\s-]+$/g, "").trim();

export function classifyScheme(category: string | null | undefined): { assetClass: AssetClass; category: string } {
  const raw = (category ?? "").trim();
  if (!raw) return { assetClass: "Category not recorded", category: "Not recorded" };
  // AMFI: "<Class> Scheme - <Category>"
  const m = /^(equity|debt|hybrid|solution oriented|other)\s+schemes?\s*-\s*(.+)$/i.exec(raw);
  if (m) {
    const cls = m[1].toLowerCase();
    const assetClass: AssetClass = cls === "equity" ? "Equity" : cls === "debt" ? "Debt" : cls === "hybrid" ? "Hybrid"
      : cls === "solution oriented" ? "Solution oriented" : "Other";
    return { assetClass, category: tidy(m[2]) || tidy(raw) };
  }
  // Registrar free text: decide by the words it uses.
  const t = raw.toLowerCase();
  const cat = tidy(raw.replace(/^(equity|debt|hybrid)\s*[-:]\s*/i, "")) || tidy(raw);
  if (/hybrid|balanced|arbitrage|asset allocation|multi asset|equity savings/.test(t)) return { assetClass: "Hybrid", category: cat };
  if (/elss|equity|large|mid|small|flexi|multi cap|focused|value|contra|dividend yield|sectoral|thematic/.test(t)) return { assetClass: "Equity", category: cat };
  if (/debt|liquid|gilt|income|bond|money market|overnight|duration|credit|banking and psu|floater|ultra short|low duration/.test(t)) return { assetClass: "Debt", category: cat };
  if (/retirement|children/.test(t)) return { assetClass: "Solution oriented", category: cat };
  return { assetClass: "Other", category: cat };
}
