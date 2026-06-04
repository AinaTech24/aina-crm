import { boolean, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";

export const tenantIntegrations = pgTable(
  "tenant_integrations",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    provider: text("provider", { enum: ["resend", "aisensy", "msg91", "waina"] }).notNull(),
    encryptedConfig: text("encrypted_config").notNull(),
    senderConfig: jsonb("sender_config").$type<{
      fromEmail?: string;
      fromName?: string;
      senderId?: string; // MSG91 Sender ID
      whatsappPhoneE164?: string;
    }>(),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    providerUnique: uniqueIndex("tenant_provider_unique").on(t.tenantId, t.provider),
  })
);
