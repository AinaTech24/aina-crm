/**
 * Which holdings statements AUM and the Client Portfolio may use — pure.
 *
 * A statement is one registrar holdings report: its registrar, the ARN it was
 * produced for, its as-of date, and whether it is the FULL book of that ARN at
 * that registrar or only a subset (one AMC, one period's active folios).
 *
 *   - Each (registrar, ARN) scope keeps its own latest statement. An older
 *     statement never replaces a newer one; equal dates are not merged.
 *   - Within a scope, a position's latest value comes from the latest statement
 *     that lists it. A full-book statement is authoritative for its date: a
 *     position it does not list is absent (sold out) as of that date. A subset
 *     statement only updates the positions it lists.
 *   - A zero position is a position (units 0), never dropped.
 *   - Firm-wide AUM is "complete" only when every required scope has a
 *     full-book statement; otherwise it is reported per scope with its date,
 *     and the firm figure is labelled partial.
 */
export type Position = { amcCode: string; folioNumber: string; schemeCode: string; units: number; value: number | null };
export type HoldingStatement = { id: string; rta: "cams" | "kfintech"; arn: string; asOf: string; fullBook: boolean; positions: Position[] };

export type ScopeView = {
  rta: string; arn: string;
  /** The full-book statement the scope stands on, if any. */
  baseStatement: { id: string; asOf: string } | null;
  /** Later subset statements applied on top. */
  overlays: Array<{ id: string; asOf: string }>;
  positions: Array<Position & { asOf: string; statementId: string }>;
  value: number;
  zeroPositions: number;
  /** Positions whose value is not stated (value null) — never counted as 0. */
  unvalued: number;
};

export function scopeView(statements: HoldingStatement[]): ScopeView[] {
  const byScope = new Map<string, HoldingStatement[]>();
  for (const s of statements) byScope.set(`${s.rta}|${s.arn}`, [...(byScope.get(`${s.rta}|${s.arn}`) ?? []), s]);
  const out: ScopeView[] = [];
  for (const list of byScope.values()) {
    const sorted = [...list].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.id.localeCompare(b.id));
    const base = [...sorted].reverse().find((s) => s.fullBook) ?? null;
    const overlays = sorted.filter((s) => !s.fullBook && (!base || s.asOf > base.asOf));
    const pos = new Map<string, Position & { asOf: string; statementId: string }>();
    for (const s of [...(base ? [base] : []), ...overlays]) {
      for (const p of s.positions) pos.set(`${p.amcCode}|${p.folioNumber}|${p.schemeCode}`, { ...p, asOf: s.asOf, statementId: s.id });
    }
    const positions = [...pos.values()];
    out.push({
      rta: sorted[0].rta, arn: sorted[0].arn,
      baseStatement: base ? { id: base.id, asOf: base.asOf } : null,
      overlays: overlays.map((s) => ({ id: s.id, asOf: s.asOf })),
      positions,
      value: positions.reduce((s, p) => s + (p.value ?? 0), 0),
      zeroPositions: positions.filter((p) => p.units === 0).length,
      unvalued: positions.filter((p) => p.value === null).length,
    });
  }
  return out;
}

export function firmAum(scopes: ScopeView[], required: Array<{ rta: string; arn: string }>) {
  const missing = required.filter((r) => !scopes.some((s) => s.rta === r.rta && s.arn === r.arn && s.baseStatement));
  const dates = [...new Set(scopes.map((s) => s.baseStatement?.asOf ?? s.overlays.at(-1)?.asOf).filter(Boolean))];
  return {
    value: scopes.reduce((s, x) => s + x.value, 0),
    complete: missing.length === 0 && scopes.every((s) => s.unvalued === 0),
    missingFullBook: missing,
    asOfDates: dates,
    label: missing.length ? "PARTIAL — no full-book statement for: " + missing.map((m) => `${m.rta}/${m.arn}`).join(", ") : dates.length > 1 ? `complete, as of different dates per registrar (${dates.join(", ")})` : "complete",
  };
}
