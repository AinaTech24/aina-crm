"use client";

/**
 * §23 client category · §24 client type — the in-force book, with a Personal /
 * Commercial / All switch. Category and type are taxonomy, so nothing here is
 * coloured.
 */

import { useState } from "react";
import { Users } from "lucide-react";
import type { BookCut } from "@/lib/dashboard/insurance/clients";
import { formatCount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const CAT_ORDER = ["A", "B", "C", "D", "none"];
const CAT_LABEL: Record<string, string> = { A: "A", B: "B", C: "C", D: "D", none: "Uncategorised" };
const TYPE_ORDER = ["head", "member", "individual", "corporate"];
const TYPE_LABEL: Record<string, string> = { head: "Family head", member: "Family member", individual: "Individual", corporate: "Corporate" };

export function BookCuts({ byCategory, byType, lockedLine }: {
  byCategory: BookCut[]; byType: BookCut[];
  /** The dashboard's own line filter — the book is already that line only. */
  lockedLine?: "personal" | "commercial" | null;
}) {
  const [picked, setLine] = useState<"all" | "personal" | "commercial">("all");
  const line = lockedLine ? "all" : picked;
  const pickRows = (xs: BookCut[], order: string[]) =>
    order.map((k) => xs.find((x) => x.key === k && x.line === line) ?? { key: k, line, clients: 0, premium: 0, policies: 0 });
  const Block = ({ title, rows, labels }: { title: string; rows: BookCut[]; labels: Record<string, string> }) => (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">{title}</h3>
      <div className="table-scroll">
        <table className="w-full">
          <thead><tr><th scope="col">{title.endsWith("category") ? "Category" : "Type"}</th><th scope="col" className="text-right">Clients</th><th scope="col" className="text-right">Premium in force</th><th scope="col" className="text-right">Policies</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-2 text-xs font-medium">{labels[r.key] ?? r.key}</td>
                <td className="py-2 text-right text-xs tabular-nums">{formatCount(r.clients)}</td>
                <td className="py-2 text-right text-xs tabular-nums">{formatMoney(r.premium)}</td>
                <td className="py-2 text-right text-xs tabular-nums">{formatCount(r.policies)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Insurance clients by category and type">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h2 className="section-title flex items-center gap-2"><Users className="size-4 text-muted-foreground" /> Clients by category and type</h2>
          <p className="section-subtitle mt-1">The in-force {lockedLine ? `${lockedLine === "personal" ? "Personal" : "Commercial"} Lines ` : ""}book by client category (A–D) and by client type.</p>
        </div>
        {!lockedLine && <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5" role="group" aria-label="Line">
          {([["all", "All"], ["personal", "Personal"], ["commercial", "Commercial"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={line === k} onClick={() => setLine(k)}
              className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium", line === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {l}
            </button>
          ))}
        </div>}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="By client category" rows={pickRows(byCategory, CAT_ORDER)} labels={CAT_LABEL} />
        <Block title="By client type" rows={pickRows(byType, TYPE_ORDER)} labels={TYPE_LABEL} />
      </div>
      <p className="mt-4 text-2xs text-muted-foreground">
        A client is counted under the category and type recorded on the CRM; a blank category is “Uncategorised”, never assumed. Family head is the family&apos;s primary member; Corporate is a corporate or company client.
      </p>
    </section>
  );
}
