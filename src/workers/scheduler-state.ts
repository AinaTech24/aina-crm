/**
 * Scheduler state — last-run watermark + heartbeat per background job.
 *
 * Used for (a) missed-run catch-up so a fixed-time sweep that was skipped while
 * the process was down runs on the next boot, and (b) liveness so a readiness
 * probe can detect a dead/stalled worker.
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";

export async function getLastRun(jobName: string): Promise<Date | null> {
  try {
    return await withSystem(async (tx) => {
      const r = await tx.execute(
        sql`SELECT last_run_at FROM scheduler_state WHERE job_name = ${jobName}`
      );
      const v = (r.rows[0] as any)?.last_run_at;
      return v ? new Date(v) : null;
    });
  } catch {
    return null; // table missing / DB hiccup → treat as "never ran" (safe: catch-up runs)
  }
}

export async function recordRun(jobName: string, status = "ok", detail?: string): Promise<void> {
  try {
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO scheduler_state (job_name, last_run_at, last_run_status, last_run_detail, last_heartbeat_at, updated_at)
        VALUES (${jobName}, now(), ${status}, ${detail ?? null}, now(), now())
        ON CONFLICT (job_name) DO UPDATE SET
          last_run_at = now(), last_run_status = ${status}, last_run_detail = ${detail ?? null},
          last_heartbeat_at = now(), updated_at = now()
      `);
    });
  } catch {
    // Never let metadata bookkeeping break the actual job.
  }
}

/**
 * Turn whatever a job returned into the status + detail recorded for it.
 *
 * A job that finished its loop is not necessarily a job that did its work. The
 * daily ops scan catches a per-tenant failure, logs it and carries on, so
 * `scheduler_state` showed `ok` every night while one firm's AUM sat twelve
 * days stale (Ahpal, 18-30 Sep 2026) and another's was 87% unpriced. The job
 * already returned `failedTenants`; nobody read it.
 *
 * `partial` means the run completed but not for everyone — the state worth
 * alerting on, and the one that had no representation before. Unpriced
 * holdings stay `ok` with a count in the detail: some schemes genuinely cannot
 * be priced, so raising them to `partial` nightly would just train people to
 * ignore the field.
 */
export function describeRun(result: unknown, reason: string): { status: string; detail: string } {
  const parts = [reason];
  let status = "ok";
  const r = result as Record<string, any> | null | undefined;

  if (r && typeof r === "object") {
    const failed: unknown = r.failedTenants;
    if (Array.isArray(failed) && failed.length > 0) {
      status = "partial";
      const shown = failed.slice(0, 5).join(", ");
      parts.push(`${failed.length} tenant(s) FAILED: ${shown}${failed.length > 5 ? " …" : ""}`);
    }
    const t = r.totals as Record<string, any> | undefined;
    if (t && typeof t === "object") {
      if (Number(t.legsUnpriced) > 0) {
        parts.push(
          `${t.legsUnpriced} holding(s) unpriced (Rs ${Math.round(Number(t.legsUnpricedValue ?? 0) / 100000)} lakh)`
        );
      }
      if (Number(t.aumSkippedUnpriced) > 0) parts.push(`${t.aumSkippedUnpriced} client(s) AUM not refreshed`);
    }
  }
  // The column is text; keep it readable rather than truncating mid-word.
  const detail = parts.join(" · ");
  return { status, detail: detail.length > 900 ? detail.slice(0, 897) + "…" : detail };
}

export async function heartbeat(jobName: string): Promise<void> {
  try {
    await withSystem(async (tx) => {
      await tx.execute(sql`
        INSERT INTO scheduler_state (job_name, last_heartbeat_at, updated_at)
        VALUES (${jobName}, now(), now())
        ON CONFLICT (job_name) DO UPDATE SET last_heartbeat_at = now(), updated_at = now()
      `);
    });
  } catch {
    /* best-effort */
  }
}
