/**
 * Which AMFI scheme a registrar code IS — the pure rule (Phase 3I).
 *
 * Evidence, strongest first:
 *   1. The registrar's own ISIN, matched to exactly one AMFI scheme in the
 *      verified AMFI feed (either ISIN column). An ISIN is specific to AMC,
 *      plan and option, so it decides all three — but the match is still
 *      cross-checked: the AMFI scheme's AMC must be the registrar AMC's (as the
 *      registrar's other codes establish it), and plan / option words the
 *      registrar printed must not contradict AMFI's (Direct vs Regular,
 *      Growth vs IDCW, IDCW payout vs reinvestment).
 *   2. A registrar mapping verified for the whole platform (the same ISIN rule
 *      on another firm's file) or approved by two platform operators —
 *      registrar codes are the registrar's, not the firm's.
 *   3. A person at the firm confirming the AMFI scheme, with the evidence they
 *      cite. Checked against 1 and 2 whenever they exist.
 *
 * NEVER a name. A name only RANKS candidates for a person (schemeCandidates);
 * nothing here reads one except to find explicit plan / option words.
 *
 * Every outcome carries a reason_code so the Scheme codes screen and the
 * coverage report can group them.
 */

export type SchemeStatus = "resolved_isin" | "confirmed" | "unresolved" | "conflict";

export type ReasonCode =
  // resolved
  | "isin_verified" | "isin_verified_inactive" | "global_isin" | "platform_approved" | "firm_confirmed"
  // unresolved
  | "no_isin" | "isin_not_in_feed" | "isin_unpriced"
  // conflict
  | "isins_differ" | "isin_ambiguous" | "amc_mismatch" | "plan_option_mismatch" | "confirm_contradicts_isin"
  | "confirm_not_in_feed" | "global_conflict" | "confirm_contradicts_global";

/** One AMFI scheme that carries an ISIN, and in which column. */
export type AmfiMatch = {
  code: string;
  column: "payout_growth" | "reinvest";
  amc: string | null;
  name: string | null;
  plan: string | null;
  option: string | null;
  /** Listed in the latest applied AMFI feed (false = inactive / historical). */
  active: boolean;
};

export type GlobalMapping = { amfiSchemeCode: string; basis: "isin" | "platform_approval"; evidenceIsin: string | null; amc?: string | null };

export type SchemeDecision = {
  status: SchemeStatus;
  amfiSchemeCode: string | null;
  reason: string;
  reasonCode: ReasonCode;
  /** For an ISIN match: the ISIN and the AMFI column it was found in. */
  evidenceIsin?: string | null;
  isinColumn?: AmfiMatch["column"] | null;
};

export const isResolved = (s: SchemeStatus | string | null | undefined) => s === "resolved_isin" || s === "confirmed";

// ── Explicit plan / option words ──────────────────────────────────────────

export type Markers = { plan: "direct" | "regular" | null; option: "growth" | "idcw" | null; idcw: "payout" | "reinvest" | null };

const PLAN = { direct: /\bdirect\b/, regular: /\bregular\b/ } as const;
const OPTION = { growth: /\bgrowth\b/, idcw: /\b(idcw|dividend|income distribution)\b/ } as const;
const IDCW = { payout: /\b(payout|pay out)\b/, reinvest: /\b(reinvest|reinvestment|re-investment)\b/ } as const;

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** One of two words, only when exactly one is printed and it is not part of the scheme's own core name. */
function pick<K extends string>(text: string, words: Record<K, RegExp>, core: string): K | null {
  const hits = (Object.keys(words) as K[]).filter((k) => words[k].test(text) && !words[k].test(core));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The plan / option a text states EXPLICITLY. `core` is the scheme's own name
 * (AMFI's text before the first " - "): a word that is part of it — "Regular
 * Savings Fund", "Growth Opportunities Fund", "Dividend Yield Fund" — says
 * nothing about plan or option and is ignored. Two contradicting words in one
 * text (Growth and IDCW) state nothing.
 */
export function markersOf(text: string | null | undefined, core: string | null | undefined = ""): Markers {
  const t = norm(text), c = norm(core);
  const idcw = pick(t, IDCW, c);
  let option = pick(t, OPTION, c);
  if (!option && idcw) option = "idcw";
  return { plan: pick(t, PLAN, c), option, idcw };
}

export const amfiCore = (name: string | null | undefined) => (name ?? "").split(/\s+-\s+/)[0] ?? "";

/** What AMFI states for a matched scheme: its explicit Plan / Option columns first, its name otherwise; the ISIN column decides payout vs reinvestment. */
export function amfiMarkers(m: Pick<AmfiMatch, "name" | "plan" | "option"> & { column?: AmfiMatch["column"] | null }): Markers {
  const core = amfiCore(m.name);
  const fromName = markersOf(m.name, core);
  const fromCols = markersOf([m.plan, m.option].filter(Boolean).join(" "), "");
  const plan = m.plan ? fromCols.plan : fromName.plan;
  let option = m.option ? fromCols.option : fromName.option;
  let idcw = m.option ? fromCols.idcw : fromName.idcw;
  if (m.column === "reinvest") { idcw = "reinvest"; option = "idcw"; }
  if (m.column === "payout_growth" && option === "idcw" && !idcw) idcw = "payout";
  return { plan, option, idcw };
}

/** The first field where both sides are explicit and disagree, or null. */
export function markerContradiction(registrar: Markers, amfi: Markers): string | null {
  if (registrar.plan && amfi.plan && registrar.plan !== amfi.plan) return `the registrar says ${registrar.plan}, AMFI says ${amfi.plan}`;
  if (registrar.option && amfi.option && registrar.option !== amfi.option) return `the registrar says ${registrar.option === "idcw" ? "IDCW" : "Growth"}, AMFI says ${amfi.option === "idcw" ? "IDCW" : "Growth"}`;
  if (registrar.idcw && amfi.idcw && registrar.idcw !== amfi.idcw) return `the registrar says IDCW ${registrar.idcw}, AMFI's ISIN is IDCW ${amfi.idcw}`;
  return null;
}

/** AMC names compared without the words AMFI adds or drops between feeds. */
export const amcKey = (s: string | null | undefined) =>
  norm(s).replace(/\b(mutual fund|mf|asset management company|asset management co|amc|limited|ltd|private|pvt)\b/g, " ").replace(/\s+/g, " ").trim() || null;

// ── The decision ─────────────────────────────────────────────────────────

export type DecideInput = {
  observedIsins: string[];
  /** For each observed ISIN, every AMFI scheme that carries it (from scheme_nav). */
  amfiByIsin: Record<string, AmfiMatch[]>;
  /** The registrar's own description(s) of the code — read only for explicit plan / option words. */
  observedText?: string | null;
  /**
   * The AMFI AMC(s) the registrar AMC code is established to be, from the
   * registrar's OTHER codes under it (ISIN-verified, platform-approved or
   * confirmed). Empty = not established. More than one = the registrar AMC
   * itself is in question.
   */
  registrarAmc?: string[];
  /** ISINs the AMFI feed lists WITHOUT a NAV (identity only — no scheme row to attach to). */
  unpricedIsins?: string[];
  /** A live platform mapping for this registrar code. */
  global?: GlobalMapping | null;
  /** A firm person's confirmation, the AMFI scheme's details, and whether it is in the feed. */
  confirmed: { amfiSchemeCode: string; existsInFeed: boolean; amc?: string | null; name?: string | null; plan?: string | null; option?: string | null } | null;
};

const conflict = (reasonCode: ReasonCode, reason: string): SchemeDecision => ({ status: "conflict", amfiSchemeCode: null, reasonCode, reason });

function amcProblem(registrarAmc: string[] | undefined, amc: string | null | undefined): string | null {
  const est = [...new Set((registrarAmc ?? []).map(amcKey).filter(Boolean))] as string[];
  if (est.length > 1) return `the registrar's codes under this AMC point to ${est.length} different AMFI AMCs`;
  const k = amcKey(amc);
  if (est.length === 1 && k && k !== est[0]) return `the registrar's other codes under this AMC are ${est[0]}, this scheme is ${k}`;
  return null;
}

export function decideScheme(input: DecideInput): SchemeDecision {
  const isins = [...new Set(input.observedIsins.map((i) => i.trim().toUpperCase()).filter(Boolean))];
  const text = input.observedText ?? "";
  if (isins.length > 1) return conflict("isins_differ", `the registrar printed ${isins.length} different ISINs for this code`);

  if (isins.length === 1) {
    const isin = isins[0];
    const all = input.amfiByIsin[isin] ?? [];
    const codes = [...new Set(all.map((m) => m.code))];
    if (codes.length > 1) return conflict("isin_ambiguous", `the ISIN is on ${codes.length} AMFI schemes`);
    if (codes.length === 1) {
      const m = all[0];
      // Two platform operators approved exactly this scheme for the code after
      // reviewing the AMC / plan question: their approval settles it.
      const approved = input.global?.basis === "platform_approval" && input.global.amfiSchemeCode === m.code;
      if (!approved) {
        const amc = amcProblem(input.registrarAmc, m.amc);
        if (amc) return conflict("amc_mismatch", amc);
        const po = markerContradiction(markersOf(text, amfiCore(m.name)), amfiMarkers(m));
        if (po) return conflict("plan_option_mismatch", `plan / option: ${po}`);
      }
      if (input.global && input.global.amfiSchemeCode !== m.code) {
        return conflict("global_conflict", `the platform mapping says AMFI ${input.global.amfiSchemeCode}, the registrar's ISIN is AMFI ${m.code}`);
      }
      if (input.confirmed && input.confirmed.amfiSchemeCode !== m.code) {
        return conflict("confirm_contradicts_isin", `confirmed as AMFI ${input.confirmed.amfiSchemeCode}, but the registrar's ISIN is AMFI ${m.code}`);
      }
      return {
        status: "resolved_isin", amfiSchemeCode: m.code, evidenceIsin: isin, isinColumn: m.column,
        reasonCode: m.active ? "isin_verified" : "isin_verified_inactive",
        reason: m.active ? "the registrar's ISIN identifies one AMFI scheme" : "the registrar's ISIN identifies one AMFI scheme, which the latest AMFI feed no longer lists (historical — its NAV is not current)",
      };
    }
    // An ISIN the feed does not carry. A platform mapping verified by a
    // DIFFERENT ISIN contradicts this one.
    if (input.global?.basis === "isin" && input.global.evidenceIsin && input.global.evidenceIsin !== isin) {
      return conflict("isins_differ", "this file's ISIN differs from the ISIN the platform mapping was verified with");
    }
  }

  if (input.global) {
    const g = input.global;
    if (input.confirmed && input.confirmed.amfiSchemeCode !== g.amfiSchemeCode) {
      return conflict("confirm_contradicts_global", `confirmed as AMFI ${input.confirmed.amfiSchemeCode}, but the platform mapping says AMFI ${g.amfiSchemeCode}`);
    }
    if (g.basis === "isin") {
      const amc = amcProblem(input.registrarAmc, g.amc);
      if (amc) return conflict("amc_mismatch", amc);
    }
    return g.basis === "isin"
      ? { status: "resolved_isin", amfiSchemeCode: g.amfiSchemeCode, reasonCode: "global_isin", evidenceIsin: g.evidenceIsin, reason: "verified on the platform by the registrar's own ISIN" }
      : { status: "confirmed", amfiSchemeCode: g.amfiSchemeCode, reasonCode: "platform_approved", reason: "approved on the platform by two operators" };
  }

  if (input.confirmed) {
    const c = input.confirmed;
    if (!c.existsInFeed) return conflict("confirm_not_in_feed", `confirmed as AMFI ${c.amfiSchemeCode}, which is not in the AMFI feed`);
    const amc = amcProblem(input.registrarAmc, c.amc);
    if (amc) return conflict("amc_mismatch", amc);
    const po = markerContradiction(markersOf(text, amfiCore(c.name)), amfiMarkers({ name: c.name ?? null, plan: c.plan ?? null, option: c.option ?? null }));
    if (po) return conflict("plan_option_mismatch", `plan / option: ${po}`);
    return { status: "confirmed", amfiSchemeCode: c.amfiSchemeCode, reasonCode: "firm_confirmed", reason: "confirmed by a person" };
  }

  if (isins.length && (input.unpricedIsins ?? []).map((i) => i.toUpperCase()).includes(isins[0])) {
    return { status: "unresolved", amfiSchemeCode: null, reasonCode: "isin_unpriced", reason: "AMFI lists this ISIN without a NAV — there is no priced scheme to attach it to yet" };
  }
  return isins.length
    ? { status: "unresolved", amfiSchemeCode: null, reasonCode: "isin_not_in_feed", reason: "the registrar's ISIN is not in the AMFI feed" }
    : { status: "unresolved", amfiSchemeCode: null, reasonCode: "no_isin", reason: "the registrar printed no ISIN for this code — a person must confirm the AMFI scheme" };
}

/** The three-way grouping the brief reports. */
export const REASON_GROUP: Record<ReasonCode, "verified" | "approved" | "historical_inactive" | "missing_reference" | "ambiguous" | "conflicting"> = {
  isin_verified: "verified", global_isin: "verified", isin_verified_inactive: "historical_inactive",
  platform_approved: "approved", firm_confirmed: "approved",
  no_isin: "missing_reference", isin_not_in_feed: "missing_reference", isin_unpriced: "missing_reference",
  isin_ambiguous: "ambiguous", isins_differ: "ambiguous",
  amc_mismatch: "conflicting", plan_option_mismatch: "conflicting", confirm_contradicts_isin: "conflicting",
  confirm_not_in_feed: "conflicting", global_conflict: "conflicting", confirm_contradicts_global: "conflicting",
};

/** Words that carry no scheme identity — dropped before ranking candidates by name. */
const STOP = new Set(["fund", "plan", "option", "scheme", "the", "of", "and", "mutual", "mf", "direct", "regular", "growth", "idcw", "dividend", "payout", "reinvestment", "reinvest", "income", "distribution", "cum", "capital", "withdrawal"]);
const tokens = (s: string | null | undefined) => new Set(norm(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w)));

/** Name overlap 0–1, ONLY to order candidates shown to a person. Never a decision. */
export function nameRank(a: string | null | undefined, b: string | null | undefined): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}
