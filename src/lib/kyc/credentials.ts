/**
 * The firm's own NSE MF Invest API credentials — one firm-wide
 * `tenant_integrations` row (provider "nse_mf"), the whole config encrypted
 * with lib/crypto. NSE issues these to the firm (Login User ID, API Secret,
 * API Member License Key, member code); the CRM never shares one firm's keys
 * with another, and the secrets never leave the server.
 *
 * The non-secret run state (last test, last error, last nightly run) is kept in
 * the same blob so the Settings card can say what happened.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { tenantIntegrations } from "@/db/schema/tenant_integrations";
import { decrypt, encrypt } from "@/lib/crypto";
import type { NseCredentials, NseEnv } from "./nse-client";

const PROVIDER = "nse_mf" as const;

type Stored = {
  loginUserId: string;
  apiSecret: string;
  licenseKey: string;
  memberCode: string;
  env: NseEnv;
  autoRefresh: boolean;
  lastTestAt?: string | null;
  lastTestOk?: boolean | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  lastRunAt?: string | null;
  lastRunChecked?: number | null;
  lastRunChanged?: number | null;
};

/** What the Settings card may see — no secret, only a hint of the user id. */
export type NseMfState = {
  connected: boolean;
  isActive: boolean;
  env: NseEnv | null;
  memberCode: string | null;
  loginUserId: string | null;
  autoRefresh: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastRunAt: string | null;
  lastRunChecked: number | null;
  lastRunChanged: number | null;
};

async function readRow(tx: Tx, tenantId: string) {
  const [row] = await tx
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, PROVIDER), isNull(tenantIntegrations.userId)))
    .limit(1);
  if (!row) return null;
  try {
    return { id: row.id, isActive: row.isActive, cfg: JSON.parse(decrypt(row.encryptedConfig)) as Stored };
  } catch (err) {
    console.error(`[nse-mf] cannot decrypt config for tenant ${tenantId}:`, (err as Error).message);
    return null;
  }
}

async function writeRow(tx: Tx, tenantId: string, cfg: Stored, isActive = true) {
  const encryptedConfig = encrypt(JSON.stringify(cfg));
  const existing = await readRow(tx, tenantId);
  if (existing) {
    await tx
      .update(tenantIntegrations)
      .set({ encryptedConfig, isActive, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.id));
    return;
  }
  await tx.insert(tenantIntegrations).values({ tenantId, userId: null, provider: PROVIDER, encryptedConfig, isActive });
}

/** The credentials to call NSE with, or null when the firm has not connected (or switched it off). */
export async function getNseCredentials(tx: Tx, tenantId: string): Promise<(NseCredentials & { autoRefresh: boolean }) | null> {
  const r = await readRow(tx, tenantId);
  if (!r || !r.isActive) return null;
  const c = r.cfg;
  if (!c.loginUserId || !c.apiSecret || !c.licenseKey || !c.memberCode) return null;
  return {
    loginUserId: c.loginUserId,
    apiSecret: c.apiSecret,
    licenseKey: c.licenseKey,
    memberCode: c.memberCode,
    env: c.env === "uat" ? "uat" : "live",
    autoRefresh: c.autoRefresh !== false,
  };
}

export async function getNseState(tx: Tx, tenantId: string): Promise<NseMfState> {
  const r = await readRow(tx, tenantId);
  const c = r?.cfg;
  return {
    connected: !!(c && c.apiSecret && c.licenseKey && r?.isActive),
    isActive: !!r?.isActive,
    env: c ? (c.env === "uat" ? "uat" : "live") : null,
    memberCode: c?.memberCode ?? null,
    loginUserId: c?.loginUserId ?? null,
    autoRefresh: c ? c.autoRefresh !== false : true,
    lastTestAt: c?.lastTestAt ?? null,
    lastTestOk: c?.lastTestOk ?? null,
    lastError: c?.lastError ?? null,
    lastErrorAt: c?.lastErrorAt ?? null,
    lastRunAt: c?.lastRunAt ?? null,
    lastRunChecked: c?.lastRunChecked ?? null,
    lastRunChanged: c?.lastRunChanged ?? null,
  };
}

export type SaveNseInput = {
  loginUserId: string;
  memberCode: string;
  env: NseEnv;
  autoRefresh: boolean;
  /** Blank keeps the saved value, so the card never round-trips a secret. */
  apiSecret?: string;
  licenseKey?: string;
};

/** Returns an error message when a secret is missing on first save. */
export async function saveNseCredentials(tx: Tx, tenantId: string, input: SaveNseInput): Promise<string | null> {
  const prev = (await readRow(tx, tenantId))?.cfg;
  const apiSecret = input.apiSecret?.trim() || prev?.apiSecret || "";
  const licenseKey = input.licenseKey?.trim() || prev?.licenseKey || "";
  if (!apiSecret || !licenseKey) return "Enter the API Secret and the API Member License Key NSE gave you.";
  const sameKeys =
    prev && prev.loginUserId === input.loginUserId && prev.apiSecret === apiSecret && prev.licenseKey === licenseKey && prev.memberCode === input.memberCode && prev.env === input.env;
  await writeRow(tx, tenantId, {
    loginUserId: input.loginUserId,
    apiSecret,
    licenseKey,
    memberCode: input.memberCode,
    env: input.env,
    autoRefresh: input.autoRefresh,
    // New keys have not been tested; an unchanged set keeps its history.
    lastTestAt: sameKeys ? prev?.lastTestAt ?? null : null,
    lastTestOk: sameKeys ? prev?.lastTestOk ?? null : null,
    lastError: sameKeys ? prev?.lastError ?? null : null,
    lastErrorAt: sameKeys ? prev?.lastErrorAt ?? null : null,
    lastRunAt: prev?.lastRunAt ?? null,
    lastRunChecked: prev?.lastRunChecked ?? null,
    lastRunChanged: prev?.lastRunChanged ?? null,
  });
  return null;
}

/** Merge run-state fields (test result, last error, last nightly run). Never touches the keys. */
export async function noteNseState(tx: Tx, tenantId: string, patch: Partial<Pick<Stored, "lastTestAt" | "lastTestOk" | "lastError" | "lastErrorAt" | "lastRunAt" | "lastRunChecked" | "lastRunChanged">>) {
  const r = await readRow(tx, tenantId);
  if (!r) return;
  await writeRow(tx, tenantId, { ...r.cfg, ...patch }, r.isActive);
}

/** Disconnect: the row is kept switched off (audit of what was configured), secrets wiped. */
export async function disconnectNse(tx: Tx, tenantId: string) {
  const r = await readRow(tx, tenantId);
  if (!r) return;
  await writeRow(tx, tenantId, { ...r.cfg, apiSecret: "", licenseKey: "", autoRefresh: false }, false);
}
