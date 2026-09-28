/**
 * §3 Target vs achievement and §22 FY scorecard.
 *
 * One panel, not two, because they are the same six numbers read at two
 * horizons and splitting them meant the reader comparing a meter on row 4
 * against a bar on row 14. The FY scorecard is the "Remaining" column; the
 * meters carry Target, Actual and Gap.
 */

import { Target } from "lucide-react";
import type { TargetMeter } from "@/lib/dashboard/my/kpis";
import { Figure, Meter, Num, Section, SectionLink, Table, Unavailable } from "./Shared";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MyTargets({ meters, fyLabel }: { meters: TargetMeter[]; fyLabel: string }) {
  const anyTarget = meters.some((m) => m.target != null);
  const pace = meters.find((m) => m.pace != null)?.pace ?? 0;

  return (
    <Section
      title="My targets"
      subtitle={`Where I stand against my own ${fyLabel} numbers — target, actual and the gap, never a bare percentage.`}
      icon={<Target className="size-4" />}
      action={<SectionLink href="/dashboard/team/scorecard/targets">Set targets</SectionLink>}
      note={`The notch on each bar marks how far through ${fyLabel} we are — ${(pace * 100).toFixed(0)}% elapsed. Half a target in September is on pace; half in February is not.`}
    >
      {!anyTarget ? (
        <Unavailable>
          No annual targets have been set against your name for {fyLabel}, so there is nothing to
          measure against. Actuals are still shown below. Targets are set per person on the
          Team scorecard.
        </Unavailable>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {meters.map((m) => (
          <Meter
            key={m.key}
            label={m.label}
            target={m.target}
            actual={m.actual}
            format={m.format}
            pace={m.pace}
            href={m.href}
            missing={m.missing}
          />
        ))}
      </div>

      {anyTarget && (
        <div className="mt-5">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            {fyLabel} scorecard
          </h3>
          <Table
            rows={meters.length}
            empty="No metrics to score."
            head={
              <>
                <th scope="col">Metric</th>
                <th scope="col" className="text-right">FY target</th>
                <th scope="col" className="text-right">Actual FYTD</th>
                <th scope="col" className="text-right">Remaining</th>
                <th scope="col" className="text-right">Achievement</th>
              </>
            }
          >
            {meters.map((m) => {
              const remaining = m.target != null ? Math.max(0, m.target - m.actual) : null;
              const onPace = m.pct != null && (m.pace == null ? m.pct >= 1 : m.pct >= m.pace);
              const judged = m.pct != null && (m.pace != null || m.pct >= 1);
              return (
                <tr key={m.key}>
                  <td className="py-2.5 font-medium">{m.label}</td>
                  <Num><Figure value={m.target} format={m.format} unavailable="Not set" /></Num>
                  <Num><Figure value={m.actual} format={m.format} /></Num>
                  <Num tone={remaining != null && remaining > 0 ? "warn" : "neutral"}>
                    <Figure value={remaining} format={m.format} unavailable="—" />
                  </Num>
                  <Num>
                    {m.pct == null ? (
                      <span className="text-muted-foreground" title="No target set.">Not set</span>
                    ) : (
                      <span className={cn("font-semibold", !judged ? "text-foreground" : onPace ? "text-success" : "text-warning-foreground")}>
                        {formatPercent(m.pct * 100, 1)}
                      </span>
                    )}
                  </Num>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
    </Section>
  );
}
