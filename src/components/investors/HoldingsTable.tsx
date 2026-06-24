import { Layers, AlertTriangle } from "lucide-react";
import { formatINR } from "@/lib/utils";

/**
 * Per-scheme holdings table for the investor-360 page. One row per scheme,
 * arriving pre-sorted by current value desc. Unpriced schemes (no live AMFI
 * NAV match) render dimmed with a hint instead of a valuation, and are
 * excluded from the current-value / gain / total rollups so the numbers are
 * never quietly distorted.
 *
 * Presentational (server-rendered) — no client interactivity.
 */

type Holding = {
  schemeName: string | null;
  amcName: string | null;
  folioNumber: string | null;
  folioNumbers: string[];
  netUnits: number;
  investedNet: number;
  latestNav: number | null;
  navDate: string | null;
  currentValue: number | null;
  gain: number | null;
  xirr: number | null; // decimal e.g. 0.14 = 14%
  kind: "sip" | "lumpsum" | "mixed" | null;
  priced: boolean;
};

function formatDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatUnits(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

const KIND_BADGES: Record<
  NonNullable<Holding["kind"]>,
  { label: string; cls: string }
> = {
  sip: { label: "SIP", cls: "bg-sky-50 text-sky-700" },
  lumpsum: { label: "Lumpsum", cls: "bg-violet-50 text-violet-700" },
  mixed: { label: "Mixed", cls: "bg-amber-50 text-amber-700" },
};

function GainCell({
  gain,
  investedNet,
}: {
  gain: number | null;
  investedNet: number;
}) {
  if (gain == null) return <span className="text-muted-foreground">—</span>;
  const up = gain >= 0;
  const tone = up ? "text-emerald-600" : "text-rose-600";
  const pct = investedNet > 0 ? (gain / investedNet) * 100 : null;
  return (
    <span className={`tabular-nums ${tone}`}>
      {up ? "+" : "−"}
      {formatINR(Math.round(Math.abs(gain)))}
      {pct != null && (
        <span className="text-[11px] ml-1">
          {up ? "+" : ""}
          {pct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

export function HoldingsTable({
  holdings,
  asOf,
  unpricedSchemes,
}: {
  holdings: Holding[];
  asOf: string | null;
  unpricedSchemes: number;
}) {
  const priced = holdings.filter((h) => h.priced);
  const totalInvested = holdings.reduce((s, h) => s + (h.investedNet || 0), 0);
  const totalCurrent = priced.reduce((s, h) => s + (h.currentValue || 0), 0);
  const totalGain = priced.reduce((s, h) => s + (h.gain || 0), 0);
  const totalUp = totalGain >= 0;

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <div className="size-7 rounded-lg bg-sky-50 grid place-items-center">
            <Layers className="size-3.5 text-sky-700" />
          </div>
          Holdings
        </h2>
        <div className="text-right">
          {asOf && (
            <span className="text-xs text-muted-foreground">
              As of {formatDate(asOf)}
            </span>
          )}
          {unpricedSchemes > 0 && (
            <div className="text-[11px] text-amber-700 flex items-center justify-end gap-1 mt-0.5">
              <AlertTriangle className="size-3" />
              {unpricedSchemes} scheme{unpricedSchemes > 1 ? "s" : ""} not priced
              — valuation excludes them
            </div>
          )}
        </div>
      </div>

      {holdings.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No holdings yet — they appear once transactions are imported.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="text-left font-semibold py-2 pr-3">Scheme</th>
                <th className="text-right font-semibold py-2 px-3">Units</th>
                <th className="text-right font-semibold py-2 px-3">Invested</th>
                <th className="text-right font-semibold py-2 px-3">
                  Current value
                </th>
                <th className="text-right font-semibold py-2 px-3">Gain</th>
                <th className="text-right font-semibold py-2 px-3">XIRR</th>
                <th className="text-right font-semibold py-2 pl-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const folios =
                  h.folioNumbers.length > 0
                    ? h.folioNumbers
                    : h.folioNumber
                    ? [h.folioNumber]
                    : [];
                const xUp = (h.xirr ?? 0) >= 0;
                return (
                  <tr
                    key={i}
                    className={`border-b last:border-0 ${
                      h.priced ? "" : "opacity-60"
                    }`}
                  >
                    <td className="py-2.5 pr-3 align-top">
                      <div className="font-medium">
                        {h.schemeName ?? "Unknown scheme"}
                      </div>
                      {h.amcName && (
                        <div className="text-[11px] text-muted-foreground">
                          {h.amcName}
                        </div>
                      )}
                      {folios.length > 0 && (
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {folios.join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums align-top">
                      {formatUnits(h.netUnits)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums align-top">
                      {formatINR(Math.round(h.investedNet || 0))}
                    </td>
                    {h.priced ? (
                      <>
                        <td className="py-2.5 px-3 text-right tabular-nums align-top">
                          {h.currentValue == null
                            ? "—"
                            : formatINR(Math.round(h.currentValue))}
                        </td>
                        <td className="py-2.5 px-3 text-right align-top">
                          <GainCell
                            gain={h.gain}
                            investedNet={h.investedNet}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums align-top">
                          {h.xirr == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={
                                xUp ? "text-emerald-600" : "text-rose-600"
                              }
                            >
                              {xUp ? "+" : ""}
                              {(h.xirr * 100).toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td
                        colSpan={3}
                        className="py-2.5 px-3 text-right text-[11px] text-muted-foreground italic align-top"
                      >
                        no live NAV
                      </td>
                    )}
                    <td className="py-2.5 pl-3 text-right align-top">
                      {h.kind && (
                        <span
                          className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            KIND_BADGES[h.kind].cls
                          }`}
                        >
                          {KIND_BADGES[h.kind].label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {priced.length > 0 && (
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="py-2.5 pr-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                    Total{" "}
                    <span className="normal-case font-normal">
                      (priced)
                    </span>
                  </td>
                  <td className="py-2.5 px-3" />
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {formatINR(Math.round(totalInvested))}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {formatINR(Math.round(totalCurrent))}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    <span
                      className={totalUp ? "text-emerald-600" : "text-rose-600"}
                    >
                      {totalUp ? "+" : "−"}
                      {formatINR(Math.round(Math.abs(totalGain)))}
                    </span>
                  </td>
                  <td className="py-2.5 px-3" />
                  <td className="py-2.5 pl-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
