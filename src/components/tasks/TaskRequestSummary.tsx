/**
 * A financial / non-financial request's details on the task page — what the
 * New task form captured: the request, amount or units, scheme (→ target
 * scheme), folio, instalment date and frequency, and mode. Renders nothing for
 * a general task. Pure; safe on server and client.
 */

import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney } from "@/lib/format";
import { FREQUENCIES, REQUEST_TYPE_BY_KEY, categoryOfType, type RequestDetails } from "@/lib/tasks/request-types";

const FREQ_LABEL = Object.fromEntries(FREQUENCIES);

export function TaskRequestSummary({ type, meta }: { type: string | null | undefined; meta: unknown }) {
  const category = categoryOfType(type);
  if (category === "general") return null;
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, any>;
  const r = (m.request && typeof m.request === "object" ? m.request : {}) as RequestDetails;
  const req = type ? REQUEST_TYPE_BY_KEY[type] : undefined;
  const amount = m.boValue != null && Number.isFinite(Number(m.boValue)) ? Number(m.boValue) : null;
  const mode = m.boChannel === "online" ? "Online" : m.boChannel === "offline" ? "Offline" : null;

  const facts: Array<[string, string]> = [];
  if (amount != null) facts.push(["Amount", formatMoney(amount)]);
  if (r.allUnits) facts.push(["Units", "All units"]);
  else if (r.units) facts.push(["Units", r.units]);
  if (r.scheme) facts.push([r.toScheme ? "From scheme" : "Scheme", r.scheme]);
  if (r.toScheme) facts.push(["To scheme", r.toScheme]);
  if (r.folio) facts.push(["Folio", r.folio]);
  if (r.sipDate) facts.push(["Instalment date", formatDate(r.sipDate)]);
  if (r.frequency) facts.push(["Frequency", FREQ_LABEL[r.frequency] ?? r.frequency]);
  if (mode) facts.push(["Mode", mode]);

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge raw>{category === "financial" ? "Financial" : "Non-financial"}</Badge>
        <span className="text-sm font-semibold">{req?.label ?? "Request type not chosen"}</span>
      </div>
      {facts.length > 0 && (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-medium" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
