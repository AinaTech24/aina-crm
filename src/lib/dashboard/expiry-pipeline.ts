/**
 * Expiry pipeline — what lapses in the next 30 / 60 / 90 days.
 *
 * Adopted from a competitor dashboard, and the most useful thing on it: an MFD
 * practice does not usually break because someone made a bad call, it breaks
 * because a bank mandate quietly expired and the SIP debit bounced, or a CKYC
 * lapsed and a transaction was rejected at the RTA. Every one of these has a
 * date sitting in the database already; nothing here is new data, it is the six
 * lapse clocks gathered into one table so they can be acted on before they fire.
 *
 * Deliberately NOT "overdue" — that is what the Action Centre is for. This is
 * strictly forward-looking: today .. +90 days, bucketed 1-30 / 31-60 / 61-90.
 * Anything already past its date is somebody's problem today, not a forecast.
 */
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

export type ExpiryRow = {
  key: string;
  label: string;
  /** What actually goes wrong if it lapses — the reason to act, not the metric. */
  consequence: string;
  href: string;
  d30: number;
  d60: number;
  d90: number;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function loadExpiryPipeline(
  tx: Tx,
  branchId?: string | null
): Promise<ExpiryRow[]> {
  const byBranch = (col: string) =>
    branchId ? sql`AND ${sql.raw(col)} = ${branchId}::uuid` : sql``;

  /**
   * One row per source. `buckets` counts a date column into the three windows
   * in a single pass — six cheap aggregates rather than eighteen.
   */
  const res = await tx.execute(sql`
    WITH live AS (
      SELECT id, branch_id FROM investors
       WHERE deleted_at IS NULL AND status = 'active'
    )
    SELECT 'mandate' AS key,
           COUNT(*) FILTER (WHERE m.expires_at::date <= current_date + 30)  AS d30,
           COUNT(*) FILTER (WHERE m.expires_at::date >  current_date + 30
                              AND m.expires_at::date <= current_date + 60)  AS d60,
           COUNT(*) FILTER (WHERE m.expires_at::date >  current_date + 60
                              AND m.expires_at::date <= current_date + 90)  AS d90
      FROM mandates m JOIN live i ON i.id = m.investor_id
     WHERE m.expires_at IS NOT NULL
       AND m.expires_at::date >= current_date
       AND m.expires_at::date <= current_date + 90
       AND COALESCE(m.status, '') <> 'cancelled'
       ${byBranch("i.branch_id")}

    UNION ALL
    SELECT 'sip_end',
           COUNT(*) FILTER (WHERE s.end_date::date <= current_date + 30),
           COUNT(*) FILTER (WHERE s.end_date::date >  current_date + 30 AND s.end_date::date <= current_date + 60),
           COUNT(*) FILTER (WHERE s.end_date::date >  current_date + 60 AND s.end_date::date <= current_date + 90)
      FROM sips s JOIN live i ON i.id = s.investor_id
     WHERE s.end_date IS NOT NULL
       AND s.end_date::date >= current_date AND s.end_date::date <= current_date + 90
       AND s.status = 'active'
       ${byBranch("i.branch_id")}

    UNION ALL
    SELECT 'ckyc',
           COUNT(*) FILTER (WHERE v.ckyc_expiry_at::date <= current_date + 30),
           COUNT(*) FILTER (WHERE v.ckyc_expiry_at::date >  current_date + 30 AND v.ckyc_expiry_at::date <= current_date + 60),
           COUNT(*) FILTER (WHERE v.ckyc_expiry_at::date >  current_date + 60 AND v.ckyc_expiry_at::date <= current_date + 90)
      FROM investors v
     WHERE v.deleted_at IS NULL AND v.status = 'active' AND v.ckyc_expiry_at IS NOT NULL
       AND v.ckyc_expiry_at::date >= current_date AND v.ckyc_expiry_at::date <= current_date + 90
       ${byBranch("v.branch_id")}

    UNION ALL
    SELECT 'fatca',
           COUNT(*) FILTER (WHERE v.fatca_expiry_at::date <= current_date + 30),
           COUNT(*) FILTER (WHERE v.fatca_expiry_at::date >  current_date + 30 AND v.fatca_expiry_at::date <= current_date + 60),
           COUNT(*) FILTER (WHERE v.fatca_expiry_at::date >  current_date + 60 AND v.fatca_expiry_at::date <= current_date + 90)
      FROM investors v
     WHERE v.deleted_at IS NULL AND v.status = 'active' AND v.fatca_expiry_at IS NOT NULL
       AND v.fatca_expiry_at::date >= current_date AND v.fatca_expiry_at::date <= current_date + 90
       ${byBranch("v.branch_id")}

    UNION ALL
    SELECT 'premium',
           COUNT(*) FILTER (WHERE p.next_premium_due_date::date <= current_date + 30),
           COUNT(*) FILTER (WHERE p.next_premium_due_date::date >  current_date + 30 AND p.next_premium_due_date::date <= current_date + 60),
           COUNT(*) FILTER (WHERE p.next_premium_due_date::date >  current_date + 60 AND p.next_premium_due_date::date <= current_date + 90)
      FROM insurance_policies p
     WHERE p.next_premium_due_date IS NOT NULL
       AND p.next_premium_due_date::date >= current_date
       AND p.next_premium_due_date::date <= current_date + 90
       ${byBranch("p.branch_id")}

    UNION ALL
    SELECT 'registration',
           COUNT(*) FILTER (WHERE r.expiry_at::date <= current_date + 30),
           COUNT(*) FILTER (WHERE r.expiry_at::date >  current_date + 30 AND r.expiry_at::date <= current_date + 60),
           COUNT(*) FILTER (WHERE r.expiry_at::date >  current_date + 60 AND r.expiry_at::date <= current_date + 90)
      FROM legal_registrations r
     WHERE r.expiry_at IS NOT NULL
       AND r.expiry_at::date >= current_date AND r.expiry_at::date <= current_date + 90
  `);

  const META: Record<string, { label: string; consequence: string; href: string }> = {
    mandate: {
      label: "Bank mandate expiry",
      consequence: "Renew before the SIP debit bounces",
      href: "/dashboard/sips",
    },
    sip_end: {
      label: "SIP end date approaching",
      consequence: "Renewal conversation — the SIP simply stops",
      href: "/dashboard/reports/sip-expiry",
    },
    ckyc: {
      label: "CKYC validity",
      consequence: "Transactions get rejected at the RTA once it lapses",
      href: "/dashboard/reports/kyc-tracker",
    },
    fatca: {
      label: "FATCA declaration",
      consequence: "Folio is frozen for fresh purchases",
      href: "/dashboard/reports/kyc-tracker",
    },
    premium: {
      label: "Insurance premium due",
      consequence: "Policy lapses and cover is lost",
      href: "/dashboard/insurance/renewals",
    },
    registration: {
      label: "ARN / registration expiry",
      consequence: "You cannot transact at all once it expires",
      href: "/dashboard/legal-registrations",
    },
  };

  return (res.rows as Array<Record<string, unknown>>)
    .map((r) => {
      const meta = META[String(r.key)];
      return meta
        ? { key: String(r.key), ...meta, d30: n(r.d30), d60: n(r.d60), d90: n(r.d90) }
        : null;
    })
    .filter((r): r is ExpiryRow => r !== null)
    // Soonest pain first: most in the next 30 days, then overall volume.
    .sort((a, b) => b.d30 - a.d30 || b.d60 + b.d90 - (a.d60 + a.d90));
}
