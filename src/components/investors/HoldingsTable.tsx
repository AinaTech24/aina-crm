"use client";

/**
 * Per-scheme holdings table for the investor-360 page — the full portfolio view.
 *
 * One row per scheme with: folio, start date, units, avg NAV, invested cost,
 * dividend, latest NAV (+ date), current value, unrealised gain, realised gain,
 * scheme weight %, avg holding days, absolute return %, and XIRR — plus a totals
 * row and per-row selection ("Show selected schemes").
 *
 * Data source:
 *   - units / latest NAV / current value / weight  → always available (from the
 *     RTA holdings import, even without transactions).
 *   - invested cost / avg NAV / unrealised gain / abs return / XIRR / start date /
 *     avg days / realised gain / dividend  → derived from the TRANSACTION history
 *     (valueInvestor). Unpriced schemes (no live NAV) render dimmed.
 *
 * A column no row has a value for is not drawn (a page of "—" said nothing),
 * and fully redeemed schemes sit behind "Show redeemed" — they are history,
 * not holdings.
 */

import { useMemo, useState } from "react";
import { Layers, AlertTriangle, ListFilter } from "lucide-react";
import { formatDate } from "@/lib/format";

export type Holding = {
  schemeName: string | null;
  amcName: string | null;
  folioNumber: string | null;
  folioNumbers: string[];
  netUnits: number;
  investedNet: number | null;
  /** Cost estimated from an incomplete history (lib/finance/valuation). */
  investedEstimate?: number | null;
  latestNav: number | null;
  navDate: string | null;
  currentValue: number | null;
  gain: number | null; // unrealised
  xirr: number | null; // decimal e.g. 0.14 = 14%
  kind: "sip" | "lumpsum" | "mixed" | null;
  priced: boolean;
  // ── Transaction-derived (optional — null until a transaction feed is imported) ──
  startDate?: string | null; // first purchase date
  avgDays?: number | null; // units-weighted holding period
  realisedGain?: number | null; // gain booked on redeemed units
  dividend?: number | null; // dividend payouts received
  hasTxns?: boolean; // true when this holding has transaction coverage
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return formatDate(dt);
}
function fmtUnits(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
function fmtNav(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
const dash = <span className="text-muted-foreground">—</span>;

/** Signed ₹ with colour (green up / red down). */
function Money({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return dash;
  const up = v >= 0;
  return (
    <span className={`tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? "+" : "−"}₹{Math.round(Math.abs(v)).toLocaleString("en-IN")}
    </span>
  );
}
/** Signed % with colour. */
function Pct({ v, digits = 2 }: { v: number | null | undefined; digits?: number }) {
  if (v == null || !Number.isFinite(v)) return dash;
  const up = v >= 0;
  return <span className={`tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>{up ? "+" : ""}{v.toFixed(digits)}%</span>;
}

type Row = { h: Holding; i: number; avgNav: number | null; weight: number | null; absRet: number | null };
type Totals = { invested: number | null; investedApprox: number | null; current: number; unrealised: number | null; realised: number; dividend: number; units: number; absRet: number | null };
type Col = {
  key: string;
  label: string;
  align: "left" | "right";
  /** Does this row have a value? A column with none in the whole list is dropped. */
  has: (r: Row) => boolean;
  cell: (r: Row) => React.ReactNode;
  total?: (t: Totals) => React.ReactNode;
};

const isOpen = (h: Holding) => h.netUnits > 0.0005 || (h.currentValue ?? 0) > 0;
/** Side-pocketed debt ("… Segregated Portfolio 2"): no NAV is published, so it
 *  can never be priced — say so instead of a bare dash. */
const SEGREGATED = /segregat/i;

export function HoldingsTable({
  holdings,
  asOf,
  unpricedSchemes,
}: {
  holdings: Holding[];
  asOf: string | null;
  unpricedSchemes: number;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [onlySelected, setOnlySelected] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const openCount = useMemo(() => holdings.filter(isOpen).length, [holdings]);
  const closedCount = holdings.length - openCount;

  const totalCurrent = useMemo(
    () => holdings.reduce((s, h) => s + (h.priced ? h.currentValue || 0 : 0), 0),
    [holdings]
  );

  // Derived per-row values (computable from what we already have).
  const rows = useMemo<Row[]>(
    () =>
      holdings.map((h, i) => {
        const avgNav = h.hasTxns && h.netUnits > 0 && h.investedNet != null && h.investedNet > 0 ? h.investedNet / h.netUnits : null;
        const weight = totalCurrent > 0 && h.currentValue ? (h.currentValue / totalCurrent) * 100 : null;
        const absRet = h.hasTxns && h.investedNet != null && h.investedNet > 0 && h.gain != null ? (h.gain / h.investedNet) * 100 : null;
        return { h, i, avgNav, weight, absRet };
      }),
    [holdings, totalCurrent]
  );

  const shown = rows.filter((r) => showClosed || isOpen(r.h));
  const visibleRows = onlySelected ? shown.filter((r) => selected.has(r.i)) : shown;

  const toggle = (i: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  const toggleAll = () =>
    setSelected((prev) => (prev.size === shown.length ? new Set() : new Set(shown.map((r) => r.i))));

  // Totals (over the currently-visible rows; priced only for value/gain).
  const t = useMemo<Totals>(() => {
    const src = visibleRows.map((r) => r.h);
    const priced = src.filter((h) => h.priced);
    const sum = (f: (h: Holding) => number | null | undefined) => src.reduce((s, h) => s + (Number(f(h)) || 0), 0);
    const invested = src.some((h) => !h.hasTxns || h.investedNet == null) ? null : sum((h) => h.investedNet);
    // Exact where known, estimated where the history is short — but only when
    // every row has one or the other.
    const investedApprox = invested == null && src.every((h) => (h.hasTxns && h.investedNet != null) || h.investedEstimate != null)
      ? sum((h) => (h.hasTxns && h.investedNet != null ? h.investedNet : h.investedEstimate))
      : null;
    const current = priced.reduce((s, h) => s + (h.currentValue || 0), 0);
    const unrealised = priced.some((h) => !h.hasTxns || h.gain == null) ? null : priced.reduce((s, h) => s + (h.gain || 0), 0);
    const absRet = invested != null && invested > 0 && unrealised != null ? (unrealised / invested) * 100 : null;
    return { invested, investedApprox, current, unrealised, realised: sum((h) => h.realisedGain), dividend: sum((h) => h.dividend), units: sum((h) => h.netUnits), absRet };
  }, [visibleRows]);

  const cols: Col[] = [
    {
      key: "folio", label: "Folio", align: "left", has: (r) => r.h.folioNumbers.length > 0 || !!r.h.folioNumber,
      cell: ({ h }) => (
        <span className="font-mono text-2xs text-muted-foreground">
          {(h.folioNumbers.length ? h.folioNumbers : h.folioNumber ? [h.folioNumber] : ["—"]).join(", ")}
        </span>
      ),
    },
    { key: "start", label: "Since", align: "left", has: (r) => !!r.h.startDate, cell: ({ h }) => <span className="text-muted-foreground">{fmtDate(h.startDate)}</span> },
    { key: "units", label: "Units", align: "right", has: () => true, cell: ({ h }) => fmtUnits(h.netUnits), total: (x) => fmtUnits(x.units) },
    { key: "avgNav", label: "Avg NAV", align: "right", has: (r) => r.avgNav != null, cell: (r) => fmtNav(r.avgNav) },
    {
      key: "cost", label: "Invested", align: "right",
      has: (r) => (!!r.h.hasTxns && r.h.investedNet != null) || r.h.investedEstimate != null,
      cell: ({ h }) =>
        h.hasTxns && h.investedNet != null ? (
          fmtMoney(h.investedNet)
        ) : h.investedEstimate != null ? (
          <span
            className="text-muted-foreground"
            title="Estimated: the RTA history is missing some redemptions, so this is the units held at the history's average cost."
          >
            {fmtMoney(h.investedEstimate)} <span className="text-2xs">est.</span>
          </span>
        ) : (
          dash
        ),
      total: (x) => (x.invested ? fmtMoney(x.invested) : x.investedApprox ? `≈ ${fmtMoney(x.investedApprox)}` : "—"),
    },
    { key: "dividend", label: "Dividend", align: "right", has: (r) => !!r.h.dividend, cell: ({ h }) => (h.dividend ? fmtMoney(h.dividend) : dash), total: (x) => (x.dividend ? fmtMoney(x.dividend) : "—") },
    {
      key: "nav", label: "NAV", align: "right", has: (r) => r.h.latestNav != null,
      cell: ({ h }) => (
        <>
          <div>{fmtNav(h.latestNav)}</div>
          {h.navDate && <div className="text-2xs text-muted-foreground">{fmtDate(h.navDate)}</div>}
        </>
      ),
    },
    {
      key: "value", label: "Current value", align: "right", has: () => true,
      cell: ({ h }) =>
        h.currentValue == null && SEGREGATED.test(h.schemeName ?? "") ? (
          <span className="text-muted-foreground" title="Segregated portfolio: the fund house and AMFI publish no NAV for it">No NAV</span>
        ) : (
          <span className="font-medium" title={h.currentValue == null ? "Not priced: no matching AMFI scheme yet" : undefined}>{fmtMoney(h.currentValue)}</span>
        ),
      total: (x) => fmtMoney(x.current),
    },
    {
      key: "gain", label: "Gain", align: "right", has: (r) => !!r.h.hasTxns && r.h.gain != null,
      cell: ({ h }) => (h.hasTxns ? <Money v={h.gain} /> : dash),
      total: (x) => (x.unrealised != null ? (x.unrealised >= 0 ? "+" : "−") + "₹" + Math.round(Math.abs(x.unrealised)).toLocaleString("en-IN") : "—"),
    },
    { key: "absRet", label: "Return", align: "right", has: (r) => r.absRet != null, cell: (r) => <Pct v={r.absRet} />, total: (x) => (x.absRet != null ? (x.absRet >= 0 ? "+" : "") + x.absRet.toFixed(2) + "%" : "—") },
    { key: "xirr", label: "XIRR", align: "right", has: (r) => !!r.h.hasTxns && r.h.xirr != null, cell: ({ h }) => (h.hasTxns && h.xirr != null ? <Pct v={h.xirr * 100} /> : dash) },
    {
      key: "realised", label: "Realised", align: "right", has: (r) => !!r.h.realisedGain,
      cell: ({ h }) => (h.realisedGain ? <Money v={h.realisedGain} /> : dash), total: (x) => (x.realised ? "₹" + Math.round(x.realised).toLocaleString("en-IN") : "—"),
    },
    { key: "avgDays", label: "Avg days", align: "right", has: (r) => r.h.avgDays != null, cell: ({ h }) => <span className="text-muted-foreground">{h.avgDays != null ? Math.round(h.avgDays).toLocaleString("en-IN") : "—"}</span> },
    { key: "weight", label: "Weight", align: "right", has: (r) => r.weight != null, cell: (r) => (r.weight != null ? `${r.weight.toFixed(1)}%` : dash), total: () => "100%" },
  ];
  // Drop a column nothing in the list fills.
  const visibleCols = cols.filter((c) => shown.some(c.has));
  const txnColsHidden = !visibleCols.some((c) => c.key === "cost");

  const th = "px-2.5 py-2 font-semibold text-2xs uppercase tracking-wide whitespace-nowrap";
  const td = "px-2.5 py-2.5 align-top tabular-nums whitespace-nowrap";

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2">
          <Layers className="size-4 text-muted-foreground" />
          Portfolio holdings
          <span className="text-xs font-normal text-muted-foreground">({openCount} scheme{openCount === 1 ? "" : "s"})</span>
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          {closedCount > 0 && (
            <button type="button" onClick={() => setShowClosed((v) => !v)} className="btn-ghost text-xs">
              {showClosed ? "Hide redeemed" : `Show redeemed (${closedCount})`}
            </button>
          )}
          {selected.size > 0 && (
            <button type="button" onClick={() => setOnlySelected((v) => !v)} className="btn-secondary text-xs">
              <ListFilter className="size-3.5" />
              {onlySelected ? "Show all" : `Show selected (${selected.size})`}
            </button>
          )}
          <div className="text-right">
            {asOf && <span className="text-xs text-muted-foreground">As of {fmtDate(asOf)}</span>}
            {unpricedSchemes > 0 && (
              <div className="text-2xs text-amber-700 flex items-center justify-end gap-1 mt-0.5">
                <AlertTriangle className="size-3" />
                {unpricedSchemes} scheme{unpricedSchemes > 1 ? "s" : ""} not priced
              </div>
            )}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {holdings.length === 0 ? "No holdings yet — they appear once an RTA folio/holdings file is imported." : "Every scheme on record has been redeemed."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${th} w-8 text-center relative`}>
                  <input
                    type="checkbox"
                    className="size-4 align-middle"
                    checked={selected.size === shown.length && shown.length > 0}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className={`${th} text-left`}>Scheme</th>
                {visibleCols.map((c) => (
                  <th key={c.key} className={`${th} ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.i} className={r.h.priced ? "" : "opacity-60"}>
                  <td className={`${td} text-center`}>
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected.has(r.i)}
                      onChange={() => toggle(r.i)}
                      aria-label={`Select ${r.h.schemeName ?? "scheme"}`}
                    />
                  </td>
                  <td className="px-2.5 py-2.5 align-top" style={{ minWidth: "14rem", maxWidth: "22rem" }}>
                    <div className="font-medium text-foreground line-clamp-2 whitespace-normal" title={r.h.schemeName ?? undefined}>
                      {r.h.schemeName ?? "Unknown scheme"}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {r.h.amcName && <span className="text-2xs text-muted-foreground truncate">{r.h.amcName}</span>}
                      {r.h.kind === "sip" && (
                        <span className="text-2xs font-semibold px-1 py-0.5 rounded bg-sky-50 text-sky-700">SIP</span>
                      )}
                      {!isOpen(r.h) && <span className="text-2xs text-muted-foreground">Redeemed</span>}
                    </div>
                  </td>
                  {visibleCols.map((c) => (
                    <td key={c.key} className={`${td} ${c.align === "right" ? "text-right" : "text-left"}`}>{c.cell(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-secondary font-semibold">
                <td className="px-2.5 py-3" colSpan={2}>
                  Total{onlySelected ? ` (${visibleRows.length} selected)` : ""}
                </td>
                {visibleCols.map((c) => (
                  <td key={c.key} className={`px-2.5 py-3 tabular-nums whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.total ? c.total(t) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {txnColsHidden && shown.length > 0 && (
        <p className="mt-3 text-2xs text-muted-foreground">Cost, gain and XIRR appear once the RTA transaction feed is imported.</p>
      )}
    </div>
  );
}
