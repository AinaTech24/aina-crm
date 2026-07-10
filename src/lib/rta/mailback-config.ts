/**
 * Per-tenant RTA mailback (email-forward import) configuration.
 *
 * Two pieces of state per firm:
 *   1. The ZIP passwords — separate CAMS + KFintech — stored ENCRYPTED in
 *      `tenant_integrations` (provider "rta_mailback"), same crypto the comms
 *      adapters / FP / Zoho use.
 *   2. The unique inbound forwarding address — a row in `rta_forward_addresses`
 *      (the email analogue of `whatsapp_numbers`) the poller resolves to a tenant.
 *
 * The MFD sets a one-time auto-forward rule from their mailbox to this address;
 * src/workers/rta-inbox-poller.ts ingests the attachment through the existing
 * rta.import pipeline.
 */

import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { rtaForwardAddresses } from "@/db/schema/rta_forward_addresses";
import { decrypt, encrypt } from "@/lib/crypto";
import { getInboundDomain } from "./inbox-config";

const PROVIDER = "rta_mailback" as const;

export type MailbackPasswords = {
  /** ZIP password the MFD set with CAMS for their mailback subscription. */
  camsPassword?: string;
  /** ZIP password the MFD set with KFintech for their mailback subscription. */
  kfintechPassword?: string;
};

// The inbound mailbox/domain config now lives in Aina Admin (platform_settings,
// env fallback) — see src/lib/rta/inbox-config.ts (getInboundDomain /
// loadRtaInboxConfig / isInboxConfigured).

// ── Passwords (tenant_integrations, encrypted) ──────────────────────────────

async function readPwRow(tx: Tx, tenantId: string): Promise<{ rowId: string; cfg: MailbackPasswords } | null> {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(
      and(
        eq(tenantIntegrations.tenantId, tenantId),
        eq(tenantIntegrations.provider, PROVIDER),
        isNull(tenantIntegrations.userId)
      )
    )
    .limit(1);
  if (!row) return null;
  try {
    return { rowId: row.id, cfg: JSON.parse(decrypt(row.encryptedConfig)) as MailbackPasswords };
  } catch (err) {
    console.error(`[rta-mailback] failed to decrypt config for tenant ${tenantId}:`, (err as Error).message);
    return { rowId: row.id, cfg: {} };
  }
}

/** Ready-to-use passwords for a tenant (empty object if none configured). */
export async function getMailbackPasswords(tx: Tx, tenantId: string): Promise<MailbackPasswords> {
  const read = await readPwRow(tx, tenantId);
  return read?.cfg ?? {};
}

/**
 * Save (merge) the mailback passwords. Passing only `camsPassword` leaves an
 * existing KFintech password untouched — the two RTAs are configured
 * independently. An explicit empty string clears that RTA's password.
 */
export async function saveMailbackPasswords(tx: Tx, tenantId: string, input: MailbackPasswords): Promise<void> {
  const existing = await readPwRow(tx, tenantId);
  const merged: MailbackPasswords = { ...(existing?.cfg ?? {}) };
  if (input.camsPassword !== undefined) {
    if (input.camsPassword.trim()) merged.camsPassword = input.camsPassword.trim();
    else delete merged.camsPassword;
  }
  if (input.kfintechPassword !== undefined) {
    if (input.kfintechPassword.trim()) merged.kfintechPassword = input.kfintechPassword.trim();
    else delete merged.kfintechPassword;
  }
  const encryptedConfig = encrypt(JSON.stringify(merged));
  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({ encryptedConfig, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.rowId));
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

// ── Forwarding address (rta_forward_addresses) ──────────────────────────────

function mintAddress(domain: string): { address: string; token: string } {
  const token = randomBytes(6).toString("hex"); // 12 hex chars — unguessable
  return { address: `rta-${token}@${domain}`, token };
}

/** The firm's active forwarding address, creating one on first use. */
export async function ensureForwardAddress(
  tx: Tx,
  tenantId: string
): Promise<{ address: string; token: string }> {
  const domain = await getInboundDomain();
  const [row] = await tx
    .select({ address: rtaForwardAddresses.address, token: rtaForwardAddresses.token })
    .from(rtaForwardAddresses)
    .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.isActive, true)))
    .limit(1);
  if (row) {
    // If the configured inbound domain changed, re-issue the address on the SAME
    // token so an already-set-up forward keeps its local-part where possible.
    const want = `rta-${row.token}@${domain}`;
    if (row.address.toLowerCase() !== want.toLowerCase()) {
      await tx
        .update(rtaForwardAddresses)
        .set({ address: want, updatedAt: new Date() })
        .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.token, row.token)));
      return { address: want, token: row.token };
    }
    return row;
  }
  const minted = mintAddress(domain);
  await tx.insert(rtaForwardAddresses).values({
    tenantId,
    address: minted.address,
    token: minted.token,
    isActive: true,
  } as any);
  return minted;
}

/** Rotate to a fresh address (e.g. the old one leaked / spam). Deactivates old. */
export async function regenerateForwardAddress(
  tx: Tx,
  tenantId: string
): Promise<{ address: string; token: string }> {
  const domain = await getInboundDomain();
  await tx
    .update(rtaForwardAddresses)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(rtaForwardAddresses.tenantId, tenantId), eq(rtaForwardAddresses.isActive, true)));
  const minted = mintAddress(domain);
  await tx.insert(rtaForwardAddresses).values({
    tenantId,
    address: minted.address,
    token: minted.token,
    isActive: true,
  } as any);
  return minted;
}

export type ForwardAddressRow = {
  id: string;
  tenantId: string;
  address: string;
  verifiedAt: Date | null;
  forwardingConfirmCode: string | null;
  forwardingConfirmUrl: string | null;
};

/**
 * Resolve an inbound recipient address → the owning tenant's active row.
 * Called from the poller in SYSTEM context (cross-tenant), so it selects across
 * all tenants — the caller is responsible for running inside withSystem().
 */
export async function resolveTenantByAddresses(
  tx: Tx,
  candidates: string[]
): Promise<ForwardAddressRow | null> {
  const lowered = [...new Set(candidates.map((c) => c.toLowerCase().trim()).filter(Boolean))];
  if (!lowered.length) return null;
  // IN (…) via sql.join — the array-binding idiom used elsewhere in the codebase
  // (src/lib/rta/process.ts), which avoids Postgres `= ANY($1)` array-type ambiguity.
  const rows = await tx
    .select({
      id: rtaForwardAddresses.id,
      tenantId: rtaForwardAddresses.tenantId,
      address: rtaForwardAddresses.address,
      verifiedAt: rtaForwardAddresses.verifiedAt,
      forwardingConfirmCode: rtaForwardAddresses.forwardingConfirmCode,
      forwardingConfirmUrl: rtaForwardAddresses.forwardingConfirmUrl,
    })
    .from(rtaForwardAddresses)
    .where(
      and(
        eq(rtaForwardAddresses.isActive, true),
        sql`lower(${rtaForwardAddresses.address}) IN (${sql.join(
          lowered.map((a) => sql`${a}`),
          sql`, `
        )})`
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Stamp a successful receipt — proves the forwarding rule is live end-to-end. */
export async function stampReceived(tx: Tx, id: string): Promise<void> {
  await tx
    .update(rtaForwardAddresses)
    .set({ lastReceivedAt: new Date(), verifiedAt: sql`COALESCE(${rtaForwardAddresses.verifiedAt}, now())`, updatedAt: new Date() })
    .where(eq(rtaForwardAddresses.id, id));
}

/** Persist an auto-captured Gmail/Outlook forwarding confirmation code/link. */
export async function recordForwardingConfirmation(
  tx: Tx,
  id: string,
  code: string | null,
  url: string | null
): Promise<void> {
  await tx
    .update(rtaForwardAddresses)
    .set({
      forwardingConfirmCode: code,
      forwardingConfirmUrl: url,
      forwardingConfirmAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(rtaForwardAddresses.id, id));
}
