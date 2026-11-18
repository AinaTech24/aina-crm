/**
 * The platform admin's override of the AUM pricing numbers
 * (platform_settings key 'aum_pricing', Aina Admin → Pricing & billing).
 *
 * Same pattern as razorpay-config.ts: a platform-level row read through the
 * pool (platform_settings has no tenant_id and no RLS), cached for 30 s.
 * `loadPricingSettings()` always returns a COMPLETE, valid settings object —
 * the defaults in aum-pricing.ts with the override merged on top, or the bare
 * defaults when the saved override does not validate.
 */

import { pool } from "@/db/client";
import {
  DEFAULT_PRICING,
  resolvePricingSettings,
  validatePricingOverride,
  type PricingOverride,
  type PricingSettings,
} from "./aum-pricing";

const KEY = "aum_pricing";
const TTL_MS = 30_000;
let cache: { at: number; settings: PricingSettings; override: PricingOverride } | null = null;

export function invalidatePricingSettingsCache() {
  cache = null;
}

async function readOverride(): Promise<unknown> {
  try {
    const r = await pool.query("SELECT value FROM platform_settings WHERE key = $1 LIMIT 1", [KEY]);
    return r.rows?.[0]?.value ?? null;
  } catch {
    return null; // pre-migration / no DB — the defaults apply
  }
}

export async function loadPricingSettings(force = false): Promise<PricingSettings> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.settings;
  const raw = await readOverride();
  const settings = resolvePricingSettings(raw);
  const parsed = validatePricingOverride(raw ?? {});
  cache = { at: Date.now(), settings, override: parsed.ok ? parsed.value : {} };
  return settings;
}

/** For the admin screen: the effective settings, and what was overridden. */
export async function loadPricingForAdmin(): Promise<{ settings: PricingSettings; override: PricingOverride; defaults: PricingSettings }> {
  await loadPricingSettings(true);
  return { settings: cache!.settings, override: cache!.override, defaults: DEFAULT_PRICING };
}

/**
 * Save an override (validated). `null` clears it — back to the defaults.
 * Provenance lives on the row (updated_by, updated_at).
 */
export async function savePricingOverride(input: unknown, adminUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input === null) {
    await pool.query("DELETE FROM platform_settings WHERE key = $1", [KEY]);
    invalidatePricingSettingsCache();
    return { ok: true };
  }
  const v = validatePricingOverride(input);
  if (!v.ok) return v;
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [KEY, JSON.stringify(v.value), adminUserId]
  );
  invalidatePricingSettingsCache();
  return { ok: true };
}
