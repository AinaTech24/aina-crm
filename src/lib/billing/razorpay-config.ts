/**
 * Razorpay platform-billing credentials.
 *
 * The operator (AINA) bills every MFD tenant through ONE Razorpay account. Its
 * keys can be set from Aina Admin → Settings (stored ENCRYPTED at rest) instead
 * of env vars + a redeploy. Precedence: platform_settings('razorpay') in the DB
 * → environment variables → none. Resolved config is cached for 30s.
 *
 * `key_id` is the PUBLIC key (also handed to Checkout.js in the browser), so the
 * admin UI may show it in full. `key_secret` and `webhook_secret` are encrypted
 * (AES-256-GCM) and never returned to the browser.
 */
import { pool } from "@/db/client";
import { encrypt, decrypt } from "@/lib/crypto";

/** Shape persisted in platform_settings.value for key='razorpay'. Secrets encrypted. */
type StoredRazorpayConfig = {
  keyId?: string | null;
  keySecretEnc?: string | null;
  webhookSecretEnc?: string | null;
};

export type ResolvedRazorpayConfig = {
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  source: "db" | "env" | "none";
};

let _cache: { cfg: ResolvedRazorpayConfig; at: number } | null = null;
const TTL_MS = 30_000;

export function invalidateRazorpayConfigCache() {
  _cache = null;
}

async function readStored(): Promise<StoredRazorpayConfig | null> {
  try {
    const r = await pool.query("SELECT value FROM platform_settings WHERE key = 'razorpay' LIMIT 1");
    const v = r.rows?.[0]?.value;
    if (v && typeof v === "object") return v as StoredRazorpayConfig;
  } catch {
    // platform_settings may not exist yet (pre-migration) — fall back to env.
  }
  return null;
}

function resolveFromEnv(): ResolvedRazorpayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID || null;
  const keySecret = process.env.RAZORPAY_KEY_SECRET || null;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || null;
  return { keyId, keySecret, webhookSecret, source: keyId && keySecret ? "env" : "none" };
}

export async function loadRazorpayConfig(force = false): Promise<ResolvedRazorpayConfig> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;

  const stored = await readStored();
  let keySecret: string | null = null;
  let webhookSecret: string | null = null;
  if (stored?.keySecretEnc) {
    try { keySecret = decrypt(stored.keySecretEnc); } catch { keySecret = null; }
  }
  if (stored?.webhookSecretEnc) {
    try { webhookSecret = decrypt(stored.webhookSecretEnc); } catch { webhookSecret = null; }
  }

  // DB wins only when it carries a usable key id + secret; otherwise env.
  const cfg: ResolvedRazorpayConfig =
    stored?.keyId && keySecret
      ? { keyId: stored.keyId, keySecret, webhookSecret, source: "db" }
      : resolveFromEnv();

  _cache = { cfg, at: Date.now() };
  return cfg;
}

function modeOf(keyId: string | null): "live" | "test" | null {
  if (!keyId) return null;
  if (keyId.startsWith("rzp_live_")) return "live";
  if (keyId.startsWith("rzp_test_")) return "test";
  return null;
}

export type RazorpayAdminStatus = {
  keyId: string | null; // public — safe to show
  mode: "live" | "test" | null;
  secretConfigured: boolean;
  secretLast4: string | null;
  webhookConfigured: boolean;
  source: "db" | "env" | "none";
};

/** Never returns the raw secret — only key id (public) + masked booleans. */
export async function getRazorpayStatusForAdmin(): Promise<RazorpayAdminStatus> {
  const stored = await readStored();
  if (stored?.keyId) {
    let secret: string | null = null;
    let webhook: string | null = null;
    try { secret = stored.keySecretEnc ? decrypt(stored.keySecretEnc) : null; } catch { secret = null; }
    try { webhook = stored.webhookSecretEnc ? decrypt(stored.webhookSecretEnc) : null; } catch { webhook = null; }
    return {
      keyId: stored.keyId,
      mode: modeOf(stored.keyId),
      secretConfigured: !!secret,
      secretLast4: secret ? secret.slice(-4) : null,
      webhookConfigured: !!webhook,
      source: secret ? "db" : "none",
    };
  }
  const env = resolveFromEnv();
  return {
    keyId: env.keyId,
    mode: modeOf(env.keyId),
    secretConfigured: !!env.keySecret,
    secretLast4: env.keySecret ? env.keySecret.slice(-4) : null,
    webhookConfigured: !!env.webhookSecret,
    source: env.keyId && env.keySecret ? "env" : "none",
  };
}

/** Persist key id + (optional) secret + (optional) webhook secret. Blank secret keeps the saved one. */
export async function saveRazorpayConfig(
  input: { keyId: string; keySecret?: string | null; webhookSecret?: string | null },
  adminUserId: string
): Promise<void> {
  const keyId = input.keyId.trim();
  if (!keyId) throw new Error("Key ID is required.");

  const prev = await readStored();
  let keySecretEnc = prev?.keySecretEnc ?? null;
  let webhookSecretEnc = prev?.webhookSecretEnc ?? null;
  const freshSecret = input.keySecret?.trim();
  if (freshSecret) keySecretEnc = encrypt(freshSecret);
  const freshWebhook = input.webhookSecret?.trim();
  if (freshWebhook) webhookSecretEnc = encrypt(freshWebhook);

  const value: StoredRazorpayConfig = { keyId, keySecretEnc, webhookSecretEnc };
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ('razorpay', $1::jsonb, now(), $2::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(value), adminUserId]
  );
  invalidateRazorpayConfigCache();
}

/** Live "Test connection" — authenticates against the Razorpay API with the given (or saved) keys. */
export async function testRazorpayConnection(input: {
  keyId?: string | null;
  keySecret?: string | null;
}): Promise<{ ok: boolean; error?: string; mode?: string }> {
  let keyId = input.keyId?.trim() || null;
  let keySecret = input.keySecret?.trim() || null;
  if (!keyId || !keySecret) {
    const cfg = await loadRazorpayConfig(true);
    keyId = keyId || cfg.keyId;
    keySecret = keySecret || cfg.keySecret;
  }
  if (!keyId || !keySecret) return { ok: false, error: "Enter the Key ID and Secret first." };

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  try {
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.ok) return { ok: true, mode: modeOf(keyId) ?? undefined };
    if (res.status === 401) return { ok: false, error: "Key ID / Secret were rejected by Razorpay (401)." };
    const t = await res.text().catch(() => "");
    return { ok: false, error: `Razorpay returned ${res.status}. ${t.slice(0, 120)}`.trim() };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't reach Razorpay." };
  }
}
