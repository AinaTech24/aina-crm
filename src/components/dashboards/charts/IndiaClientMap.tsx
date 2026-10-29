"use client";

/**
 * Where the clients are: India shaded by clients (or AUM) per state, with a
 * dot per city sized the same way, and beside it the share in the top two
 * states, the top states and the top cities. "City not recorded" is listed —
 * a blank address is a record gap, not a place.
 *
 * The outline (lib/geo/india-map.ts, ~100 KB) is loaded only when this card
 * renders. One hue, light to dark; a state with no clients stays neutral.
 */

import { useEffect, useMemo, useState } from "react";
import type { IndiaMapState } from "@/lib/geo/india-map";
import { CHART } from "@/lib/dashboard/chart-palette";
import { projectToMap } from "@/lib/geo/india-places";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";

export type MapStateFigure = { state: string; shapes: string[]; clients: number; aum: number };
export type MapCityFigure = { key: string; name: string; clients: number; aum: number; lat?: number; lon?: number };

const RAMP = ["#E0E7FF", "#C7D2FE", "#A5B4FC", "#818CF8", "#6366F1", "#4F46E5", "#3730A3"];

type Metric = "clients" | "aum";

export function IndiaClientMap({ states, cities, unplaced }: {
  states: MapStateFigure[];
  cities: MapCityFigure[];
  /** Clients whose address has no state we can place, and their AUM. */
  unplaced: { clients: number; aum: number; noCity: number; noCityAum: number };
}) {
  const [shapes, setShapes] = useState<IndiaMapState[] | null>(null);
  const [metric, setMetric] = useState<Metric>("clients");
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("@/lib/geo/india-map").then((m) => { if (live) setShapes(m.INDIA_MAP_STATES); });
    return () => { live = false; };
  }, []);

  const val = (x: { clients: number; aum: number }) => (metric === "clients" ? x.clients : x.aum);
  const fmt = (v: number) => (metric === "clients" ? formatCount(v) : formatMoney(v));
  const total = states.reduce((a, s) => a + val(s), 0) + val(unplaced);

  const byShape = useMemo(() => {
    const m = new Map<string, MapStateFigure>();
    for (const s of states) for (const id of s.shapes) m.set(id, s);
    return m;
  }, [states]);

  // Seven classes on a rough log scale of the largest state.
  const max = Math.max(...states.map(val), 1);
  const colour = (v: number) => {
    if (v <= 0) return null;
    const t = Math.log(1 + v) / Math.log(1 + max);
    return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
  };

  const sorted = [...states].sort((a, b) => val(b) - val(a)).filter((s) => val(s) > 0);
  const topTwo = sorted.slice(0, 2);
  const topTwoShare = total > 0 ? (topTwo.reduce((a, s) => a + val(s), 0) / total) * 100 : 0;
  const placed = cities.filter((c) => c.lat != null && c.lon != null && val(c) > 0);
  const cmax = Math.max(...placed.map(val), 1);
  const radius = (v: number) => 3 + Math.sqrt(v / cmax) * 13;
  const topCities = [...cities].filter((c) => val(c) > 0).sort((a, b) => val(b) - val(a)).slice(0, 7);
  const hovered = hover ? byShape.get(hover) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="min-w-0 space-y-2 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="dash-seg" role="group" aria-label="Shade the map by">
            {(["clients", "aum"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>
                {m === "clients" ? "Clients" : "AUM"}
              </button>
            ))}
          </div>
          <span className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
            {hovered ? `${hovered.state}: ${fmt(val(hovered))} · ${formatPercent(total ? (val(hovered) / total) * 100 : 0, 1)}` : ""}
          </span>
        </div>
        <div className="relative mx-auto w-full max-w-lg" style={{ aspectRatio: "612 / 696" }}>
          {shapes ? (
            <svg viewBox="0 0 612 696" className="absolute inset-0 size-full" role="img"
              aria-label={`Map of India shaded by ${metric === "clients" ? "clients" : "AUM"} per state`}>
              <g>
                {shapes.map((s) => {
                  const f = byShape.get(s.id);
                  const fill = f ? colour(val(f)) : null;
                  return (
                    <path key={s.id} d={s.d} fill={fill ?? "#EEF0F4"} stroke="#FFFFFF" strokeWidth={0.8}
                      onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover((h) => (h === s.id ? null : h))}
                      style={{ transition: "fill .2s" }}>
                      <title>{f ? `${f.state}: ${fmt(val(f))}` : `${s.name}: no clients`}</title>
                    </path>
                  );
                })}
              </g>
              <g>
                {placed.sort((a, b) => val(b) - val(a)).map((c) => {
                  const { x, y } = projectToMap(c.lat!, c.lon!);
                  return (
                    <circle key={c.key} cx={x} cy={y} r={radius(val(c))} fill={CHART.amber} fillOpacity={0.85} stroke="#FFFFFF" strokeWidth={1.5}>
                      <title>{`${c.name}: ${fmt(val(c))}`}</title>
                    </circle>
                  );
                })}
              </g>
            </svg>
          ) : (
            <div className="absolute inset-0 animate-pulse rounded-xl bg-secondary/60" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm border border-border" style={{ background: "#EEF0F4" }} />None</span>
          <span className="inline-flex items-center gap-0.5">
            {RAMP.map((c) => <span key={c} className="h-3 w-4 rounded-sm" style={{ background: c }} />)}
            <span className="ml-1">Fewer → more {metric === "clients" ? "clients" : "AUM"}</span>
          </span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-full" style={{ background: CHART.amber }} />City</span>
        </div>
      </div>

      <div className="min-w-0 space-y-3 lg:col-span-2">
        {topTwo.length > 0 && (
          <div className="dash-tile">
            <div className="text-2xl font-semibold tabular-nums text-primary">{formatPercent(topTwoShare, 0)}</div>
            <div className="text-xs text-foreground">
              of {metric === "clients" ? "clients" : "AUM"} is in {topTwo.map((s) => s.state).join(" and ")}
            </div>
          </div>
        )}
        <RankList title="Top states" rows={sorted.slice(0, 5).map((s) => ({ key: s.state, name: s.state, v: val(s) }))} fmt={fmt} colour={CHART.indigo} />
        <RankList title="Top cities" rows={topCities.map((c) => ({ key: c.key, name: c.name, v: val(c) }))} fmt={fmt} colour={CHART.amber} />
        {(unplaced.noCity > 0 || unplaced.clients > 0) && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {unplaced.noCity > 0 && (
              <li className="flex justify-between gap-3"><span>City not recorded</span>
                <span className="tabular-nums">{metric === "clients" ? formatCount(unplaced.noCity) : formatMoney(unplaced.noCityAum)}</span></li>
            )}
            {unplaced.clients > 0 && (
              <li className="flex justify-between gap-3"><span>State not recorded</span>
                <span className="tabular-nums">{fmt(val(unplaced))}</span></li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function RankList({ title, rows, fmt, colour }: {
  title: string; rows: Array<{ key: string; name: string; v: number }>; fmt: (v: number) => string; colour: string;
}) {
  if (!rows.length) return null;
  const top = rows[0].v || 1;
  return (
    <section>
      <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{r.name}</span>
              <span className="tabular-nums text-muted-foreground">{fmt(r.v)}</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, (r.v / top) * 100)}%`, background: colour }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
