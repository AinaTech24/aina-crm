/**
 * Two views on the Rejections tab beside the register: WHY SIPs bounced in
 * the period (a fishbone of causes), and WHEN money falls due (the debit
 * calendar, with last month's bounces under their day) — so the team fixes
 * the biggest cause and calls ahead of the next peak.
 */

import { CalendarDays, GitBranch } from "lucide-react";
import { Section } from "../my/Shared";
import { Fishbone } from "../charts/Fishbone";
import { DebitDayStrip } from "../charts/DebitDayStrip";
import { formatCount } from "@/lib/format";
import { inPeriod } from "@/lib/dashboard/ops/fmt";
import type { DebitCalendar, RejectionFishbone } from "@/lib/dashboard/ops/sip";

export function RejectionCausesPanel({ f, periodLabel }: { f: RejectionFishbone; periodLabel: string }) {
  if (!f.total) return null;
  const causes = f.total - f.unrecorded;
  return (
    <Section
      title="Why SIPs bounced"
      subtitle={`Rejections ${inPeriod(periodLabel)}, by cause.`}
      icon={<GitBranch className="size-4" />}
      note={f.unrecorded
        ? `${formatCount(f.unrecorded)} rejection${f.unrecorded === 1 ? " has" : "s have"} no reason recorded and ${f.unrecorded === 1 ? "is" : "are"} not on the diagram.`
        : undefined}
    >
      {causes > 0 ? (
        <Fishbone bones={f.bones} head={formatCount(causes)} headLabel={`SIP rejections · ${periodLabel}`} />
      ) : (
        <p className="dash-empty text-sm">No rejection in the period has a reason recorded yet.</p>
      )}
    </Section>
  );
}

export function DebitCalendarPanel({ c }: { c: DebitCalendar }) {
  if (!c.days.some((d) => d.sips || d.rejections)) return null;
  return (
    <Section
      title="SIP debit calendar"
      subtitle={`Active SIP instalments by debit day, and ${c.lastMonth}'s rejections under the day they bounced.`}
      icon={<CalendarDays className="size-4" />}
      note={c.undated ? `${formatCount(c.undated)} active SIP${c.undated === 1 ? " has" : "s have"} no debit day recorded.` : undefined}
    >
      <DebitDayStrip days={c.days} today={c.today} />
    </Section>
  );
}
