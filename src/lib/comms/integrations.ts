import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";

export type IntegrationProvider = "resend" | "aisensy" | "msg91" | "waina" | "mailbox";

export interface TenantIntegrationResolved {
  id: string;
  tenantId: string;
  provider: IntegrationProvider;
  config: {
    apiKey: string;
    /** WAina: optional override of the platform send endpoint. */
    webhookUrl?: string;
    /** WAina: default WhatsApp language code, e.g. "en_US". */
    defaultLanguage?: string;
    [key: string]: any;
  };
  senderConfig: {
    fromEmail?: string;
    fromName?: string;
    /** Where client replies land — the MFD's own inbox. */
    replyTo?: string;
    senderId?: string;
    whatsappPhoneE164?: string;
  } | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getTenantIntegration(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider
): Promise<TenantIntegrationResolved | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, provider),
        eq(tenantIntegrations.isActive, true)
      )
    )
    .limit(1);

  if (!row) return null;

  try {
    const decrypted = decrypt(row.encryptedConfig);
    const config = JSON.parse(decrypted);
    return {
      ...row,
      config,
    } as TenantIntegrationResolved;
  } catch (err) {
    console.error(`[comms-integrations] Failed to decrypt integration settings for tenant ${tenantId}, provider ${provider}:`, err);
    return null;
  }
}

/**
 * Create or update a tenant's integration credentials (one row per
 * tenant × provider). The `config` is encrypted at rest. Used by the
 * Settings → Integrations save endpoints.
 */
export async function upsertTenantIntegration(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider,
  config: Record<string, any>,
  senderConfig?: TenantIntegrationResolved["senderConfig"]
): Promise<void> {
  const encryptedConfig = encrypt(JSON.stringify(config));
  await tx
    .insert(tenantIntegrations)
    .values({
      tenantId,
      provider,
      encryptedConfig,
      senderConfig: senderConfig ?? null,
      isActive: true,
    } as any)
    .onConflictDoUpdate({
      target: [tenantIntegrations.tenantId, tenantIntegrations.provider],
      set: {
        encryptedConfig,
        senderConfig: senderConfig ?? null,
        isActive: true,
        updatedAt: new Date(),
      },
    });
}

/** Soft-disconnect: mark the integration inactive (keeps the row for audit). */
export async function disableTenantIntegration(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider
): Promise<void> {
  await tx
    .update(tenantIntegrations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, provider)
      )
    );
}

/** Non-secret status for the Settings UI: connected? + a masked key hint. */
export async function getTenantIntegrationStatus(
  tx: Tx,
  tenantId: string,
  provider: IntegrationProvider
): Promise<{ connected: boolean; keyHint?: string; webhookUrl?: string; defaultLanguage?: string }> {
  const resolved = await getTenantIntegration(tx, tenantId, provider);
  if (!resolved) return { connected: false };
  const key = resolved.config.apiKey ?? "";
  const keyHint = key ? `••••${key.slice(-4)}` : undefined;
  return {
    connected: true,
    keyHint,
    webhookUrl: resolved.config.webhookUrl,
    defaultLanguage: resolved.config.defaultLanguage,
  };
}
