/**
 * §8 target vs achievement · §44 FY scorecard. Target · Actual · Gap ·
 * Achievement on every meter — never a percentage alone — and no year-end
 * forecast (the brief).
 */

import { Flag, Trophy } from "lucide-react";
import type { FyRow, TargetMeter } from "@/lib/dashboard/insurance/targets";
import { Meter, Num, Section, Table } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { LinkToggle } from "./parts";

export function TargetsPanel({ span, meters, spanHrefs, settingsHref, href, canSet }: {
  span: "mtd" | "qtd" | "fytd"; meters: TargetMeter[]; spanHrefs: Record<string, string>; settingsHref: string; href: string; canSet: boolean;
}) {
  const noneSet = meters.every((m) => m.annual == null);
  return (
    <Section title="Target vs achievement"
      icon={<Flag className="size-4" />}
      action={<LinkToggle current={span} options={[
        { key: "mtd", label: "MTD", href: spanHrefs.mtd }, { key: "qtd", label: "QTD", href: spanHrefs.qtd }, { key: "fytd", label: "FYTD", href: spanHrefs.fytd },
      ]} />}
      note={`Targets are the FY targets in Settings → Targets${span === "fytd" ? "; the notch is where the book should be by today at an even pace" : ", pro-rated by days to the period"}. A branch reads its own "Insurance" target and an RM their KRA target — premium only.`}>
      {noneSet && (
        <p className="mb-3 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2 text-2xs text-muted-foreground">
          No insurance target is set for this FY. {canSet ? <a href={settingsHref} className="font-medium text-primary hover:underline">Set the targets</a> : "Ask the firm owner to set them."}
        </p>
      )}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {meters.map((m) => (
          <Meter key={m.key} label={m.label} target={m.target} actual={m.actual} format={m.format} pace={span === "fytd" ? m.pace : null}
            href={href} missing={m.missing} />
        ))}
      </div>
    </Section>
  );
}

export function FyScorecard({ rows, fyLabel, comparable }: { rows: FyRow[]; fyLabel: string; comparable: boolean }) {
  return (
    <Section title="FY insurance scorecard" subtitle={`${fyLabel} — the year's target, where the book stands today and what remains.`}
      icon={<Trophy className="size-4" />}
      note={comparable ? "No year-end forecast is drawn: what remains is the target less what is booked." : "Targets are for the whole book; clear the product, line and client filters to compare against them."}>
      <Table rows={rows.length} empty="No insurance metric to score." head={<>
        <th scope="col">KPI</th>
        <th scope="col" className="text-right">FY target</th>
        <th scope="col" className="text-right">FYTD actual</th>
        <th scope="col" className="text-right">Remaining</th>
        <th scope="col" className="text-right">Achievement %</th>
      </>}>
        {rows.map((r) => {
          const f = (v: number | null) => (v == null ? <span className="text-muted-foreground">Not set</span> : r.format === "currency" ? formatMoney(v) : formatCount(v));
          return (
            <tr key={r.key}>
              <td className="py-2.5 text-xs font-medium">{r.label}</td>
              <Num>{f(r.target)}</Num>
              <Num>{r.format === "currency" ? formatMoney(r.actual) : formatCount(r.actual)}</Num>
              <Num>{r.target == null ? "—" : f(r.remaining)}</Num>
              <Num tone={r.pct == null ? "neutral" : r.pct >= 1 ? "good" : "neutral"}>{r.pct == null ? "—" : formatPercent(r.pct * 100, 1)}</Num>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}
