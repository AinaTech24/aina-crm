/**
 * RTA mailback catch-all inbox configuration — the operator sets it from Aina
 * Admin (no redeploy / env edit), exactly like the platform email config.
 *
 * This is the ONE platform-level mailbox every MFD forwards their RTA mailback to
 * (e.g. rta@crm.ainatech.in on Hostinger). It is NOT tenant-scoped — it lives in
 * platform_settings('rta_inbox'). The IMAP password is encrypted at rest
 * (AES-256-GCM) and only decrypted in-process by the poller. The RTA_INBOX_*
 * environment variables remain the fallback.
 */
import { pool } from "@/db/client";
import { encrypt, decrypt } from "@/lib/crypto";

/** Shape persisted in platform_settings.value for key='rta_inbox'. Password encrypted. */
type StoredInboxConfig = {
  host?: string | null;
  port?: number | null;
  secure?: boolean | null;
  user?: string | null;
  passEnc?: string | null;
  /** The domain unique forward addresses are minted under (rta-<token>@<domain>). */
  domain?: string | null;
};

export type ResolvedInboxConfig = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  domain: string;
  configured: boolean;
  source: "db" | "env" | "none";
};

const DEFAULT_DOMAIN = "crm.ainatech.in";
const TTL_MS = 60_000;
let _cache: { cfg: ResolvedInboxConfig; at: number } | null = null;

function normDomain(d: string | null | undefined): string {
  return (d || DEFAULT_DOMAIN).trim().replace(/^@/, "").toLowerCase() || DEFAULT_DOMAIN;
}

async function readStored(): Promise<StoredInboxConfig | null> {
  try {
    const r = await pool.query("SELECT value FROM platform_settings WHERE key = 'rta_inbox' LIMIT 1");
    const v = r.rows?.[0]?.value;
    if (v && typeof v === "object") return v as StoredInboxConfig;
  } catch {
    // Table missing (pre-migration) → env fallback.
  }
  return null;
}

/** Resolve the active inbox config — DB first (password decrypted), then env. */
export async function loadRtaInboxConfig(force = false): Promise<ResolvedInboxConfig> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  const stored = await readStored();
  let cfg: ResolvedInboxConfig;
  if (stored?.host) {
    let pass: string | null = null;
    if (stored.passEnc) {
      try {
        pass = decrypt(stored.passEnc);
      } catch {
        pass = null; // bad/old ciphertext (e.g. ENCRYPTION_KEY rotated)
      }
    }
    cfg = {
      host: stored.host,
      port: stored.port ?? 993,
      secure: stored.secure ?? true,
      user: stored.user ?? null,
      pass,
      domain: normDomain(stored.domain),
      configured: !!(stored.host && stored.user && pass),
      source: "db",
    };
  } else {
    const host = process.env.RTA_INBOX_HOST || null;
    const pass = process.env.RTA_INBOX_PASS || null;
    cfg = {
      host,
      port: process.env.RTA_INBOX_PORT ? Number(process.env.RTA_INBOX_PORT) : 993,
      secure: process.env.RTA_INBOX_SECURE ? process.env.RTA_INBOX_SECURE !== "false" : true,
      user: process.env.RTA_INBOX_USER || null,
      pass,
      domain: normDomain(process.env.RTA_INBOX_DOMAIN),
      configured: !!(host && process.env.RTA_INBOX_USER && pass),
      source: host ? "env" : "none",
    };
  }
  _cache = { cfg, at: Date.now() };
  return cfg;
}

export function invalidateRtaInboxConfigCache(): void {
  _cache = null;
}

/** The domain unique forward addresses are minted under (DB-first, env fallback). */
export async function getInboundDomain(): Promise<string> {
  return (await loadRtaInboxConfig()).domain;
}

/** Whether a catch-all inbox is actually connectable (poller no-ops otherwise). */
export async function isInboxConfigured(): Promise<boolean> {
  return (await loadRtaInboxConfig()).configured;
}

/** Upsert the inbox config. A blank password keeps the previously-saved one. */
export async function saveRtaInboxConfig(
  input: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; domain?: string },
  adminUserId: string
): Promise<void> {
  const prev = await readStored();
  let passEnc = prev?.passEnc ?? null;
  const freshPass = input.pass?.trim();
  if (freshPass) passEnc = encrypt(freshPass);

  const value: StoredInboxConfig = {
    host: input.host?.trim() || prev?.host || null,
    port: input.port ?? prev?.port ?? 993,
    secure: input.secure ?? prev?.secure ?? true,
    user: input.user?.trim() || prev?.user || null,
    passEnc,
    domain: normDomain(input.domain || prev?.domain),
  };
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ('rta_inbox', $1::jsonb, now(), $2::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(value), adminUserId]
  );
  invalidateRtaInboxConfigCache();
}

/** Masked status for the admin UI — never returns the password. */
export async function getRtaInboxStatusForAdmin(): Promise<{
  configured: boolean;
  source: string;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  domain: string;
  hasPassword: boolean;
}> {
  const stored = await readStored();
  const cfg = await loadRtaInboxConfig(true);
  return {
    configured: cfg.configured,
    source: cfg.source,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    domain: cfg.domain,
    hasPassword: !!(stored?.passEnc || process.env.RTA_INBOX_PASS),
  };
}
