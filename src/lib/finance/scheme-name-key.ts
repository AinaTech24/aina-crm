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

/**
 * Registrar files reach us with the apostrophe of "Children's" in three states:
 * a plain ', a typographic ’ (U+2019) and UTF-8 bytes read as Windows-1252
 * ("â€™", or "â" plus two invisible C1 characters). Left alone the last two
 * survive as a stray "a" / "s" token — "Axis Childrenâs Fund" keyed as
 * "children s" and never met AMFI's "Children's" ("childrens"). Fold all
 * three to a plain apostrophe, which the key then drops.
 */
// Built from code points so the source stays plain ASCII (an editor or a tool
// that "helpfully" rewrites escapes would turn this into the very bytes it matches).
const cp = (...n: number[]) => String.fromCharCode(...n);
// a-circumflex (0xE2), then up to two of what UTF-8 leaves behind: C1 controls
// 0x80-0xBF, euro 0x20AC, the quote/trademark glyphs cp1252 maps them to.
const MOJIBAKE_QUOTE = new RegExp(
  cp(0xe2) + "[" + cp(0x80) + "-" + cp(0xbf) + cp(0x20ac) + cp(0x2018) + "-" + cp(0x201e) + cp(0x2122, 0x2dc, 0x153, 0x161, 0x203a) + "]{0,2}",
  "g",
);
// Typographic quotes, modifier apostrophe, acute accent, backtick.
const CURLY_QUOTE = new RegExp("[" + cp(0x2018, 0x2019, 0x201a, 0x201b, 0x2bc, 0xb4) + "`]", "g");

function foldQuotes(s: string): string {
  return s.replace(MOJIBAKE_QUOTE, "'").replace(CURLY_QUOTE, "'");
}

/**
 * The fund house's first word as the AMFI master would spell it ("Reliance
 * Large Cap" -> "nippon", "IDFC ..." -> "bandhan"), for telling one house's
 * schemes from another's.
 */
export function schemeHouse(raw: string | null | undefined): string {
  let s = foldQuotes(String(raw ?? "").toLowerCase()).replace(/'/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ");
  for (const [re, to] of HOUSE) s = s.replace(re, to);
  return s.trim().split(" ")[0] ?? "";
}

export type SchemeKey = { tokens: string; direct: boolean };

export function schemeNameKey(raw: string | null | undefined): SchemeKey | null {
  let s = String(raw ?? "").toLowerCase();
  s = foldQuotes(s);
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
  // "Dividend Yield" is a fund style (ICICI, UTI, Templeton, Aditya Birla Sun
  // Life, Tata), not the IDCW option: left alone it reads as one, suppresses the
  // implied Growth, and the fund never meets its own Growth row.
  s = s.replace(/\bdividend\s+yield\b/g, "dividendyield");
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
