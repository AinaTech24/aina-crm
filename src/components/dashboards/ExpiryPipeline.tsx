import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";

import type { ExpiryRow } from "@/lib/dashboard/expiry-pipeline";
import { EmptySection } from "./EmptySection";

/**
 * Expiry pipeline — what lapses in the next 30 / 60 / 90 days.
 *
 * Forward-looking on purpose: everything already overdue belongs in the Action
 * Centre, this is the stuff you can still get ahead of. Each row names the
 * CONSEQUENCE rather than the metric, because "Bank mandate expiry 12" means
 * nothing to a new back-office hire and "renew before the SIP debit bounces"
 * means everything.
 *
 * The 30-day column carries the only colour. The other two are things to plan,
 * not things to panic about, and colouring all three would make the urgent
 * column stop reading as urgent.
 */
export function ExpiryPipeline({ rows }: { rows: ExpiryRow[] }) {
  const anything = rows.some((r) => r.d30 + r.d60 + r.d90 > 0);

  // Nothing expiring is the normal state for a well-run book, and on a quiet
  // week several sections are empty at once. One line, not a panel.
  if (!anything) {
    return (
      <EmptySection
        icon={CalendarClock}
        title="Expiry pipeline"
        note="Nothing lapses in the next 90 days."
      />
    );
  }

  return (
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          <span className="section-title">Expiry pipeline</span>
        </div>
      </div>
      <p className="text-2xs text-muted-foreground mb-3">
        What lapses in the next 30 / 60 / 90 days — act before it expires.
      </p>

      <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-medium pb-2">What</th>
                <th className="text-right font-medium pb-2 w-24 whitespace-nowrap">Next 30d</th>
                <th className="text-right font-medium pb-2 w-24 whitespace-nowrap">31–60d</th>
                <th className="text-right font-medium pb-2 w-24 whitespace-nowrap">61–90d</th>
                <th className="pb-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.label}</div>
                    <div className="text-2xs text-muted-foreground">{r.consequence}</div>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.d30 > 0 ? (
                      <span className="chip bg-destructive/10 text-destructive font-semibold">
                        {r.d30.toLocaleString("en-IN")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {r.d60.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {r.d90.toLocaleString("en-IN")}
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      href={r.href}
                      className="text-muted-foreground hover:text-foreground inline-flex"
                      title={`Open ${r.label}`}
                      aria-label={`Open ${r.label}`}
                    >
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>
    </div>
  );
}
