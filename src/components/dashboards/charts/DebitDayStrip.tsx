/**
 * The SIP debit calendar: how much SIP money falls due on each day of the
 * month, with last month's rejections marked under the day they bounced on.
 * The next few days are drawn solid so the team sees the coming peak.
 * Plain HTML (crisp text at any width). Server-safe.
 */

import { CHART } from "@/lib/dashboard/chart-palette";
import { formatMoney } from "@/lib/format";

export type DebitDay = { day: number; amount: number; sips: number; rejections: number };

export function DebitDayStrip({ days, today, ahead = 4 }: { days: DebitDay[]; today: number; ahead?: number }) {
  const max = Math.max(...days.map((d) => d.amount), 1);
  const peak = days.reduce((a, d) => (d.amount > a.amount ? d : a), days[0]);
  const soon = (d: number) => {
    const diff = (d - today + 31) % 31;
    return diff >= 0 && diff < ahead;
  };
  return (
    <div className="space-y-2">
      {peak && peak.amount > 0 && (
        <p className="text-xs text-muted-foreground">
          Peak: <span className="font-semibold text-foreground">{formatMoney(peak.amount)}</span> on the {ordinal(peak.day)}
        </p>
      )}
      <div className="flex h-28 items-end gap-0.5" role="list" aria-label="SIP money due by day of month">
        {days.map((d) => (
          <div key={d.day} role="listitem" className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`Day ${d.day}: ${formatMoney(d.amount)} due · ${d.sips} SIP${d.sips === 1 ? "" : "s"}${d.rejections ? ` · ${d.rejections} rejected last month` : ""}`}>
            <span
              className="block w-full rounded-t-sm"
              style={{
                height: `${d.amount > 0 ? Math.max(3, (d.amount / max) * 100) : 0}%`,
                background: soon(d.day) ? CHART.indigo : CHART.slate,
                opacity: soon(d.day) ? 1 : 0.55,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5" aria-hidden>
        {days.map((d) => (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
            <span className="rounded-full" style={{
              width: d.rejections ? Math.min(12, 5 + d.rejections * 1.5) : 0, height: d.rejections ? Math.min(12, 5 + d.rejections * 1.5) : 0,
              background: CHART.red, opacity: 0.85,
            }} />
            <span className="text-2xs text-muted-foreground">{d.day === 1 || d.day % 5 === 0 ? d.day : ""}</span>
          </div>
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        <span><span className="mr-1 inline-block size-2.5 rounded-sm align-middle" style={{ background: CHART.indigo }} />Due in the next {ahead} days</span>
        <span><span className="mr-1 inline-block size-2.5 rounded-full align-middle" style={{ background: CHART.red }} />Rejections last month on that day</span>
      </p>
    </div>
  );
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
