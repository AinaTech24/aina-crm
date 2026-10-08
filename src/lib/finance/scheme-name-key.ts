/**
 * A registrar's scheme name as a key that matches AMFI's name for the same
 * scheme. Pure; shared by the NAV resolver and its tests.
 *
 * The registrars and AMFI write one scheme many ways:
 *   "HDFC Large & Mid Cap Fund - Regular Plan - Growth"   (CAMS)
 *   "Kotak Arbitrage Fund - Growth (Regular Plan)"        (word order)
 *   "Kotak Multicap Fund-Regular Plan-Growth"             ("Multi Cap")
 *   "UTI Flexi Cap Fund - Regular Plan"                   (KFintech: no option = Growth)
 *   "ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Regular Plan - Growth" (AMFI)
 * and AMFI often leaves "Regular" out of a regular plan's name while it always
 * says "Direct". So the key is the set of meaningful words — fund-house renames
 * folded, "& / and / fund / plan / option" dropped, "XX cap" joined, "dividend"
 * read as IDCW, "(formerly …)" brackets removed — with "regular" removed and
 * "direct" kept apart as the one plan word that matters.
 */

const DROP = new Set([
  "fund", "funds", "plan", "option", "options", "scheme", "the", "of", "an", "a", "and", "mutual", "mf",
  "regular", "reg", "rp", "opt", "open", "ended", "series", "appreciation",
  // Payout and reinvestment of one IDCW option share one NAV; a candidate
  // list that still differs in NAV is refused by the resolver anyway.
  "payout", "reinvest", "periodic",
]);
// Fund houses that changed name: the registrar's history keeps the old one.
const HOUSE: Array<[RegExp, string]> = [
  [/\breliance\b/g, "nippon india"],
  [/\bidfc\b/g, "bandhan"],
  [/\babsl\b/g, "aditya birla sun life"],
  [/\b(?<!aditya )birla sun life\b/g, "aditya birla sun life"],
  [/\bprincipal\b/g, "sundaram"],
  [/\bl\s*(?:and\s*)?t\b/g, "hsbc"],
  [/\bmiraeasset\b/g, "mirae asset"],
];
const WORD: Record<string, string> = {
  dividend: "idcw", div: "idcw",
  reinvestment: "reinvest", reinv: "reinvest", reinvst: "reinvest",
  gr: "growth", cumulative: "growth", dir: "direct",
};
const OPTION_WORDS = new Set(["growth", "idcw", "bonus", "payout", "reinvest"]);

export type SchemeKey = { tokens: string; direct: boolean };

export function schemeNameKey(raw: string | null | undefined): SchemeKey | null {
  let s = String(raw ?? "").toLowerCase();
  // "(formerly …)", "(erstwhile …)", "(scheme has two segregated portfolios)":
  // drop the bracket only — AMFI writes the plan and option AFTER it. A
  // bracket the registrar cut off before closing runs to the end.
  s = s.replace(/\([^()]*\b(formerly|erstwhile|earlier|previously|segregated)\b[^()]*(\)|$)/g, " ");
  s = s.replace(/\b(formerly|erstwhile)\b.*$/, " ");
  s = s.replace(/'/g, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  for (const [re, to] of HOUSE) s = s.replace(re, to);
  // "multi cap" / "mid cap" / "flexi cap" … are written both ways.
  s = s.replace(/\b(multi|mid|small|large|flexi|micro|focused)\s+cap\b/g, "$1cap");
  s = s.replace(/\bpay\s+out\b/g, "payout");
  s = s.replace(/\bincome distribution (cum )?capital withdrawal\b/g, "idcw");
  const toks = new Set<string>();
  let direct = false;
  for (const w0 of s.split(/\s+/).filter(Boolean)) {
    const w = WORD[w0] ?? w0;
    if (w === "direct") { direct = true; continue; }
    if (DROP.has(w)) continue;
    toks.add(w);
  }
  if (!toks.size) return null;
  // No option word at all means the Growth option.
  if (![...toks].some((t) => OPTION_WORDS.has(t))) toks.add("growth");
  return { tokens: [...toks].sort().join(" "), direct };
}
