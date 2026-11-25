/**
 * A financial / non-financial request's details on the task page — what the
 * New task form captured: the request, its scheme rows (scheme, from-scheme,
 * amount or units, SIP day and frequency, folio), the mode, and the Business
 * entry it booked. Renders nothing for a general task. Pure; safe on server
 * and client.
 *
 * Tasks created on 2026-10-01 carry ONE scheme as flat fields
 * (meta.request.scheme / toScheme / units / sipDate …); they show as one row.
 *
 * A task from the request table (meta.request.lines, lib/tasks/request-lines)
 * shows its rows — member, request, scheme, amount, day, folio, mode, note —
 * and a link to each Business entry it booked.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney } from "@/lib/format";
import {
  CATEGORY_LABEL,
  FREQUENCIES,
  REQUEST_TYPE_BY_KEY,
  categoryOfType,
  type RequestDetails,
  type RequestRow,
} from "@/lib/tasks/request-types";
import { modeOptions, type RequestLine } from "@/lib/tasks/request-lines";

const FREQ_LABEL: Record<string, string> = Object.fromEntries(FREQUENCIES);

function legacyRow(r: RequestDetails, amount: number | null): RequestRow | null {
  if (!r.scheme && !r.toScheme && !r.units && !r.allUnits && !r.sipDate) return null;
  return {
    schemeName: r.toScheme ?? r.scheme ?? "",
    fromSchemeName: r.toScheme ? r.scheme : undefined,
    amount: amount ?? undefined,
    units: r.units ? Number(r.units) : undefined,
    allUnits: r.allUnits,
    folio: r.folio,
    frequency: r.frequency,
  };
}

export function TaskRequestSummary({ type, meta }: { type: string | null | undefined; meta: unknown }) {
  const category = categoryOfType(type);
  if (category === "general") return null;
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, any>;
  const r = (m.request && typeof m.request === "object" ? m.request : {}) as RequestDetails;
  const req = type ? REQUEST_TYPE_BY_KEY[type] : undefined;
  const amount = m.boValue != null && Number.isFinite(Number(m.boValue)) ? Number(m.boValue) : null;
  const mode = m.boChannel === "online" ? "Online" : m.boChannel === "offline" ? "Offline" : null;
  const entryId = typeof m.businessEntryId === "string" ? m.businessEntryId : null;

  const lines = Array.isArray((r as { lines?: unknown }).lines) ? ((r as { lines: RequestLine[] }).lines) : null;
  if (lines?.length) {
    const entryIds = [
      ...new Set([...(Array.isArray(m.businessEntryIds) ? m.businessEntryIds : []), ...(entryId ? [entryId] : [])].filter((x): x is string => typeof x === "string")),
    ];
    return <LinesSummary category={category} lines={lines} amount={amount} entryIds={entryIds} label={req?.label ?? "Several requests"} />;
  }

  const legacy = !r.rows?.length ? legacyRow(r, amount) : null;
  const rows: RequestRow[] = r.rows?.length ? r.rows : legacy ? [legacy] : [];
  const hasFrom = rows.some((x) => x.fromSchemeName);
  const hasUnits = rows.some((x) => x.units != null || x.allUnits);
  const hasDay = rows.some((x) => x.sipDay || x.frequency);
  const hasFolio = rows.some((x) => x.folio);
  const legacySipDate = legacy && r.sipDate ? r.sipDate : null;

  const facts: Array<[string, string]> = [];
  if (amount != null && (!rows.length || rows.length > 1)) facts.push([rows.length > 1 ? "Total" : (req?.labels?.amount ?? "Amount").replace(/\s*\(₹\)$/, ""), formatMoney(amount)]);
  if (r.folio && !rows.length) facts.push([req?.labels?.folio ?? "Folio", r.folio]);
  if (legacySipDate) facts.push(["Instalment date", formatDate(legacySipDate)]);
  if (mode) facts.push(["Mode", mode]);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge raw>{CATEGORY_LABEL[category]}</Badge>
        <span className="text-sm font-semibold">{req?.label ?? "Request type not chosen"}</span>
        {entryId && (
          <Link href={`/dashboard/business-entries/${entryId}`} className="ml-auto text-xs font-medium text-primary hover:underline">
            Business entry →
          </Link>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {hasFrom && <th className="py-1 pr-3 text-left font-medium">From</th>}
                <th className="py-1 pr-3 text-left font-medium">{hasFrom ? "To" : "Scheme"}</th>
                <th className="py-1 pr-3 text-right font-medium">Amount</th>
                {hasUnits && <th className="py-1 pr-3 text-right font-medium">Units</th>}
                {hasDay && <th className="py-1 pr-3 text-left font-medium">Day · frequency</th>}
                {hasFolio && <th className="py-1 text-left font-medium">Folio</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => (
                <tr key={i} className="border-t border-border/60">
                  {hasFrom && <td className="max-w-48 truncate py-1.5 pr-3" title={x.fromSchemeName}>{x.fromSchemeName ?? "—"}</td>}
                  <td className="max-w-64 py-1.5 pr-3">
                    <div className="truncate font-medium" title={x.schemeName}>{x.schemeName || "—"}</div>
                    {x.amcName && <div className="truncate text-muted-foreground">{x.amcName}</div>}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{x.amount != null ? formatMoney(x.amount) : "—"}</td>
                  {hasUnits && <td className="py-1.5 pr-3 text-right tabular-nums">{x.allUnits ? "All" : x.units ?? "—"}</td>}
                  {hasDay && (
                    <td className="py-1.5 pr-3">
                      {[x.sipDay ? `Day ${x.sipDay}` : null, x.frequency ? FREQ_LABEL[x.frequency] ?? x.frequency : null].filter(Boolean).join(" · ") || "—"}
                    </td>
                  )}
                  {hasFolio && <td className="py-1.5">{x.folio ?? "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function LinesSummary({
  category,
  lines,
  amount,
  entryIds,
  label,
}: {
  category: Exclude<ReturnType<typeof categoryOfType>, "general">;
  lines: RequestLine[];
  amount: number | null;
  entryIds: string[];
  label: string;
}) {
  const family = new Set(lines.map((l) => l.investorId)).size > 1;
  const has = (f: (l: RequestLine) => unknown) => lines.some((l) => f(l) != null && f(l) !== "" && f(l) !== false);
  const hasScheme = has((l) => l.schemeName || l.fromSchemeName);
  const hasUnits = has((l) => l.units ?? (l.allUnits || null));
  const hasDay = has((l) => l.sipDay || l.frequency);
  const hasFolio = has((l) => l.folio);
  const hasMode = has((l) => l.mode);
  const hasNote = has((l) => l.note);
  const modeLabel = (l: RequestLine) => modeOptions(l.requestKey).find(([k]) => k === l.mode)?.[1] ?? "—";

  return (
    <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge raw>{CATEGORY_LABEL[category]}</Badge>
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">
          · {lines.length} {lines.length === 1 ? "row" : "rows"}
          {amount != null ? ` · total ${formatMoney(amount)}` : ""}
        </span>
        {entryIds.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-x-3">
            {entryIds.map((id, i) => (
              <Link key={id} href={`/dashboard/business-entries/${id}`} className="text-xs font-medium text-primary hover:underline">
                Business entry{entryIds.length > 1 ? ` ${i + 1}` : ""} →
              </Link>
            ))}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 text-left font-medium">#</th>
              {family && <th className="py-1 pr-3 text-left font-medium">Member</th>}
              <th className="py-1 pr-3 text-left font-medium">Request</th>
              {hasScheme && <th className="py-1 pr-3 text-left font-medium">Scheme / product</th>}
              <th className="py-1 pr-3 text-right font-medium">Amount</th>
              {hasUnits && <th className="py-1 pr-3 text-right font-medium">Units</th>}
              {hasDay && <th className="py-1 pr-3 text-left font-medium">Day · frequency</th>}
              {hasFolio && <th className="py-1 pr-3 text-left font-medium">Folio / policy</th>}
              {hasMode && <th className="py-1 pr-3 text-left font-medium">Mode</th>}
              {hasNote && <th className="py-1 text-left font-medium">Note</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-border/60 align-top">
                <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                {family && <td className="max-w-40 truncate py-1.5 pr-3 font-medium" title={l.investorName}>{l.investorName}</td>}
                <td className="py-1.5 pr-3">{REQUEST_TYPE_BY_KEY[l.requestKey]?.label ?? l.requestKey}</td>
                {hasScheme && (
                  <td className="max-w-72 py-1.5 pr-3">
                    {l.fromSchemeName && <div className="truncate text-muted-foreground" title={l.fromSchemeName}>From {l.fromSchemeName}</div>}
                    <div className="truncate font-medium" title={l.schemeName}>{l.schemeName || "—"}</div>
                    {l.amcName && <div className="truncate text-muted-foreground">{l.amcName}</div>}
                  </td>
                )}
                <td className="py-1.5 pr-3 text-right tabular-nums">{l.amount != null ? formatMoney(l.amount) : "—"}</td>
                {hasUnits && <td className="py-1.5 pr-3 text-right tabular-nums">{l.allUnits ? "All" : l.units ?? "—"}</td>}
                {hasDay && (
                  <td className="py-1.5 pr-3">
                    {[l.sipDay ? `Day ${l.sipDay}` : null, l.frequency ? FREQ_LABEL[l.frequency] ?? l.frequency : null].filter(Boolean).join(" · ") || "—"}
                  </td>
                )}
                {hasFolio && <td className="py-1.5 pr-3">{l.folio ?? "—"}</td>}
                {hasMode && <td className="py-1.5 pr-3">{l.mode ? modeLabel(l) : "—"}</td>}
                {hasNote && <td className="max-w-56 py-1.5 text-muted-foreground">{l.note ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
