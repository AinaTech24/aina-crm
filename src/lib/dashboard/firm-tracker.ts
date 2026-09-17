/**
 * Firm tracker — the numbers an MFD owner and their team want to see and track
 * in one place, scoped by date range, branch and team member.
 *
 * Design notes that matter:
 *
 * 1. Every figure here ALREADY has a screen that owns it (lead funnel, KYC
 *    tracker, SIP health, insurance renewals, tasks…). This loader exists to
 *    surface the number, not to re-implement the module. Each tile links
 *    through, so there is exactly one place where the detail — and the
 *    definition — lives.
 *
 * 2. The filters compose. `branchId` is applied on the tables that actually
 *    carry `branch_id` (leads, investors, activities, insurance_policies,
 *    insurance_claims); everything else reaches a branch by joining through
 *    `investors`. `rmId` narrows to one team member's book.
 *
 * 3. Counts are deliberately split "in the window" vs "as of now". A book-state
 *    figure (how many clients lack KYC) is not a period metric and must not
 *    silently shrink when someone picks "this week" — those queries ignore the
 *    date range on purpose, and the UI labels them "current".
 */
import { sql, type SQL } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof import("@/db/client").withTenant>[1]>[0];

export type TrackerScope = {
  from: Date;
  to: Date;
  branchId?: string | null;
  rmId?: string | null;
};

export type Bucket = { label: string; count: number; amount?: number };

export type FirmTracker = {
  leads: {
    bySource: Bucket[];
    byStage: Bucket[];
    totalInWindow: number;
    converted: number;
    conversionPct: number;
  };
  clients: {
    onboardedInWindow: number;
    families: number;
    clientsInFamilies: number;
    byCategoryAum: Bucket[];
    byCategorySip: Bucket[];
    riskDone: number;
    riskPending: number;
    riskProvisional: number;
    byKyc: Bucket[];
    byStatus: Bucket[];
    byReviewFrequency: Bucket[];
  };
  business: {
    sipNew: number;
    sipStopped: number;
    sipNet: number;
    sipNewAmount: number;
    equityPurchase: number;
    equityRedemption: number;
    equityNet: number;
    byProduct: Bucket[];
    totalAum: number;
    totalSipBook: number;
    avgSipTicket: number;
    avgLumpsumTicket: number;
  };
  insurance: {
    byType: Bucket[];
    renewalsDue: number;
    claimsByStatus: Bucket[];
    policiesTotal: number;
    premiumTotal: number;
  };
  team: {
    callsInWindow: number;
    activitiesByStatus: Bucket[];
    meetingsByStatus: Bucket[];
    tasksByStatus: Bucket[];
    tasksByAssignee: Bucket[];
    serviceRequestsByStatus: Bucket[];
    feedbackAvg: number;
    feedbackResponses: number;
  };
};

/** Rows -> Bucket[], newest schema-agnostic: expects {label, count, amount?}. */
function buckets(rows: unknown[]): Bucket[] {
  return (rows as Array<{ label: string | null; count: string | number; amount?: string | null }>)
    .filter((r) => r.label != null && String(r.label).trim() !== "")
    .map((r) => ({
      label: String(r.label),
      count: Number(r.count) || 0,
      ...(r.amount != null ? { amount: Number(r.amount) || 0 } : {}),
    }));
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function loadFirmTracker(tx: Tx, scope: TrackerScope): Promise<FirmTracker> {
  const { from, to, branchId, rmId } = scope;

  // Filter fragments. Each is `TRUE` when the filter is off, so they can be
  // AND-ed into any WHERE clause without branching the SQL string.
  const bBranch = (col: string): SQL =>
    branchId ? sql`${sql.raw(col)} = ${branchId}::uuid` : sql`TRUE`;
  const bRm = (col: string): SQL => (rmId ? sql`${sql.raw(col)} = ${rmId}::uuid` : sql`TRUE`);

  const [
    leadSrc, leadStage, leadTotals,
    clientWindow, families, catAum, risk, kyc, clientStatus, reviewFreq,
    sipFlow, equity, products, aumSip, tickets,
    insType, insRenewals, insClaims,
    calls, activityStatus, meetings, taskStatus, taskAssignee, serviceReq, csat,
  ] = await Promise.all([
    // ── LEADS ────────────────────────────────────────────────────────────
    tx.execute(sql`
      SELECT COALESCE(NULLIF(source, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM leads
       WHERE created_at >= ${from} AND created_at < ${to}
         AND ${bBranch("branch_id")} AND ${bRm("owner_id")}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(stage::text, ''), 'unknown') AS label, COUNT(*)::int AS count
        FROM leads
       WHERE converted_investor_id IS NULL
         AND ${bBranch("branch_id")} AND ${bRm("owner_id")}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    tx.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE converted_investor_id IS NOT NULL)::int AS converted
        FROM leads
       WHERE created_at >= ${from} AND created_at < ${to}
         AND ${bBranch("branch_id")} AND ${bRm("owner_id")}`),

    // ── CLIENTS ──────────────────────────────────────────────────────────
    tx.execute(sql`
      SELECT COUNT(*)::int AS onboarded
        FROM investors
       WHERE deleted_at IS NULL AND onboarded_at >= ${from} AND onboarded_at < ${to}
         AND ${bBranch("branch_id")} AND ${bRm("rm_id")}`),
    tx.execute(sql`
      SELECT (SELECT COUNT(*)::int FROM families WHERE ${bBranch("branch_id")}) AS families,
             (SELECT COUNT(*)::int FROM investors
               WHERE deleted_at IS NULL AND family_id IS NOT NULL
                 AND ${bBranch("branch_id")} AND ${bRm("rm_id")}) AS in_families`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(segment_tag, ''), 'Unsegmented') AS label,
             COUNT(*)::int AS count,
             COALESCE(SUM(aum::numeric), 0) AS amount,
             COALESCE(SUM(active_sip_amount::numeric), 0) AS sip
        FROM investors
       WHERE deleted_at IS NULL AND status = 'active'
         AND ${bBranch("branch_id")} AND ${bRm("rm_id")}
       GROUP BY 1 ORDER BY 3 DESC LIMIT 10`),
    tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE risk_profile IS NOT NULL
                                AND COALESCE(risk_profile_provisional, false) = false)::int AS done,
             COUNT(*) FILTER (WHERE risk_profile IS NULL)::int AS pending,
             COUNT(*) FILTER (WHERE COALESCE(risk_profile_provisional, false) = true)::int AS provisional
        FROM investors
       WHERE deleted_at IS NULL AND status = 'active'
         AND ${bBranch("branch_id")} AND ${bRm("rm_id")}`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(kyc_status::text, ''), 'not set') AS label, COUNT(*)::int AS count
        FROM investors
       WHERE deleted_at IS NULL AND status = 'active'
         AND ${bBranch("branch_id")} AND ${bRm("rm_id")}
       GROUP BY 1 ORDER BY 2 DESC`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(status::text, ''), 'unknown') AS label, COUNT(*)::int AS count
        FROM investors
       WHERE deleted_at IS NULL AND ${bBranch("branch_id")} AND ${bRm("rm_id")}
       GROUP BY 1 ORDER BY 2 DESC`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(review_frequency::text, ''), 'not set') AS label, COUNT(*)::int AS count
        FROM investors
       WHERE deleted_at IS NULL AND status = 'active'
         AND ${bBranch("branch_id")} AND ${bRm("rm_id")}
       GROUP BY 1 ORDER BY 2 DESC`),

    // ── BUSINESS ─────────────────────────────────────────────────────────
    tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE s.created_at >= ${from} AND s.created_at < ${to})::int AS started,
             COUNT(*) FILTER (WHERE s.status IN ('stopped','paused','cancelled')
                                AND s.updated_at >= ${from} AND s.updated_at < ${to})::int AS stopped,
             COALESCE(SUM(s.amount::numeric) FILTER (
               WHERE s.created_at >= ${from} AND s.created_at < ${to}), 0) AS new_amount
        FROM sips s
        JOIN investors i ON i.id = s.investor_id AND i.deleted_at IS NULL
       WHERE ${bBranch("i.branch_id")} AND ${bRm("i.rm_id")}`),
    tx.execute(sql`
      SELECT COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.direction = 'in'), 0) AS purchase,
             COALESCE(SUM(t.amount::numeric) FILTER (WHERE t.direction = 'out'), 0) AS redemption
        FROM transactions t
        JOIN investors i ON i.id = t.investor_id AND i.deleted_at IS NULL
       WHERE t.order_date >= ${from} AND t.order_date < ${to}
         AND COALESCE(t.scheme_category, '') ILIKE '%equity%'
         AND ${bBranch("i.branch_id")} AND ${bRm("i.rm_id")}`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(be.product_type, ''), 'Unspecified') AS label,
             COUNT(*)::int AS count,
             COALESCE(SUM(be.total_amount::numeric), 0) AS amount
        FROM business_entries be
        LEFT JOIN investors i ON i.id = be.investor_id
       WHERE be.business_date >= ${from} AND be.business_date < ${to}
         AND ${bBranch("i.branch_id")} AND ${bRm("be.rm_id")}
       GROUP BY 1 ORDER BY 3 DESC LIMIT 10`),
    tx.execute(sql`
      SELECT COALESCE(SUM(aum::numeric), 0) AS aum,
             COALESCE(SUM(active_sip_amount::numeric), 0) AS sip
        FROM investors
       WHERE deleted_at IS NULL AND status = 'active'
         AND ${bBranch("branch_id")} AND ${bRm("rm_id")}`),
    // Average ticket sizes — asked for, and not computed anywhere today.
    tx.execute(sql`
      SELECT COALESCE(AVG(s.amount::numeric) FILTER (WHERE s.status = 'active'), 0) AS avg_sip,
             (SELECT COALESCE(AVG(t.amount::numeric), 0)
                FROM transactions t
                JOIN investors i2 ON i2.id = t.investor_id AND i2.deleted_at IS NULL
               WHERE t.direction = 'in' AND COALESCE(t.type::text,'') NOT ILIKE '%sip%'
                 AND t.order_date >= ${from} AND t.order_date < ${to}
                 AND ${bBranch("i2.branch_id")} AND ${bRm("i2.rm_id")}) AS avg_lumpsum
        FROM sips s
        JOIN investors i ON i.id = s.investor_id AND i.deleted_at IS NULL
       WHERE ${bBranch("i.branch_id")} AND ${bRm("i.rm_id")}`),

    // ── INSURANCE ────────────────────────────────────────────────────────
    tx.execute(sql`
      SELECT COALESCE(NULLIF(policy_type::text, ''), 'Other') AS label,
             COUNT(*)::int AS count,
             COALESCE(SUM(annual_premium::numeric), 0) AS amount
        FROM insurance_policies
       WHERE ${bBranch("branch_id")}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    tx.execute(sql`
      SELECT COUNT(*)::int AS due,
             COALESCE(SUM(annual_premium::numeric), 0) AS amount
        FROM insurance_policies
       WHERE next_premium_due_date >= date_trunc('month', current_date)
         AND next_premium_due_date < date_trunc('month', current_date) + interval '1 month'
         AND ${bBranch("branch_id")}`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(claim_status::text, ''), 'unknown') AS label, COUNT(*)::int AS count
        FROM insurance_claims
       WHERE ${bBranch("branch_id")} AND ${bRm("rm_id")}
       GROUP BY 1 ORDER BY 2 DESC`),

    // ── TEAM ─────────────────────────────────────────────────────────────
    tx.execute(sql`
      SELECT COUNT(*)::int AS calls
        FROM activities
       WHERE occurred_at >= ${from} AND occurred_at < ${to}
         AND COALESCE(kind::text, '') ILIKE '%call%'
         AND ${bBranch("branch_id")} AND ${bRm("owner_user_id")}`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(kind::text, ''), 'other') AS label, COUNT(*)::int AS count
        FROM activities
       WHERE occurred_at >= ${from} AND occurred_at < ${to}
         AND ${bBranch("branch_id")} AND ${bRm("owner_user_id")}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(rm.status::text, ''), 'unknown') AS label, COUNT(*)::int AS count
        FROM review_meetings rm
        LEFT JOIN investors i ON i.id = rm.investor_id
       WHERE rm.meeting_date >= ${from} AND rm.meeting_date < ${to}
         AND ${bBranch("i.branch_id")} AND ${bRm("rm.rm_id")}
       GROUP BY 1 ORDER BY 2 DESC`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(t.status::text, ''), 'unknown') AS label, COUNT(*)::int AS count
        FROM tasks t
        LEFT JOIN investors i ON i.id = t.related_investor_id
       WHERE ${bBranch("i.branch_id")} AND ${bRm("t.assignee_id")}
       GROUP BY 1 ORDER BY 2 DESC`),
    tx.execute(sql`
      SELECT COALESCE(u.name, 'Unassigned') AS label, COUNT(*)::int AS count
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.status NOT IN ('done','completed','cancelled')
         AND ${bRm("t.assignee_id")}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    tx.execute(sql`
      SELECT COALESCE(NULLIF(status::text, ''), 'unknown') AS label, COUNT(*)::int AS count
        FROM service_requests
       WHERE ${bRm("assigned_to_user_id")}
       GROUP BY 1 ORDER BY 2 DESC`),
    // Feedback rating — CSAT is already collected against service requests and
    // has never been surfaced on the dashboard.
    tx.execute(sql`
      SELECT COALESCE(AVG(csat_rating::numeric), 0) AS avg_rating,
             COUNT(*) FILTER (WHERE csat_rating IS NOT NULL)::int AS responses
        FROM service_requests
       WHERE ${bRm("assigned_to_user_id")}`),
  ]);

  const lt = (leadTotals.rows[0] ?? {}) as Record<string, unknown>;
  const total = n(lt.total);
  const converted = n(lt.converted);
  const fam = (families.rows[0] ?? {}) as Record<string, unknown>;
  const rk = (risk.rows[0] ?? {}) as Record<string, unknown>;
  const sf = (sipFlow.rows[0] ?? {}) as Record<string, unknown>;
  const eq = (equity.rows[0] ?? {}) as Record<string, unknown>;
  const as = (aumSip.rows[0] ?? {}) as Record<string, unknown>;
  const tk = (tickets.rows[0] ?? {}) as Record<string, unknown>;
  const ir = (insRenewals.rows[0] ?? {}) as Record<string, unknown>;

  const catRows = catAum.rows as Array<Record<string, unknown>>;
  const started = n(sf.started);
  const stopped = n(sf.stopped);
  const purchase = n(eq.purchase);
  const redemption = n(eq.redemption);
  const insTypeRows = buckets(insType.rows);

  return {
    leads: {
      bySource: buckets(leadSrc.rows),
      byStage: buckets(leadStage.rows),
      totalInWindow: total,
      converted,
      conversionPct: total > 0 ? (converted / total) * 100 : 0,
    },
    clients: {
      onboardedInWindow: n((clientWindow.rows[0] as Record<string, unknown>)?.onboarded),
      families: n(fam.families),
      clientsInFamilies: n(fam.in_families),
      byCategoryAum: catRows.map((r) => ({
        label: String(r.label),
        count: n(r.count),
        amount: n(r.amount),
      })),
      byCategorySip: catRows.map((r) => ({
        label: String(r.label),
        count: n(r.count),
        amount: n(r.sip),
      })),
      riskDone: n(rk.done),
      riskPending: n(rk.pending),
      riskProvisional: n(rk.provisional),
      byKyc: buckets(kyc.rows),
      byStatus: buckets(clientStatus.rows),
      byReviewFrequency: buckets(reviewFreq.rows),
    },
    business: {
      sipNew: started,
      sipStopped: stopped,
      sipNet: started - stopped,
      sipNewAmount: n(sf.new_amount),
      equityPurchase: purchase,
      equityRedemption: redemption,
      equityNet: purchase - redemption,
      byProduct: buckets(products.rows),
      totalAum: n(as.aum),
      totalSipBook: n(as.sip),
      avgSipTicket: n(tk.avg_sip),
      avgLumpsumTicket: n(tk.avg_lumpsum),
    },
    insurance: {
      byType: insTypeRows,
      renewalsDue: n(ir.due),
      claimsByStatus: buckets(insClaims.rows),
      policiesTotal: insTypeRows.reduce((s, b) => s + b.count, 0),
      premiumTotal: insTypeRows.reduce((s, b) => s + (b.amount ?? 0), 0),
    },
    team: {
      callsInWindow: n((calls.rows[0] as Record<string, unknown>)?.calls),
      activitiesByStatus: buckets(activityStatus.rows),
      meetingsByStatus: buckets(meetings.rows),
      tasksByStatus: buckets(taskStatus.rows),
      tasksByAssignee: buckets(taskAssignee.rows),
      serviceRequestsByStatus: buckets(serviceReq.rows),
      feedbackAvg: n((csat.rows[0] as Record<string, unknown>)?.avg_rating),
      feedbackResponses: n((csat.rows[0] as Record<string, unknown>)?.responses),
    },
  };
}
