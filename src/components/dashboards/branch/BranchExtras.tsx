/**
 * The RM breakdowns that sit UNDER sections shared with the personal cockpit
 * (client book, contact health, data quality, risk profile). The shared
 * section renders the branch totals exactly as it does for one RM; these add
 * the "by RM" table beneath, through the section's `extra` slot.
 */

import type { RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import { ratio } from "@/lib/dashboard/branch/targets";
import { RmTable, rmRows } from "./RmTable";

const sumOf = (f: (r: RmLedgerRow) => number | null) => (rs: RmLedgerRow[]) => rs.reduce((s, r) => s + (f(r) ?? 0), 0);

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-5 text-2xs font-semibold text-muted-foreground">{children}</h3>;
}

type Props = { ledger: RmLedgerRow[]; rmHref: (id: string) => string; clientsOf: (r: RmLedgerRow) => string | null };

/** §15 — the book split by RM, every client count a link to that RM's clients. */
export function ClientBookByRm({ ledger, rmHref, clientsOf }: Props) {
  return (
    <>
      <Heading>By RM</Heading>
      <RmTable
        rows={rmRows(ledger)}
        rmHref={rmHref}
        cols={[
          { key: "c", label: "Clients", get: (r) => r.clients, href: clientsOf },
          { key: "ab", label: "A / B clients", get: (r) => r.abClients },
          { key: "aum", label: "AUM", get: (r) => r.aum, format: "currency" },
          { key: "sip", label: "SIP book", get: (r) => r.sipBook, format: "currency" },
          { key: "n", label: "New in period", get: (r) => r.newClients },
        ]}
      />
    </>
  );
}

/** §16 — contact bands per RM. */
export function ContactByRm({ ledger, rmHref, clientsOf }: Props) {
  return (
    <>
      <Heading>By RM</Heading>
      <RmTable
        rows={rmRows(ledger)}
        rmHref={rmHref}
        cols={[
          { key: "t", label: "Clients", get: (r) => r.clients, href: clientsOf },
          { key: "30", label: "≤ 30 days", get: (r) => r.contact30 },
          { key: "60", label: "31–60", get: (r) => r.contact60 },
          { key: "90", label: "61–90", get: (r) => r.contact90, tone: (v) => (v ? "warn" : "neutral") },
          { key: "90p", label: "90+", get: (r) => r.contact90p, tone: (v) => (v ? "bad" : "neutral") },
          { key: "none", label: "No record", title: "No contact has ever been logged — not the same as 90+ days.", get: (r) => r.contactNone },
        ]}
      />
    </>
  );
}

/** §22 — record completeness per RM. */
export function DataQualityByRm({ ledger, rmHref, clientsOf }: Props) {
  return (
    <>
      <Heading>By RM</Heading>
      <RmTable
        rows={rmRows(ledger)}
        rmHref={rmHref}
        cols={[
          { key: "t", label: "Clients", get: (r) => r.clients, href: clientsOf },
          { key: "c", label: "Complete", get: (r) => r.recordsComplete },
          { key: "i", label: "Incomplete", get: (r) => r.clients - r.recordsComplete, tone: (v) => (v ? "warn" : "neutral") },
          {
            key: "pct", label: "Completion", get: (r) => ratio(r.recordsComplete, r.clients), format: "percent",
            total: (rs) => ratio(sumOf((r) => r.recordsComplete)(rs), sumOf((r) => r.clients)(rs)),
          },
        ]}
      />
    </>
  );
}

/** §23 — risk-profile completion per RM. Nothing inferred for a missing profile. */
export function RiskByRm({ ledger, rmHref, clientsOf }: Props) {
  return (
    <>
      <Heading>Completion by RM</Heading>
      <RmTable
        rows={rmRows(ledger)}
        rmHref={rmHref}
        cols={[
          { key: "t", label: "Clients", get: (r) => r.clients, href: clientsOf },
          { key: "s", label: "Signed", get: (r) => r.riskSigned },
          { key: "pr", label: "Provisional", title: "Suggested, not yet confirmed by the client.", get: (r) => r.riskProvisional },
          { key: "p", label: "Pending", get: (r) => r.riskPending, tone: (v) => (v ? "warn" : "neutral") },
          { key: "d", label: "Due for review", title: "Signed more than a year ago.", get: (r) => r.riskDue },
          {
            key: "pct", label: "Completion", get: (r) => ratio(r.riskSigned, r.clients), format: "percent",
            total: (rs) => ratio(sumOf((r) => r.riskSigned)(rs), sumOf((r) => r.clients)(rs)),
          },
        ]}
      />
    </>
  );
}
