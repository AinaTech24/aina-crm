/**
 * Per-tenant Zoho connection storage. We reuse the existing `tenant_integrations`
 * table (provider = "zoho"); the secret config (refresh token) is encrypted at
 * rest with the same crypto the comms adapters use.
 *
 * SECURITY: the Zoho OAuth *app* credentials (client id/secret) are NOT stored
 * per tenant — they belong to the platform and come from env
 * (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET). Only the per-MFD refresh token lives here.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";
import { dcFromLocation, type ZohoDataCenter } from "./datacenters";

const PROVIDER = "zoho" as const;

export interface ZohoConnection {
  rowId: string;
  tenantId: string;
  dataCenter: ZohoDataCenter;
  refreshToken: string;
  /** The Zoho user/org that granted access, for display only. */
  grantedBy?: string | null;
}

type StoredConfig = { dataCenter: string; refreshToken: string; grantedBy?: string | null };

/** Resolve the firm-wide Zoho connection (decrypted) or null if not connected. */
export async function getZohoConnection(tx: Tx, tenantId: string): Promise<ZohoConnection | null> {
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
    const cfg = JSON.parse(decrypt(row.encryptedConfig)) as StoredConfig;
    if (!cfg.refreshToken) return null;
    return {
      rowId: row.id,
      tenantId: row.tenantId,
      dataCenter: dcFromLocation(cfg.dataCenter),
      refreshToken: cfg.refreshToken,
      grantedBy: cfg.grantedBy ?? null,
    };
  } catch (err) {
    console.error(`[zoho] failed to decrypt connection for tenant ${tenantId}:`, (err as Error).message);
    return null;
  }
}

/** Create/replace the firm-wide Zoho connection after a successful OAuth grant. */
export async function saveZohoConnection(
  tx: Tx,
  tenantId: string,
  input: { dataCenter: ZohoDataCenter; refreshToken: string; grantedBy?: string | null }
): Promise<void> {
  const encryptedConfig = encrypt(
    JSON.stringify({ dataCenter: input.dataCenter, refreshToken: input.refreshToken, grantedBy: input.grantedBy ?? null })
  );
  const [existing] = await tx
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
  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({ encryptedConfig, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.id));
    return;
  }
  await tx.insert(tenantIntegrations).values({
    tenantId,
    userId: null,
    provider: PROVIDER,
    encryptedConfig,
    isActive: true,
  } as any);
}

/** Soft-disconnect — keeps the row (audit) but stops syncing. */
export async function disconnectZoho(tx: Tx, tenantId: string): Promise<void> {
  await tx
    .update(tenantIntegrations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, PROVIDER),
        isNull(tenantIntegrations.userId)
      )
    );
}
