/**
 * Per-tenant FintechPrimitives connection storage.
 *
 * Each MFD has its OWN FP account (distinct tenant + client_id + client_secret).
 * They enter it in Settings → Integrations; we store it encrypted (same crypto
 * the comms adapters + Zoho use) in `tenant_integrations` (provider
 * "fintech_primitives"), then the sync/worker resolve it per tenant.
 *
 * Env vars (FP_TENANT/FP_CLIENT_ID/FP_CLIENT_SECRET) remain a FALLBACK for a
 * shared sandbox default — see resolveFpConfigForTenant in ./sync.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";
import type { FpConfig } from "./client";

const PROVIDER = "fintech_primitives" as const;

const DEFAULT_BASE_URL = "https://s.finprim.com";

type StoredConfig = {
  baseUrl?: string;
  tenant: string;
  clientId: string;
  clientSecret: string;
  grantedBy?: string | null;
};

/** Non-secret status for the Settings UI. */
export interface FpState {
  hasCredentials: boolean;
  connected: boolean;
  baseUrl: string | null;
  fpTenant: string | null;
  clientIdHint: string | null;
  grantedBy: string | null;
}

async function readConfig(tx: Tx, tenantId: string): Promise<{ rowId: string; cfg: StoredConfig } | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, PROVIDER),
        isNull(tenantIntegrations.userId),
        eq(tenantIntegrations.isActive, true)
      )
    )
    .limit(1);
  if (!row) return null;
  try {
    return { rowId: row.id, cfg: JSON.parse(decrypt(row.encryptedConfig)) as StoredConfig };
  } catch (err) {
    console.error(`[fp] failed to decrypt config for tenant ${tenantId}:`, (err as Error).message);
    return null;
  }
}

async function readRowId(tx: Tx, tenantId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: tenantIntegrations.id })
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, PROVIDER),
        isNull(tenantIntegrations.userId)
      )
    )
    .limit(1);
  return row?.id ?? null;
}

async function writeConfig(tx: Tx, tenantId: string, cfg: StoredConfig, isActive = true): Promise<void> {
  const encryptedConfig = encrypt(JSON.stringify(cfg));
  const existing = await readRowId(tx, tenantId);
  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({ encryptedConfig, isActive, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing));
    return;
  }
  await tx.insert(tenantIntegrations).values({
    tenantId,
    userId: null,
    provider: PROVIDER,
    encryptedConfig,
    isActive,
  } as any);
}

/** Full, ready-to-use FP config for a tenant, or null if not configured. */
export async function getFpConfigForTenant(tx: Tx, tenantId: string): Promise<FpConfig | null> {
  const read = await readConfig(tx, tenantId);
  if (!read) return null;
  const { cfg } = read;
  if (!cfg.tenant || !cfg.clientId || !cfg.clientSecret) return null;
  return {
    baseUrl: (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    tenant: cfg.tenant,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
  };
}

export async function getFpState(tx: Tx, tenantId: string): Promise<FpState> {
  const read = await readConfig(tx, tenantId);
  const cfg = read?.cfg;
  const complete = !!(cfg?.tenant && cfg?.clientId && cfg?.clientSecret);
  return {
    hasCredentials: !!cfg,
    connected: complete,
    baseUrl: cfg?.baseUrl || (cfg ? DEFAULT_BASE_URL : null),
    fpTenant: cfg?.tenant ?? null,
    clientIdHint: cfg?.clientId ? `…${cfg.clientId.slice(-6)}` : null,
    grantedBy: cfg?.grantedBy ?? null,
  };
}

/** Save (or replace) the MFD's FP credentials. */
export async function saveFpCredentials(
  tx: Tx,
  tenantId: string,
  input: { baseUrl?: string; tenant: string; clientId: string; clientSecret: string; grantedBy?: string | null }
): Promise<void> {
  await writeConfig(tx, tenantId, {
    baseUrl: (input.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, ""),
    tenant: input.tenant.trim(),
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret.trim(),
    grantedBy: input.grantedBy ?? null,
  });
}

/** Soft-disconnect: mark inactive (keeps the encrypted row for audit / re-enable). */
export async function disconnectFp(tx: Tx, tenantId: string): Promise<void> {
  const read = await readConfig(tx, tenantId);
  if (!read) return;
  await writeConfig(tx, tenantId, read.cfg, false);
}
