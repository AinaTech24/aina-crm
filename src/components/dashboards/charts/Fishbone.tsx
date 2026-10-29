/**
 * Cause and effect: the problem at the head (e.g. "142 SIP rejections"), one
 * bone per cause group, the causes along each bone with their counts. The
 * single biggest cause is marked red — the thing to fix first.
 *
 * The bones are SVG stretched to the box; the words are HTML placed on the
 * same coordinates, so text never scales with the card. Below `sm` there is
 * no room for a fish: the same content renders as a grouped list.
 * Server-safe.
 */

import { CHART } from "@/lib/dashboard/chart-palette";
import { formatCount } from "@/lib/format";

export type FishboneBone = { name: string; causes: Array<{ label: string; count: number }> };

// Geometry in a 1000 × 560 box.
const W = 1000;
const H = 560;
const SPINE_Y = 280;
const SPINE_END = 760;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export function Fishbone({ bones, head, headLabel }: { bones: FishboneBone[]; head: string; headLabel: string }) {
  const shown = bones.filter((b) => b.causes.length).slice(0, 6);
  const top = Math.max(0, ...shown.flatMap((b) => b.causes.map((c) => c.count)));
  const upper = shown.filter((_, i) => i % 2 === 0);
  const lower = shown.filter((_, i) => i % 2 === 1);
  const slots = Math.max(upper.length, lower.length, 1);
  const step = (SPINE_END - 120) / slots;
  type Placed = { bone: FishboneBone; baseX: number; tipX: number; tipY: number; up: boolean };
  const placed: Placed[] = [
    ...upper.map((bone, i) => ({ bone, baseX: 140 + step * (i + 0.85), tipX: 140 + step * (i + 0.85) - 110, tipY: 70, up: true })),
    ...lower.map((bone, i) => ({ bone, baseX: 140 + step * (i + 0.85), tipX: 140 + step * (i + 0.85) - 110, tipY: H - 70, up: false })),
  ];
  const total = shown.reduce((a, b) => a + b.causes.reduce((x, c) => x + c.count, 0), 0) || 1;

  return (
    <>
      <div className="relative hidden w-full sm:block" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          <line x1={30} y1={SPINE_Y} x2={SPINE_END} y2={SPINE_Y} stroke="currentColor" strokeWidth={2.5} vectorEffect="non-scaling-stroke" className="text-foreground" />
          <path d={`M${SPINE_END - 2},${SPINE_Y - 12} L${SPINE_END + 16},${SPINE_Y} L${SPINE_END - 2},${SPINE_Y + 12} Z`} className="fill-foreground" />
          {placed.map((p) => (
            <g key={p.bone.name}>
              <line x1={p.baseX} y1={SPINE_Y} x2={p.tipX} y2={p.tipY} stroke={CHART.slate} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {p.bone.causes.slice(0, 3).map((c, j) => {
                const t = 0.24 + j * 0.27;
                const x = p.tipX + (p.baseX - p.tipX) * t;
                const y = p.tipY + (SPINE_Y - p.tipY) * t;
                return <line key={c.label} x1={x} y1={y} x2={x + 14} y2={y} stroke={CHART.slate} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
              })}
            </g>
          ))}
        </svg>
        {/* Head */}
        <div className="absolute flex -translate-y-1/2 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-center"
          style={{ left: pct(SPINE_END + 24, W), top: pct(SPINE_Y, H), width: pct(W - SPINE_END - 30, W) }}>
          <span className="text-xl font-bold tabular-nums leading-tight text-foreground">{head}</span>
          <span className="text-2xs leading-snug text-muted-foreground">{headLabel}</span>
        </div>
        {placed.map((p) => {
          const sum = p.bone.causes.reduce((a, c) => a + c.count, 0);
          return (
            <div key={p.bone.name}>
              <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs font-bold text-foreground"
                style={{ left: pct(p.tipX, W), top: p.up ? undefined : pct(p.tipY + 8, H), bottom: p.up ? pct(H - p.tipY + 8, H) : undefined }}>
                {p.bone.name} · {formatCount(sum)}
              </span>
              {p.bone.causes.slice(0, 3).map((c, j) => {
                const t = 0.24 + j * 0.27;
                const x = p.tipX + (p.baseX - p.tipX) * t;
                const y = p.tipY + (SPINE_Y - p.tipY) * t;
                const hot = c.count === top && top > 0;
                return (
                  <span key={c.label} className={`absolute -translate-y-1/2 whitespace-nowrap text-2xs ${hot ? "font-bold" : "text-foreground"}`}
                    style={{ left: pct(x + 18, W), top: pct(y, H), color: hot ? CHART.red : undefined }}
                    title={`${p.bone.name} › ${c.label}: ${formatCount(c.count)} (${Math.round((c.count / total) * 100)}% of all)`}>
                    {hot && <span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: CHART.red }} />}
                    {c.label} {formatCount(c.count)}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Phones: the same causes as a list. */}
      <ul className="space-y-2 sm:hidden">
        <li className="text-sm font-semibold">{head} {headLabel}</li>
        {shown.map((b) => (
          <li key={b.name} className="text-sm">
            <span className="font-semibold">{b.name}</span>
            <span className="text-muted-foreground"> · {b.causes.map((c) => `${c.label} ${formatCount(c.count)}`).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
