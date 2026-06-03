import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt } from "@/lib/crypto";

export interface TenantIntegrationResolved {
  id: string;
  tenantId: string;
  provider: "resend" | "aisensy" | "msg91";
  config: {
    apiKey: string;
    [key: string]: any;
  };
  senderConfig: {
    fromEmail?: string;
    fromName?: string;
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
  provider: "resend" | "aisensy" | "msg91"
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
