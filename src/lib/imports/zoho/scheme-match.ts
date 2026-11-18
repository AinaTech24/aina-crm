/**
 * Match a free-typed scheme name (as Zoho holds it: "WhiteOak Capital Flexi Cap
 * Fund", "BAJAJ FINSERV MULTI ASSET ALLOCATION FUND REGULAR PLAN -GROWTH",
 * "ABSL Frontline Equity") to a scheme in the firm's Scheme Master.
 * Pure; tested in tests/zoho-import.test.ts.
 *
 *  - Names are compared on their BASE: lower case, "&" as "and", punctuation and
 *    plan / option / filler words ("direct", "regular", "plan", "growth",
 *    "idcw", "dividend", "option", "fund", "scheme") removed, known short forms
 *    spelled out (ABSL → Aditya Birla Sun Life, …).
 *  - The same base in the master → that scheme family ("exact"). Otherwise the
 *    closest family by shared words, only when it clearly beats the runner-up
 *    and names the same fund house ("close"). Anything else is left for a
 *    person ("none") — never a guess.
 *  - Within a family the plan and option the name states win; a name that
 *    states none gets REGULAR · GROWTH, the plan a distributor's business is in.
 *    An open scheme beats a closed one.
 *  - AMFI's own notes in a name — "(Formerly Known as Sundaram Low Duration
 *    Fund)", "(erstwhile Value Discovery Fund)", "(Existing number of
 *    Segregated Portfolios - 2)" — are not part of the base; a former name is
 *    indexed as another name of the same family.
 *  - SEBI's category renames (2026): a "Low Duration Fund" is now the house's
 *    "Ultra Short to Short Term Fund", an "Ultra Short Duration Fund" its
 *    "Ultra Short Term Fund". A name that only matches after that rename is a
 *    "close" suggestion, never applied without a person's tick.
 */

export type MasterScheme = {
  scheme_code: string;
  scheme_name: string;
  amc_code: string | null;
  category: string | null;
  plan: string | null;
  option: string | null;
  is_closed?: boolean | null;
};

export type SchemeMatch = {
  input: string;
  scheme: MasterScheme | null;
  confidence: "exact" | "close" | "none";
  /** Why a "close" match was suggested, when it was a rename. */
  why?: string;
  /** 0–1 word overlap with the chosen family. */
  score: number;
  /** For "none": the nearest family, to help a person decide. */
  nearest?: string;
};

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\babsl\b/g, "aditya birla sun life"],
  [/\baditya birla\b(?! sun)/g, "aditya birla sun life"],
  [/\bbsl\b/g, "birla sun life"],
  [/\bicici pru\b/g, "icici prudential"],
  [/\bppfas\b/g, "parag parikh"],
  [/\bppfcf\b/g, "parag parikh flexi cap"],
  [/\bmotilal\b(?! oswal)/g, "motilal oswal"],
  [/\bfranklin\b(?! india| templeton)/g, "franklin india"],
  [/\bnippon\b(?! india)/g, "nippon india"],
  [/\bmirae\b(?! asset)/g, "mirae asset"],
  [/\bcanara\b(?! robeco)/g, "canara robeco"],
  [/\bmulticap\b/g, "multi cap"],
  [/\bflexicap\b/g, "flexi cap"],
  [/\blargecap\b/g, "large cap"],
  [/\bmidcap\b/g, "mid cap"],
  [/\bsmallcap\b/g, "small cap"],
  [/\bfocussed\b/g, "focused"],
  [/\btax saver\b/g, "elss tax saver"],
  [/\bst\b/g, "short term"],
  [/\bsunlife\b/g, "sun life"],
  [/\bopps?\b/g, "opportunities"],
  [/\bblue chip\b/g, "bluechip"],
  // "Cumulative" is ICICI's word for the growth option.
  [/\bcumulative\b/g, "growth"],
];

const FILLER = new Set([
  "direct", "regular", "plan", "growth", "gr", "option", "options", "opt", "idcw", "dividend", "div", "payout", "reinvestment",
  "reinvest", "fund", "scheme", "standard", "the", "mutual", "mf", "of", "series", "a", "an", "and", "reg", "dir", "g", "p", "r",
]);

export function normalizeScheme(s: string): string {
  let t = ` ${String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/([a-z])(\d)/g, "$1 $2") // "hybrid95" → "hybrid 95"
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  return t.replace(/\s+/g, " ").trim();
}

/** A name without AMFI's bracketed notes ("(Formerly Known as …)", "(erstwhile …)"). */
export function withoutNotes(s: string): string {
  return String(s ?? "").replace(/\([^)]*\)/g, " ");
}

/** The former name AMFI states in a scheme name, if any. */
export function formerName(s: string): string | null {
  const m = String(s ?? "").match(/\((?:formerly(?: known as)?|erstwhile)\s+([^)]+)\)/i);
  return m ? m[1].trim() : null;
}

/** SEBI's 2026 category renames, applied to a base. */
const CATEGORY_RENAMES: Array<[RegExp, string, string]> = [
  [/\blow duration\b/, "ultra short to short term", "Low Duration funds are now Ultra Short to Short Term funds"],
  [/\bultra short duration\b/, "ultra short term", "Ultra Short Duration funds are now Ultra Short Term funds"],
];

export function schemeBase(s: string): string {
  return normalizeScheme(withoutNotes(s))
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .join(" ");
}

/** Plan / option a name states, if any. */
export function statedVariant(s: string): { plan: "regular" | "direct" | null; option: "growth" | "idcw" | null } {
  const t = ` ${normalizeScheme(s)} `;
  const plan = / direct | dir /.test(t) ? "direct" : / regular | reg /.test(t) ? "regular" : null;
  const option = / idcw | dividend | div | payout | reinvest | reinvestment | bonus /.test(t) ? "idcw" : / growth | gr /.test(t) ? "growth" : null;
  return { plan, option };
}

function variantOf(m: MasterScheme): { plan: string | null; option: string | null } {
  const v = statedVariant(m.scheme_name);
  const option = m.option ? (m.option.startsWith("idcw") ? "idcw" : m.option) : v.option;
  return { plan: m.plan ?? v.plan, option };
}

const tokens = (base: string) => new Set(base.split(" ").filter(Boolean));

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
}

/** The fund house's lead word (first word of the base), e.g. "whiteoak", "hdfc". */
const brand = (base: string) => base.split(" ")[0] ?? "";

export type SchemeIndex = { families: Map<string, MasterScheme[]>; list: Array<{ base: string; toks: Set<string> }> };

export function buildSchemeIndex(master: MasterScheme[]): SchemeIndex {
  const families = new Map<string, MasterScheme[]>();
  const add = (b: string, m: MasterScheme) => {
    if (!b) return;
    if (!families.has(b)) families.set(b, []);
    families.get(b)!.push(m);
  };
  for (const m of master) {
    add(schemeBase(m.scheme_name), m);
    // "(Formerly Known as Sundaram Low Duration Fund)": the old name finds it too.
    const former = formerName(m.scheme_name);
    if (former) {
      // "(erstwhile Bluechip Fund)" names the fund without its house: put the
      // house's name (the AMC, less "Mutual Fund") in front.
      const house = schemeBase(String(m.amc_code ?? "").replace(/mutual\s*fund/i, "")) || schemeBase(m.scheme_name).split(" ")[0];
      const fb = schemeBase(former);
      add(fb.startsWith(house.split(" ")[0]) ? fb : `${house} ${fb}`.trim(), m);
    }
  }
  return { families, list: [...families.keys()].map((base) => ({ base, toks: tokens(base) })) };
}

/** The member of a family to use: the stated plan / option, else Regular · Growth; open before closed. */
export function pickVariant(family: MasterScheme[], input: string): MasterScheme {
  const want = statedVariant(input);
  const plan = want.plan ?? "regular";
  const option = want.option ?? "growth";
  const rank = (m: MasterScheme) => {
    const v = variantOf(m);
    return (v.plan === plan ? 4 : v.plan == null ? 1 : 0) + (v.option === option ? 2 : v.option == null ? 0.5 : 0) + (m.is_closed ? 0 : 0.25);
  };
  return [...family].sort((a, b) => rank(b) - rank(a) || a.scheme_name.localeCompare(b.scheme_name))[0];
}

export function matchScheme(input: string, idx: SchemeIndex): SchemeMatch {
  const base = schemeBase(input);
  if (!base) return { input, scheme: null, confidence: "none", score: 0 };
  const exact = idx.families.get(base);
  if (exact) return { input, scheme: pickVariant(exact, input), confidence: "exact", score: 1 };
  for (const [re, to, why] of CATEGORY_RENAMES) {
    if (!re.test(base)) continue;
    const renamed = idx.families.get(base.replace(re, to));
    if (renamed) return { input, scheme: pickVariant(renamed, input), confidence: "close", score: 1, why };
  }

  const toks = tokens(base);
  const b = brand(base);
  let best: { base: string; score: number } | null = null;
  let second = 0;
  let nearest: string | null = null;
  let nearestScore = 0;
  for (const f of idx.list) {
    const s = overlap(toks, f.toks);
    if (s > nearestScore) {
      nearestScore = s;
      nearest = f.base;
    }
    // Never suggest a fund that ADDS a word changing what it is: "ICICI Prudential
    // Savings Fund" (debt) is not "… Equity Savings Fund" (hybrid). Dropping
    // such a word is a rename and stays possible ("Retirement Savings" →
    // "Retirement").
    if ([...f.toks].some((t) => TYPE_WORDS.has(t) && !toks.has(t))) continue;
    // A rename adds words or drops words — it does not SWAP one for another:
    // "Frontline Equity" is not "Manufacturing Equity", "Equity Hybrid 95" is not
    // "Manufacturing Equity".
    if ([...toks].some((t) => !f.toks.has(t)) && [...f.toks].some((t) => !toks.has(t))) continue;
    if (!best || s > best.score) {
      second = best?.score ?? 0;
      best = { base: f.base, score: s };
    } else if (s > second) second = s;
  }
  const near = nearest ? idx.families.get(nearest)?.[0]?.scheme_name : undefined;
  if (!best) return { input, scheme: null, confidence: "none", score: Number(nearestScore.toFixed(2)), nearest: near };
  const sameHouse = brand(best.base) === b;
  if (best.score >= 0.8 && best.score - second >= 0.08 && sameHouse) {
    return { input, scheme: pickVariant(idx.families.get(best.base)!, input), confidence: "close", score: Number(best.score.toFixed(2)) };
  }
  return { input, scheme: null, confidence: "none", score: Number(nearestScore.toFixed(2)), nearest: near };
}

/** Words that change what a fund IS — a suggestion may drop one, never add one. */
const TYPE_WORDS = new Set([
  "equity", "debt", "savings", "retirement", "hybrid", "children", "childrens", "tax", "elss", "index", "arbitrage", "liquid", "gilt",
  "overnight", "international", "global", "digital", "psu", "pharma", "banking", "infrastructure", "dynamic", "balanced", "conservative",
  "aggressive", "credit", "corporate", "government", "money", "gold", "silver", "nifty", "sensex", "etf", "fof", "momentum", "quality",
]);
