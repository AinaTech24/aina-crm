/**
 * How AUM and a client's portfolio may be PRESENTED (Phase 3D) — pure.
 *
 * Built on `holdings-snapshot.ts` (which statement each scope stands on). The
 * rules this module adds:
 *
 *   - AUM is shown PER REGISTRAR × ARN, each with the date its statement
 *     speaks for, its age, and whether that statement is the full book.
 *   - A statement older than the freshness limit is STALE and says so.
 *   - A full-book flag is a claim, not proof: the statement is checked against
 *     every folio other files show the firm holds (transaction feeds, masters,
 *     registrations). A folio evidenced elsewhere but absent from a full-book
 *     statement is a COVERAGE GAP. (MFSD203, 2026-10-08: 1,792 folios, yet 1
 *     folio active in MFSD201 / MFSD211 is missing — row count alone proves
 *     nothing.)
 *   - The firm-wide figure is printed ONLY when every required scope has a
 *     full-book statement, none is stale, none has an unexplained gap and no
 *     position is unvalued. Otherwise it is null, with every reason listed —
 *     the per-registrar figures still show.
 *   - Zero-unit positions are kept and counted.
 *   - A position's registrar-reported value and its live-NAV valuation are two
 *     different facts with two dates; both are kept, neither overwrites the
 *     other, and what is displayed says which one it is.
 */
import type { ScopeView } from "./holdings-snapshot";

export const DEFAULT_STALE_DAYS = 7;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A folio another file proves the firm holds (as of its own date). */
export type FolioEvidence = { rta: string; arn?: string | null; amcCode: string; folioNumber: string; seenOn: string; source: string };

export type RegistrarAumCard = {
  rta: string;
  arn: string;
  /** Sum of the registrar-reported values of the scope's positions. */
  sourceValue: number;
  /** The newest statement date in the card. */
  asOf: string | null;
  /** The OLDEST statement date the card's positions stand on (= asOf unless mixed). */
  oldestAsOf: string | null;
  /** The positions come from statements of different dates — never presented as one date. */
  mixedDates: boolean;
  /** Age of the OLDEST part: a card is as stale as its oldest figure. */
  ageDays: number | null;
  stale: boolean;
  fullBook: boolean;
  positions: number;
  zeroPositions: number;
  unvalued: number;
  amcs: number;
  /** Folios other files evidence for this registrar (and ARN, when they name one) that the statement does not list. */
  coverageGaps: { count: number; sources: Record<string, number> };
  /** One line for the screen: "KFintech · ARN-1 · ₹… as of 8 Oct 2026 (full book)". */
  label: string;
};

export function registrarAumCards(scopes: ScopeView[], evidence: FolioEvidence[], asOf: string, staleDays = DEFAULT_STALE_DAYS): RegistrarAumCard[] {
  return scopes.map((s) => {
    const dates = [...new Set(s.positions.map((p) => p.asOf))].sort();
    const date = dates.at(-1) ?? s.baseStatement?.asOf ?? null;
    const oldest = dates[0] ?? date;
    const age = oldest ? days(oldest, asOf) : null;
    const listed = new Set(s.positions.map((p) => `${p.amcCode}|${p.folioNumber}`));
    const gaps = new Map<string, string>();
    for (const e of evidence) {
      if (e.rta !== s.rta || (e.arn && e.arn !== s.arn)) continue;
      // Evidence newer than the statement cannot be held against it.
      if (date && e.seenOn > date) continue;
      const k = `${e.amcCode}|${e.folioNumber}`;
      if (!listed.has(k) && !gaps.has(k)) gaps.set(k, e.source);
    }
    const sources: Record<string, number> = {};
    for (const src of gaps.values()) sources[src] = (sources[src] ?? 0) + 1;
    const fullBook = !!s.baseStatement;
    const stale = age === null || age > staleDays;
    return {
      rta: s.rta, arn: s.arn, sourceValue: r2(s.value), asOf: date, oldestAsOf: oldest, mixedDates: dates.length > 1, ageDays: age, stale, fullBook,
      positions: s.positions.length, zeroPositions: s.zeroPositions, unvalued: s.unvalued,
      amcs: new Set(s.positions.map((p) => p.amcCode)).size,
      coverageGaps: { count: gaps.size, sources },
      label: `${s.rta === "kfintech" ? "KFintech" : s.rta === "cams" ? "CAMS" : s.rta} · ${s.arn} · as of ${dates.length > 1 ? `${oldest} – ${date} (mixed dates)` : date ?? "unknown"}${fullBook ? " (full book)" : " (partial statement)"}${stale ? " — STALE" : ""}`,
    };
  });
}

export type FirmAumHeadline = {
  /** Null unless every condition holds; the cards still carry each registrar's figure. */
  value: number | null;
  asOfDates: string[];
  reasons: string[];
};

export function firmAumHeadline(cards: RegistrarAumCard[], required: Array<{ rta: string; arn: string }>): FirmAumHeadline {
  const reasons: string[] = [];
  for (const r of required) {
    const c = cards.find((x) => x.rta === r.rta && x.arn === r.arn);
    if (!c) reasons.push(`no statement for ${r.rta}/${r.arn}`);
    else if (!c.fullBook) reasons.push(`${r.rta}/${r.arn}: only a partial statement`);
  }
  for (const c of cards) {
    if (c.mixedDates) reasons.push(`${c.rta}/${c.arn}: combines statements of different dates (${c.oldestAsOf} → ${c.asOf}) — not one figure as of one date`);
    if (c.stale) reasons.push(`${c.rta}/${c.arn}: statement ${c.oldestAsOf ? `dated ${c.oldestAsOf} (${c.ageDays} days old)` : "undated"} is stale`);
    if (c.coverageGaps.count) reasons.push(`${c.rta}/${c.arn}: ${c.coverageGaps.count} folio(s) other files show are missing from the statement`);
    if (c.unvalued) reasons.push(`${c.rta}/${c.arn}: ${c.unvalued} position(s) carry no value`);
  }
  const asOfDates = [...new Set(cards.map((c) => c.asOf).filter((d): d is string => !!d))].sort();
  return { value: reasons.length ? null : r2(cards.reduce((s, c) => s + c.sourceValue, 0)), asOfDates, reasons };
}

// ── One position, two valuations ────────────────────────────────────────────

export type PositionValuation = {
  units: number;
  /** What the registrar printed, with the statement's date. Never recomputed. */
  source: { value: number | null; nav: number | null; asOf: string; statementId: string } | null;
  /** units × the latest NAV the CRM holds, with that NAV's date. */
  live: { value: number; nav: number; navDate: string } | null;
  /** Which one the screen shows, and the words that must sit beside it. */
  shown: { kind: "source" | "live" | "none"; value: number | null; caption: string };
};

export function valuePosition(
  p: { units: number; source: { value: number | null; nav: number | null; asOf: string; statementId: string } | null },
  liveNav: { nav: number; navDate: string } | null,
): PositionValuation {
  // A live NAV is used only when it is not OLDER than the registrar's own date
  // — otherwise the registrar's figure is the newer fact.
  const liveOk = !!liveNav && Number.isFinite(liveNav.nav) && (!p.source || liveNav.navDate >= p.source.asOf);
  const live = liveOk ? { value: r2(p.units * liveNav!.nav), nav: liveNav!.nav, navDate: liveNav!.navDate } : null;
  const shown: PositionValuation["shown"] = live
    ? { kind: "live", value: live.value, caption: `at NAV of ${live.navDate}` }
    : p.source && p.source.value !== null
      ? { kind: "source", value: p.source.value, caption: `registrar value as of ${p.source.asOf}` }
      : { kind: "none", value: null, caption: p.units === 0 ? "nil balance" : "no value stated and no NAV" };
  // A zero balance is worth zero on any date — but it is still a position.
  if (p.units === 0) return { units: 0, source: p.source, live: live ? { ...live, value: 0 } : null, shown: { ...shown, value: 0, caption: "nil balance" } };
  return { units: p.units, source: p.source, live, shown };
}
