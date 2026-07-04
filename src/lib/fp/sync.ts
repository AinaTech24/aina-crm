/**
 * FintechPrimitives API-pull sync.
 *
 * This is the PRIMARY import path: FP already holds your folios + transactions
 * (Cybrilla Ops ingests the RTA reverse feeds that the RTA auto-forwards to
 * opscybrilla@cybrilla.com). So we don't upload anything — we just PULL the
 * structured data via the API and upsert it locally:
 *
 *   GET /v2/mf_folios          → folios FP holds
 *   GET /transactions?folios=… → structured transactions + FIFO capital-gains
 *   applyFpMailback(...)        → upsert into local folios + transactions
 *
 * Idempotent (dedup_key per transaction), so a rolling overlapping window is
 * safe — re-pulling the same days never duplicates.
 *
 * The manual `transaction_processing` upload (fp-import-worker upload mode) stays
 * only as a self-serve BACKFILL for tenants not on the auto-forward route.
 */

import { and, eq, sql } from "drizzle-orm";
import { withSystem, withTenant, type Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { Q } from "@/workers/queues";
import { listFpMfFolios, listFpTransactions, type FpConfig } from "./client";
import { getFpConfigForTenant } from "./credentials";
import { applyFpMailback, type FpUpsertInput, type FpImportSummary } from "./import";

/**
 * Resolve a tenant's credentials — STRICTLY their own saved credentials, nothing
 * else. There is NO shared env fallback: every MFD must enter its own account, so
 * one firm can never pull another account's (e.g. the sandbox) data. Returns null
 * when this firm has not configured its own credentials.
 */
export async function resolveFpConfigForTenant(tenantId: string): Promise<FpConfig | null> {
  return withTenant(tenantId, (tx) => getFpConfigForTenant(tx as Tx, tenantId), { roles: ["system"] });
}

/** Tenant ids with an active FP integration configured (per-tenant creds). */
export async function tenantsWithFpConfigured(): Promise<string[]> {
  return withSystem(async (tx) => {
    const rows = await tx
      .select({ tenantId: tenantIntegrations.tenantId })
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.provider, "fintech_primitives"), eq(tenantIntegrations.isActive, true)));
    return rows.map((r) => r.tenantId);
  });
}

/** Default rolling look-back. Dedup makes overlap free, so we re-pull a wide
 *  window each run to self-heal any gaps. Override with FP_SYNC_LOOKBACK_DAYS. */
const DEFAULT_LOOKBACK_DAYS = 400;

function lookbackDays(): number {
  const n = Number(process.env.FP_SYNC_LOOKBACK_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LOOKBACK_DAYS;
}

/** Pull folios + transactions for a [from, to] window using the given firm's
 *  credentials. `cfg` is REQUIRED — there is no env fallback (strict isolation). */
export async function pullFpData(opts: {
  from?: string;
  to?: string;
  cfg: FpConfig;
}): Promise<FpUpsertInput> {
  const { cfg } = opts;
  const { folios, capHit } = await listFpMfFolios(cfg);
  const folioNumbers = [...new Set(folios.map((f) => f.number).filter(Boolean))];
  const transactions = await listFpTransactions(folioNumbers, { from: opts.from, to: opts.to, cfg });
  return { folios, transactions, foliosCapHit: capHit };
}

/** Pull from the mailback service and upsert into one local tenant. */
export async function syncFpForTenant(
  tenantId: string,
  ctx: { userId?: string; branchId?: string | null; roles: string[] },
  opts: { lookbackDays?: number; cfg?: FpConfig } = {}
): Promise<FpImportSummary> {
  const days = opts.lookbackDays ?? lookbackDays();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  // Resolve THIS firm's OWN credentials only (no shared fallback).
  const cfg = opts.cfg ?? (await resolveFpConfigForTenant(tenantId));
  if (!cfg) {
    throw new Error("Mailback Import is not configured for this firm. Add your credentials in Settings → Integrations.");
  }
  const data = await pullFpData({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    cfg,
  });
  return withTenant(tenantId, (tx) => applyFpMailback(tx as Tx, tenantId, data), {
    userId: ctx.userId,
    branchId: ctx.branchId ?? undefined,
    roles: ctx.roles,
  });
}

/**
 * Create an rta_file_imports audit row + enqueue an FP sync job for the worker.
 * Used by both the scheduled sync and the on-demand "Sync now" button — the row
 * makes every sync show up on the RTA Imports dashboard with live status.
 */
export async function enqueueFpSync(
  tenantId: string,
  ctx: { userId?: string | null; branchId?: string | null; roles: string[] },
  trigger: "scheduled" | "manual"
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const importId = await withTenant(
    tenantId,
    async (tx) => {
      // file_key is "" — an API sync has no uploaded file. period_* are NOT NULL
      // placeholders the worker overwrites with the real pulled window.
      // uploaded_by is NULL for the scheduled (system) actor.
      const r = await tx.execute(sql`
        INSERT INTO rta_file_imports (
          tenant_id, source, kind, period_start, period_end,
          file_name, file_key, status, uploaded_by
        ) VALUES (
          ${tenantId}::uuid, 'fintech_primitives', 'daily_transaction_feed',
          ${today}::date, ${today}::date,
          ${`Mailback sync (${trigger})`}, '', 'uploaded', ${ctx.userId ?? null}
        )
        RETURNING id
      `);
      return (r.rows[0] as { id: string }).id;
    },
    { userId: ctx.userId ?? undefined, branchId: ctx.branchId ?? undefined, roles: ctx.roles }
  );

  await Q.fpImport().add(
    "fp-sync",
    {
      mode: "sync",
      importId,
      tenantId,
      userId: ctx.userId,
      branchId: ctx.branchId,
      roles: ctx.roles,
    },
    { attempts: 1, removeOnComplete: true, removeOnFail: { age: 3600 } }
  );

  return importId;
}

/**
 * Scheduled entry point (called by the worker's daily tick). Syncs EVERY firm
 * that has saved its OWN Mailback credentials — strictly per-tenant, each with
 * its own account. No shared/env fallback.
 */
export async function runFpSync(): Promise<{ enqueued: string[]; skipped?: string }> {
  let tenantIds: string[] = [];
  try {
    tenantIds = await tenantsWithFpConfigured();
  } catch (e) {
    console.error("[fp-sync] listing configured firms failed:", (e as Error).message);
  }

  if (!tenantIds.length) {
    return { enqueued: [], skipped: "no firm has Mailback credentials configured" };
  }

  // System actor — uploaded_by stays NULL (no real user behind a cron sync).
  const enqueued: string[] = [];
  for (const tenantId of tenantIds) {
    try {
      await enqueueFpSync(tenantId, { roles: ["system"] }, "scheduled");
      enqueued.push(tenantId);
    } catch (e) {
      console.error(`[fp-sync] enqueue failed for firm ${tenantId}:`, (e as Error).message);
    }
  }
  return { enqueued };
}
