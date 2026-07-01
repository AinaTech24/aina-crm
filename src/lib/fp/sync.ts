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
import { getFpConfig, listFpMfFolios, listFpTransactions, type FpConfig } from "./client";
import { getFpConfigForTenant } from "./credentials";
import { applyFpMailback, type FpUpsertInput, type FpImportSummary } from "./import";

/**
 * Resolve a tenant's FP config: their own saved credentials first (the
 * per-MFD path), then the shared env creds as a fallback (sandbox default).
 * Returns null when neither is configured.
 */
export async function resolveFpConfigForTenant(tenantId: string): Promise<FpConfig | null> {
  const perTenant = await withTenant(tenantId, (tx) => getFpConfigForTenant(tx as Tx, tenantId), {
    roles: ["system"],
  });
  if (perTenant) return perTenant;
  try {
    return getFpConfig(); // env fallback (throws if unset)
  } catch {
    return null;
  }
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

/** Pull folios + transactions from FP for a [from, to] trade-date window. */
export async function pullFpData(
  opts: { from?: string; to?: string; cfg?: FpConfig } = {}
): Promise<FpUpsertInput> {
  const cfg = opts.cfg ?? getFpConfig();
  const { folios, capHit } = await listFpMfFolios(cfg);
  const folioNumbers = [...new Set(folios.map((f) => f.number).filter(Boolean))];
  const transactions = await listFpTransactions(folioNumbers, { from: opts.from, to: opts.to, cfg });
  return { folios, transactions, foliosCapHit: capHit };
}

/** Pull from FP and upsert into one local tenant. Returns the import summary. */
export async function syncFpForTenant(
  tenantId: string,
  ctx: { userId?: string; branchId?: string | null; roles: string[] },
  opts: { lookbackDays?: number; cfg?: FpConfig } = {}
): Promise<FpImportSummary> {
  const mock = process.env.FP_MOCK === "1";
  const days = opts.lookbackDays ?? lookbackDays();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  // Resolve THIS tenant's FP credentials (their own first, env fallback).
  const cfg = mock ? undefined : opts.cfg ?? (await resolveFpConfigForTenant(tenantId));
  if (!mock && !cfg) {
    throw new Error("Mailback Import is not configured for this firm. Add your credentials in Settings → Integrations.");
  }
  const data = mock
    ? mockFpData()
    : await pullFpData({
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        cfg: cfg ?? undefined, // non-null here (guarded above); satisfies the type
      });
  return withTenant(
    tenantId,
    async (tx) => {
      // DEV ONLY: seed the investors the mock folios reference so the upsert has
      // someone to attach transactions to (real syncs match pre-existing clients).
      if (mock) await ensureMockInvestors(tx as Tx, tenantId, data.folios);
      return applyFpMailback(tx as Tx, tenantId, data);
    },
    { userId: ctx.userId, branchId: ctx.branchId ?? undefined, roles: ctx.roles }
  );
}

// ── Dev mock (FP_MOCK=1) ─────────────────────────────────────────────────────
// Lets you exercise the full pull→upsert→dashboard→capital-gains path locally
// while the FP sandbox is empty. NEVER enabled in production (gated on env).

function mockFpData(): FpUpsertInput {
  const mk = (i: number) => {
    const folioNo = `FPMOCK000${i}`;
    const pan = `AAAPM000${i}A`;
    const scheme = `ICICI Pru Mock Scheme ${i} - Growth`;
    return {
      folio: {
        object: "mf_folio" as const,
        amc: "109K",
        number: folioNo,
        primary_investor_pan: pan,
        primary_investor_name: `Mock Investor ${i}`,
      },
      txns: [
        {
          object: "transaction" as const,
          folio_number: folioNo,
          isin: "INF109K01423",
          type: "purchase",
          amount: 100000,
          units: 1000,
          traded_on: "2024-01-01",
          traded_at: 100,
          rta_order_reference: `FPM${i}P`,
          rta_product_code: `109KMOCK${i}`,
          rta_scheme_name: scheme,
        },
        {
          object: "transaction" as const,
          folio_number: folioNo,
          isin: "INF109K01423",
          type: "redemption",
          amount: 55000,
          units: 500,
          traded_on: "2024-06-01",
          traded_at: 110,
          rta_order_reference: `FPM${i}R`,
          rta_product_code: `109KMOCK${i}`,
          rta_scheme_name: scheme,
          // FIFO lot: 500 units bought @100, sold @110 → ₹5,000 realised gain.
          sources: [{ days_held: 152, units: 500, purchased_on: "2024-01-01", purchased_at: 100, gain: 5000 }],
        },
      ],
    };
  };
  const a = mk(1);
  const b = mk(2);
  return {
    folios: [a.folio, b.folio],
    transactions: [...a.txns, ...b.txns],
    foliosCapHit: false,
  };
}

async function ensureMockInvestors(tx: Tx, tenantId: string, folios: FpUpsertInput["folios"]): Promise<void> {
  for (const f of folios) {
    if (!f.primary_investor_pan) continue;
    const pan = f.primary_investor_pan.toUpperCase();
    await tx.execute(sql`
      INSERT INTO investors (tenant_id, pan, name)
      SELECT ${tenantId}::uuid, ${pan}, ${f.primary_investor_name ?? "Mock Investor"}
      WHERE NOT EXISTS (
        SELECT 1 FROM investors WHERE tenant_id = ${tenantId}::uuid AND pan = ${pan}
      )
    `);
  }
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
 * Scheduled entry point (called by the worker's daily tick). Env-MVP: FP creds
 * are global (one sandbox tenant), mapped to ONE local tenant via
 * FP_SYNC_TENANT_ID. When per-tenant creds land (tenant_integrations provider
 * "fintech_primitives"), iterate tenants here instead.
 */
export async function runFpSync(): Promise<{ enqueued: string[]; skipped?: string }> {
  const tenantIds = new Set<string>();

  // 1. Every tenant that saved its OWN FP credentials.
  try {
    for (const t of await tenantsWithFpConfigured()) tenantIds.add(t);
  } catch (e) {
    console.error("[fp-sync] listing configured tenants failed:", (e as Error).message);
  }

  // 2. Env fallback: one shared-sandbox tenant (FP_* + FP_SYNC_TENANT_ID).
  let envConfigured = false;
  try {
    getFpConfig();
    envConfigured = true;
  } catch {
    /* env not set */
  }
  if (envConfigured && process.env.FP_SYNC_TENANT_ID) tenantIds.add(process.env.FP_SYNC_TENANT_ID);

  if (!tenantIds.size) {
    return { enqueued: [], skipped: "no tenant has FP configured (per-tenant creds or FP_SYNC_TENANT_ID)" };
  }

  // System actor — uploaded_by stays NULL (no real user behind a cron sync).
  const enqueued: string[] = [];
  for (const tenantId of tenantIds) {
    try {
      await enqueueFpSync(tenantId, { roles: ["system"] }, "scheduled");
      enqueued.push(tenantId);
    } catch (e) {
      console.error(`[fp-sync] enqueue failed for tenant ${tenantId}:`, (e as Error).message);
    }
  }
  return { enqueued };
}
