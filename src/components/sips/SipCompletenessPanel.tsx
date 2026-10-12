"use client";

/**
 * Registrar status coverage for the SIP Book (Phase 3G): how much of the
 * firm's SIP registrations a registrar status report has VERIFIED, per
 * registrar and ARN, and which reports (and periods) that rests on. The SIP
 * book's figures count verified registrations only; this says what they
 * leave out, so a partial book is never read as the whole one.
 */
import { AlertTriangle } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatDate, formatMoney } from "@/lib/format";
import type { SipBookCompleteness, RegistrarSipCompleteness } from "@/lib/metrics/sip-completeness";

const rtaName = (r: string) => (r === "kfintech" ? "KFintech" : r === "cams" ? "CAMS" : r);
const n = (v: number) => v.toLocaleString("en-IN");

export function SipCompletenessPanel({ data }: { data: SipBookCompleteness }) {
  if (!data.hasMaster) return null;
  const t = data.totals;
  const columns: Column<RegistrarSipCompleteness>[] = [
    { key: "rta", header: "Registrar", cell: (r) => rtaName(r.rta) },
    { key: "arn", header: "ARN", cell: (r) => r.arn ?? <span className="text-muted-foreground" title="The report does not state the ARN on its rows">Not stated</span> },
    { key: "regs", header: "Registrations", align: "right", cell: (r) => n(r.registrations) },
    { key: "active", header: "Verified active", align: "right", cell: (r) => <>{n(r.verifiedActive.count)}{r.verifiedActive.monthly ? <span className="text-muted-foreground"> · {formatMoney(r.verifiedActive.monthly)}/mo</span> : null}</> },
    { key: "pending", header: "Pending", align: "right", cell: (r) => n(r.pending.count) },
    { key: "observed", header: "Recent instalments, status unverified", align: "right", cell: (r) => n(r.observed.count) },
    { key: "unknown", header: "Status unknown", align: "right", cell: (r) => n(r.unknown) },
    { key: "last", header: "Last status report", cell: (r) => (data.lastVerifiedStatus[r.rta] ? formatDate(data.lastVerifiedStatus[r.rta]!) : <span className="text-muted-foreground">None imported</span>) },
  ];
  return (
    <section className="card-surface p-4 space-y-3" aria-labelledby="sip-coverage">
      <div className="flex items-start gap-2">
        {!data.complete && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />}
        <div>
          <h2 id="sip-coverage" className="font-semibold text-foreground">Registrar status coverage</h2>
          <p className="text-sm text-muted-foreground">
            {data.complete
              ? `Every one of the ${n(t.registrations)} registrations on record has a status from a registrar report.`
              : `The SIP book counts only registrations a registrar status report verified. Of ${n(t.registrations)} on record, ${n(t.verifiedActive.count)} are verified active (${formatMoney(t.verifiedActive.monthly)} a month) and ${n(t.pending.count)} pending${t.verifiedActive.inBook < t.verifiedActive.count ? ` — ${n(t.verifiedActive.inBook)} of the active ones are in the book; the others have no client on record or differ from a SIP already in the CRM` : ""}. ${n(t.observed.count)} show recent instalments but no verified status, and ${n(t.unknown)} have none: this is not the firm's complete SIP book.`}
          </p>
        </div>
      </div>
      <DataTable rows={data.byRegistrar} columns={columns} rowKey={(r) => `${r.rta}|${r.arn ?? ""}`} density="compact" caption="SIP registrations by registrar and ARN, by verified status" />
      {data.reports.length > 0 && (
        <p className="text-2xs text-muted-foreground">
          Sources:{" "}
          {data.reports.map((r, i) => (
            <span key={`${r.report}-${r.importedAt}`}>
              {i ? " · " : ""}
              {r.report} ({rtaName(r.rta)}, {n(r.rows)} rows{r.registeredFrom ? `, registered ${formatDate(r.registeredFrom)} – ${formatDate(r.registeredTo!)}` : ""}{r.statesLifecycle ? "" : ", no status column"}, imported {formatDate(r.importedAt)})
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
