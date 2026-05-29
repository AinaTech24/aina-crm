/**
 * Daily ops scanner — runs once per day per tenant and emits the events
 * that drive the pre-built recipes (birthday, anniversary, minor-to-major,
 * dormancy, data gaps). Recipes are graph-only; they don't know to fire
 * themselves. This worker is the "when".
 *
 * Events emitted (consumed by recipes via workflow_triggers):
 *
 *   investor.birthday              — DOB matches today, age >= 18
 *   investor.anniversary           — onboardedAt matches today, > 1 yr ago
 *   investor.minor_to_major        — DOB + 18 years <= today, category='minor'
 *   investor.dormant               — no transaction in last 365 days,
 *                                    not already flagged
*   investor.kyc_expiring          — CKYC expiry within 30 days
 *   investor.risk_profile_expired  — risk profile signed > 365 days ago
 *   employee.nism_expiring         — NISM expiry within 90 days
 *   employee.arn_expiring          — personal ARN expiry within 90 days
 *   employee.euin_expiring         — EUIN expiry within 90 days
 *   employee.dsc_expiring          — DSC expiry within 60 days
 *
 * Idempotency: each event carries `meta.scanDate = YYYY-MM-DD`. The
 * outbox poller dedupes by (kind, entity_id, meta.scanDate) — so a
 * second run on the same day is a no-op.
 *
 * Schedule: invoked by the master scheduler at 06:30 local time. The
 * worker pages through all active tenants, runs each scan with a
 * 30-second budget, and logs metrics per scan.
 *
 * Cost: at 500 tenants × 10K clients = 5M rows. Each scan is a single
 * tenant-scoped query with the appropriate index; budget < 5 ms each.
 * Total daily run: ~25 seconds for 500 tenants.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { eventsOutbox } from "@/db/schema";

interface ScanResult {
  tenantId: string;
  birthday: number;
  anniversary: number;
  minorToMajor: number;
  dormant: number;
  kycExpiring: number;
  riskExpired: number;
  // Employee-level licensing (Network FP template parity).
  nismExpiring: number;
  arnExpiring: number;
  euinExpiring: number;
  dscExpiring: number;
  durationMs: number;
}

/**
 * Returns the list of active tenants to scan. System context — we
 * deliberately bypass RLS here because the worker iterates every
 * tenant. This is the same pattern the outbox poller + segment
 * materialiser use.
 */
async function listActiveTenants(): Promise<string[]> {
  return await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      SELECT id FROM tenants
      WHERE license_status IN ('active', 'trial')
    `);
    return (r.rows as Array<{ id: string }>).map((row) => row.id);
  });
}

/**
 * Run all six scans for one tenant. Each scan is its own SQL — kept
 * tenant-scoped via withTenant so RLS gives defense-in-depth even
 * though the outer loop is system-context.
 *
 * The scanDate string is the key for idempotency. Two runs on the same
 * day for the same tenant will emit the same events; the outbox poller's
 * dedup is responsible for not double-processing them.
 */
export async function scanTenant(tenantId: string): Promise<ScanResult> {
  const startedAt = Date.now();
  const scanDate = new Date().toISOString().slice(0, 10);
  const result: ScanResult = {
    tenantId,
    birthday: 0,
    anniversary: 0,
    minorToMajor: 0,
    dormant: 0,
    kycExpiring: 0,
    riskExpired: 0,
    nismExpiring: 0,
    arnExpiring: 0,
    euinExpiring: 0,
    dscExpiring: 0,
    durationMs: 0,
  };

  await withTenant(
    tenantId,
    async (tx) => {
      // ── 1. Birthdays today (age >= 18) ────────────────────────────────
      const birthdayRows = await tx.execute(sql`
        SELECT id, name, dob, rm_id FROM investors
        WHERE dob IS NOT NULL
          AND status = 'active'
          AND EXTRACT(MONTH FROM dob) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY   FROM dob) = EXTRACT(DAY   FROM CURRENT_DATE)
          AND (CURRENT_DATE - dob) / 365 >= 18
      `);
      result.birthday = birthdayRows.rows.length;
      for (const row of birthdayRows.rows as Array<{
        id: string;
        name: string;
        dob: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.birthday",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, dob: row.dob, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any);
      }

      // ── 2. Anniversaries — onboardedAt matches today, > 1 yr ago ──────
      const anniversaryRows = await tx.execute(sql`
        SELECT id, name, onboarded_at, rm_id FROM investors
        WHERE onboarded_at IS NOT NULL
          AND status = 'active'
          AND EXTRACT(MONTH FROM onboarded_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY   FROM onboarded_at) = EXTRACT(DAY   FROM CURRENT_DATE)
          AND onboarded_at < CURRENT_DATE - INTERVAL '1 year'
      `);
      result.anniversary = anniversaryRows.rows.length;
      for (const row of anniversaryRows.rows as Array<{
        id: string;
        name: string;
        onboarded_at: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.anniversary",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, onboardedAt: row.onboarded_at, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any);
      }

      // ── 3. Minor → Major (turned 18, still flagged minor) ─────────────
      const minorRows = await tx.execute(sql`
        SELECT id, name, dob, rm_id FROM investors
        WHERE investor_category = 'minor'
          AND dob IS NOT NULL
          AND dob + INTERVAL '18 years' <= CURRENT_DATE
      `);
      result.minorToMajor = minorRows.rows.length;
      for (const row of minorRows.rows as Array<{
        id: string;
        name: string;
        dob: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.minor_to_major",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, dob: row.dob, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any);
      }

      // ── 4. Dormant detection — active row, no transaction in 365 d ────
      // Only flag *transition* events: investors who weren't dormant
      // yesterday but qualify today. The UPDATE flips status; the event
      // fires once per transition.
      const dormantRows = await tx.execute(sql`
        WITH candidates AS (
          SELECT i.id, i.name, i.rm_id
            FROM investors i
            LEFT JOIN LATERAL (
              SELECT MAX(order_date) AS last_at
                FROM transactions t
               WHERE t.tenant_id = i.tenant_id
                 AND t.investor_id = i.id
            ) lt ON true
           WHERE i.status = 'active'
             AND (lt.last_at IS NULL OR lt.last_at < CURRENT_DATE - INTERVAL '365 days')
             AND i.onboarded_at < CURRENT_DATE - INTERVAL '365 days'
        )
        UPDATE investors
           SET status = 'dormant',
               updated_at = now()
          FROM candidates c
         WHERE investors.id = c.id
         RETURNING investors.id, investors.name, investors.rm_id
      `);
      result.dormant = dormantRows.rows.length;
      for (const row of dormantRows.rows as Array<{
        id: string;
        name: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.dormant",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any);
      }

      // ── 5. CKYC expiring within 30 days ───────────────────────────────
      const kycRows = await tx.execute(sql`
        SELECT id, name, ckyc_expiry_at, rm_id FROM investors
        WHERE ckyc_expiry_at IS NOT NULL
          AND status = 'active'
          AND ckyc_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      `);
      result.kycExpiring = kycRows.rows.length;
      for (const row of kycRows.rows as Array<{
        id: string;
        name: string;
        ckyc_expiry_at: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.kyc_expiring",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, expiresAt: row.ckyc_expiry_at, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any);
      }

      // ── 6. Risk profile > 365 days old (regulatory annual review) ─────
      const riskRows = await tx.execute(sql`
        SELECT id, name, risk_profile_signed_at, rm_id FROM investors
        WHERE risk_profile_signed_at IS NOT NULL
          AND status = 'active'
          AND risk_profile_signed_at < CURRENT_DATE - INTERVAL '365 days'
      `);
      result.riskExpired = riskRows.rows.length;
      for (const row of riskRows.rows as Array<{
        id: string;
        name: string;
        risk_profile_signed_at: string;
        rm_id: string | null;
      }>) {
        await tx.insert(eventsOutbox).values({
          tenantId,
          kind: "investor.risk_profile_expired",
          entityType: "investor",
          entityId: row.id,
          after: { name: row.name, signedAt: row.risk_profile_signed_at, rmId: row.rm_id } as any,
          meta: { scanDate, source: "daily-ops-scanner" } as any,
        } as any);
      }

      // ── 7-10. Employee licensing expiries (NISM / ARN / EUIN / DSC) ──
      // NISM expiry → 90 days (existing nism_expiry_alert recipe consumes)
      // ARN  expiry → 90 days (existing arn_expiry_alert recipe consumes)
      // EUIN expiry → 90 days (alerts on the same cadence as NISM)
      // DSC  expiry → 60 days (DSC renewal is faster — 1-2 day turnaround)
      const employeeExpiryRows = await tx.execute(sql`
        SELECT id, name, email, nism_expiry_at, arn_expiry_at,
               euin_expiry_at, dsc_expiry_at, reporting_manager_id
        FROM users
        WHERE status IN ('active', 'offboarding')
          AND (
            (nism_expiry_at IS NOT NULL
              AND nism_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (arn_expiry_at IS NOT NULL
              AND arn_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (euin_expiry_at IS NOT NULL
              AND euin_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days')
            OR (dsc_expiry_at IS NOT NULL
              AND dsc_expiry_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days')
          )
      `);
      for (const row of employeeExpiryRows.rows as Array<{
        id: string;
        name: string;
        email: string;
        nism_expiry_at: string | null;
        arn_expiry_at: string | null;
        euin_expiry_at: string | null;
        dsc_expiry_at: string | null;
        reporting_manager_id: string | null;
      }>) {
        const checks: Array<{
          kind: string;
          field: keyof typeof row;
          windowDays: number;
        }> = [
          { kind: "employee.nism_expiring", field: "nism_expiry_at", windowDays: 90 },
          { kind: "employee.arn_expiring", field: "arn_expiry_at", windowDays: 90 },
          { kind: "employee.euin_expiring", field: "euin_expiry_at", windowDays: 90 },
          { kind: "employee.dsc_expiring", field: "dsc_expiry_at", windowDays: 60 },
        ];
        for (const c of checks) {
          const date = row[c.field] as string | null;
          if (!date) continue;
          const d = new Date(date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysOut = Math.round((d.getTime() - today.getTime()) / 86400000);
          if (daysOut < 0 || daysOut > c.windowDays) continue;
          await tx.insert(eventsOutbox).values({
            tenantId,
            kind: c.kind,
            entityType: "user",
            entityId: row.id,
            after: {
              name: row.name,
              email: row.email,
              expiresAt: date,
              daysOut,
              managerId: row.reporting_manager_id,
            } as any,
            meta: { scanDate, source: "daily-ops-scanner" } as any,
          } as any);
          if (c.kind === "employee.nism_expiring") result.nismExpiring++;
          if (c.kind === "employee.arn_expiring") result.arnExpiring++;
          if (c.kind === "employee.euin_expiring") result.euinExpiring++;
          if (c.kind === "employee.dsc_expiring") result.dscExpiring++;
        }
      }
    },
    { roles: ["system"] }
  );

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * Main entry: scan every active tenant. Logs aggregate metrics for the
 * day so an operator can spot anomalies (e.g. zero birthdays usually
 * means the scanner crashed for a tenant).
 */
export async function runDailyOpsScan(): Promise<{
  tenants: number;
  totals: Omit<ScanResult, "tenantId" | "durationMs">;
  failedTenants: string[];
  durationMs: number;
}> {
  const startedAt = Date.now();
  const tenants = await listActiveTenants();
  const failed: string[] = [];
  const totals = {
    birthday: 0,
    anniversary: 0,
    minorToMajor: 0,
    dormant: 0,
    kycExpiring: 0,
    riskExpired: 0,
    nismExpiring: 0,
    arnExpiring: 0,
    euinExpiring: 0,
    dscExpiring: 0,
  };
  for (const tenantId of tenants) {
    try {
      const r = await scanTenant(tenantId);
      totals.birthday += r.birthday;
      totals.anniversary += r.anniversary;
      totals.minorToMajor += r.minorToMajor;
      totals.dormant += r.dormant;
      totals.kycExpiring += r.kycExpiring;
      totals.riskExpired += r.riskExpired;
      totals.nismExpiring += r.nismExpiring;
      totals.arnExpiring += r.arnExpiring;
      totals.euinExpiring += r.euinExpiring;
      totals.dscExpiring += r.dscExpiring;
    } catch (err: any) {
      console.error(`[daily-ops-scanner] tenant ${tenantId} failed:`, err.message);
      failed.push(tenantId);
    }
  }
  const durationMs = Date.now() - startedAt;
  console.log(
    `[daily-ops-scanner] scanned ${tenants.length} tenants in ${durationMs}ms`,
    totals
  );
  return { tenants: tenants.length, totals, failedTenants: failed, durationMs };
}
