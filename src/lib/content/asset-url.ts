import { or, isNull, eq } from "drizzle-orm";
import { contentLibraryAssets } from "@/db/schema";

/**
 * A content-library asset is visible to a tenant iff it's platform-global
 * (tenant_id IS NULL) OR belongs to that tenant. The table has no usable
 * single-tenant RLS policy (it's dual-purpose), so callers MUST apply this
 * predicate explicitly — especially the ones reading via withSystem (which
 * bypasses RLS entirely).
 */
export function assetVisibleTo(tenantId: string) {
  return or(isNull(contentLibraryAssets.tenantId), eq(contentLibraryAssets.tenantId, tenantId));
}

/** Reject URLs pointing at internal/loopback/link-local hosts (SSRF guard). */
export function isUnsafeAssetUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `unsupported protocol "${u.protocol}"`;
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1" || host === "::") {
    return "host is loopback/unspecified";
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return "host is a private/loopback/link-local IP";
    }
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) {
    return "host is a private/link-local IPv6 address";
  }
  return null;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Fetch a content-library asset's bytes safely:
 *   - SSRF guard (no internal hosts — asset fileUrls are tenant-controllable)
 *   - 10s timeout (no hung connections)
 *   - 25 MB cap (pre-check Content-Length + post-check actual size → no OOM)
 *   - no redirect following (a 3xx to an internal host would bypass the guard)
 */
export async function fetchAssetBytes(fileUrl: string): Promise<{ ok: true; buf: Buffer } | { ok: false; status: number; error: string }> {
  const unsafe = isUnsafeAssetUrl(fileUrl);
  if (unsafe) return { ok: false, status: 400, error: `Blocked asset URL (${unsafe})` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(fileUrl, { signal: controller.signal, redirect: "manual" });
    if (!res.ok) return { ok: false, status: 502, error: `source fetch failed (${res.status})` };
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_ASSET_BYTES) return { ok: false, status: 413, error: "asset too large" };
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_ASSET_BYTES) return { ok: false, status: 413, error: "asset too large" };
    return { ok: true, buf: Buffer.from(ab) };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "source fetch timed out" : e?.message ?? String(e);
    return { ok: false, status: 502, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
