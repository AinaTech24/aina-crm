/**
 * §21 monthly performance summary — this month against last.
 *
 * Both columns cover the SAME SLICE of their month: 1–22 September against
 * 1–22 August. Comparing 22 days against a full 31 would show every metric
 * collapsing on the 1st of every month and recovering by the 30th, which is
 * an artefact of the calendar rather than anything about the business.
 *
 * The brief's divide-by-zero rule is enforced in the loader, not here: a zero
 * or absent previous value produces `changePct: null`, and null prints "N/A".
 */

import { CalendarRange } from "lucide-react";
import type { MonthRow } from "@/lib/dashboard/my/kpis";
import { Figure, Num, Section, Table } from "./Shared";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MyMonthlySummary({ rows, monthLabel, prevLabel }: {
  rows: MonthRow[];
  monthLabel: string;
  prevLabel: string;
}) {
  return (
    <Section
      title="Month on month"
      subtitle="Every headline figure, this month against the same stretch of last month."
      icon={<CalendarRange className="size-4" />}
      note="Both columns cover the same days of their month, so the 3rd is compared with the 3rd. AUM and SIP book use the recorded month-end snapshot — they are balances and cannot be recomputed after the fact."
    >
      <Table
        rows={rows.length}
        empty="Nothing to compare."
        head={
          <>
            <th scope="col">Metric</th>
            <th scope="col" className="text-right">{prevLabel}</th>
            <th scope="col" className="text-right">{monthLabel}</th>
            <th scope="col" className="text-right">Change</th>
            <th scope="col" className="text-right">Change %</th>
          </>
        }
      >
        {rows.map((r) => {
          const change =
            r.previous != null && r.current != null ? r.current - r.previous : null;
          // Up is not always good. For redemption and stopped SIPs, it is the
          // bad direction, so the tone follows the metric rather than the sign.
          const good = change == null || change === 0 ? null : r.inverse ? change < 0 : change > 0;
          return (
            <tr key={r.key}>
              <td className="py-2.5 font-medium">{r.label}</td>
              <Num>
                <Figure
                  value={r.previous}
                  format={r.format}
                  unavailable="No recorded value for last month."
                />
              </Num>
              <Num><Figure value={r.current} format={r.format} /></Num>
              <Num tone={good == null ? "neutral" : good ? "good" : "bad"}>
                {change == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <>
                    {change > 0 ? "+" : change < 0 ? "−" : ""}
                    <Figure value={Math.abs(change)} format={r.format} />
                  </>
                )}
              </Num>
              <Num tone={good == null ? "neutral" : good ? "good" : "bad"}>
                {r.changePct == null ? (
                  <span
                    className="text-muted-foreground"
                    title={
                      r.previous == null
                        ? "No recorded value for last month."
                        : "Last month was zero, so there is no percentage to take."
                    }
                  >
                    N/A
                  </span>
                ) : (
                  <span className={cn("font-medium")}>
                    {r.changePct > 0 ? "+" : ""}
                    {formatPercent(r.changePct * 100, 1)}
                  </span>
                )}
              </Num>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}
