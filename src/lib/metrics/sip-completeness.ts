/**
 * How complete the Active SIP Book is (Phase 3G) — what the registrars have
 * VERIFIED versus what is only observed or unknown, per registrar and ARN,
 * with the status reports' dates and periods.
 *
 * The SIP book (`getSipBook`) counts only registrations a registrar status
 * report verified (lib/rta/posting/sip-book.ts posts nothing else). This
 * says how much of the firm's registrations that is, so a screen never
 * presents "4 SIPs" as the firm's whole book when 1,900 registrations have no
 * verified status:
 *
 *   verified active  a lifecycle report lists it live, started, not ended
 *   pending          registered, start date ahead
 *   observed         a processed instalment recently — activity on that
 *                    date, NOT a verified current status
 *   unknown          no status report covers it (MFSD230 / WBR49 rows with no
 *                    status, or known only from instalments)
 *   paused · stopped · expired · rejected   only where a registrar says so
 *
 * Firm-wide: registrar completeness is a property of the firm's reports, not
 * of an RM's slice. Nothing here is inferred from a missing instalment.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { monthlySipAmount } from "./sip";

/** `inBook`: of these, how many the CRM's SIP book holds (owner on record, no conflicting CRM SIP). */
export type SipStateCounts = { count: number; monthly: number; inBook: number };

export type RegistrarSipCompleteness = {
  rta: string;
  arn: string | null;
  registrations: number;
  /** In a registration report (MFSD243 / WBR49 / MFSD230) vs known only from instalments. */
  described: number;
  evidencedOnly: number;
  verified: number;
  verifiedActive: SipStateCounts;
  pending: SipStateCounts;
  observed: SipStateCounts;
  unknown: number;
  other: Record<string, number>;
};

export type StatusReport = {
  report: string; rta: string; rows: number; registeredFrom: string | null; registeredTo: string | null;
  statementDate: string | null; importedAt: string; statesLifecycle: boolean;
};

export type SipBookCompleteness = {
  hasMaster: boolean;
  totals: { registrations: number; verified: number; verifiedActive: SipStateCounts; pending: SipStateCounts; observed: SipStateCounts; unknown: number; other: Record<string, number> };
  byRegistrar: RegistrarSipCompleteness[];
  /** The registration reports the master was built from, newest first per report type. */
  reports: StatusReport[];
  /** The newest status report date per registrar (MFSD243 / WBR49; MFSD230 states no status). */
  lastVerifiedStatus: Record<string, string | null>;
  /** True only when every registration has a verified status. */
  complete: boolean;
  reasons: string[];
};

const LIFECYCLE_REPORTS = new Set(["MFSD243", "WBR49"]);

export async function getSipBookCompleteness(tx: Tx, tenantId: string): Promise<SipBookCompleteness> {
  const rows = (await tx.execute(sql`
    SELECT rta, arn, kind, state, confidence, described, amount::text AS amount, frequency, count(*)::int AS n, count(sip_id)::int AS in_book
      FROM rta_sip_registrations WHERE tenant_id = ${tenantId}::uuid
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  `)).rows as Array<{ rta: string; arn: string | null; kind: string; state: string; confidence: string; described: boolean; amount: string | null; frequency: string | null; n: number; in_book: number }>;

  const blank = (): SipStateCounts => ({ count: 0, monthly: 0, inBook: 0 });
  const totals: SipBookCompleteness["totals"] = { registrations: 0, verified: 0, verifiedActive: blank(), pending: blank(), observed: blank(), unknown: 0, other: {} };
  const reg = new Map<string, RegistrarSipCompleteness>();
  for (const r of rows) {
    const key = `${r.rta}|${r.arn ?? ""}`;
    const g = reg.get(key) ?? { rta: r.rta, arn: r.arn, registrations: 0, described: 0, evidencedOnly: 0, verified: 0, verifiedActive: blank(), pending: blank(), observed: blank(), unknown: 0, other: {} };
    reg.set(key, g);
    const monthly = r.amount == null ? 0 : monthlySipAmount(r.amount, r.frequency) * r.n;
    for (const t of [g, totals]) {
      t.registrations += r.n;
      if (r.confidence === "verified") t.verified += r.n;
      const bucket = r.kind !== "sip" ? `${r.kind}:${r.state}` : r.state;
      if (bucket === "VERIFIED_ACTIVE") { t.verifiedActive.count += r.n; t.verifiedActive.monthly += monthly; t.verifiedActive.inBook += r.in_book; }
      else if (bucket === "PENDING") { t.pending.count += r.n; t.pending.monthly += monthly; t.pending.inBook += r.in_book; }
      else if (bucket === "OBSERVED_ACTIVITY") { t.observed.count += r.n; t.observed.monthly += monthly; }
      else if (bucket === "UNKNOWN") t.unknown += r.n;
      else t.other[bucket] = (t.other[bucket] ?? 0) + r.n;
    }
    if (r.described) g.described += r.n; else g.evidencedOnly += r.n;
  }

  const reports = (await tx.execute(sql`
    SELECT b.report_code AS report, b.rta, count(r.id)::int AS rows,
           min(r.attrs->>'registrationDate') AS registered_from, max(r.attrs->>'registrationDate') AS registered_to,
           b.created_at::text AS imported_at
      FROM rta_staging_batches b JOIN rta_staging_rows r ON r.tenant_id = b.tenant_id AND r.batch_id = b.id
     WHERE b.tenant_id = ${tenantId}::uuid AND b.record_kind = 'registration' AND b.state IN ('ready_to_commit', 'exception')
     GROUP BY b.id, b.report_code, b.rta, b.created_at
     ORDER BY b.created_at DESC
  `)).rows as Array<{ report: string; rta: string; rows: number; registered_from: string | null; registered_to: string | null; imported_at: string }>;
  const statusReports: StatusReport[] = reports.map((r) => ({
    report: r.report, rta: r.rta, rows: r.rows, registeredFrom: r.registered_from, registeredTo: r.registered_to,
    // A registration report's own date is the latest registration it carries — the most its status can speak for.
    statementDate: r.registered_to, importedAt: r.imported_at, statesLifecycle: LIFECYCLE_REPORTS.has(r.report),
  }));
  const lastVerifiedStatus: Record<string, string | null> = {};
  for (const rta of new Set(rows.map((r) => r.rta))) {
    const d = statusReports.filter((r) => r.rta === rta && r.statesLifecycle).map((r) => r.statementDate).filter((x): x is string => !!x).sort().at(-1);
    lastVerifiedStatus[rta] = d ?? null;
  }

  const reasons: string[] = [];
  if (!rows.length) reasons.push("no SIP Master yet — import a registration report (KFintech MFSD243, CAMS WBR49)");
  if (totals.unknown) reasons.push(`${totals.unknown} registration(s) have no verified status`);
  if (totals.observed.count) reasons.push(`${totals.observed.count} show recent instalments but no verified registration status`);
  for (const [rta, d] of Object.entries(lastVerifiedStatus)) if (!d) reasons.push(`${rta === "cams" ? "CAMS" : "KFintech"}: no status report (WBR49 / MFSD243) imported`);
  for (const g of reg.values()) if (g.rta === "cams" && g.arn === null && g.registrations) { reasons.push("CAMS WBR49 does not state the ARN on its rows — CAMS registrations are not split by ARN"); break; }

  return {
    hasMaster: rows.length > 0,
    totals,
    byRegistrar: [...reg.values()].sort((a, b) => a.rta.localeCompare(b.rta) || (a.arn ?? "").localeCompare(b.arn ?? "")),
    reports: statusReports,
    lastVerifiedStatus,
    complete: rows.length > 0 && totals.unknown === 0 && totals.observed.count === 0 && Object.values(lastVerifiedStatus).every(Boolean),
    reasons,
  };
}
