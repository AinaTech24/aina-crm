/**
 * Keyed tokens for comparing personal identifiers inside the staging tables.
 *
 * A PAN is ten characters from a small alphabet with a fixed shape (and the
 * fourth letter is one of ten): a plain SHA-256 of it can be reversed by
 * enumeration in minutes. So staging never stores a PAN, nor a plain hash of
 * one. It stores `pt1:` + HMAC-SHA256(key, tenantId ":" PAN), where the key is
 *
 *   RTA_STAGING_TOKEN_KEY  (64 hex chars) when set — a dedicated secret, or
 *   HKDF-SHA256(ENCRYPTION_KEY, info "aina/rta-staging/pan-token/v1")
 *
 * Both live in the server's environment, never in the database, so a copy of
 * the staging tables alone cannot be turned back into PANs. The tenant id in
 * the message means the same PAN gives a different token in another firm, so
 * tokens cannot be joined across tenants either.
 *
 * There is NO development fallback: without a key the pipeline refuses to run
 * (PanTokenKeyMissingError) rather than write weaker tokens.
 *
 * Rotation: the version prefix (`pt1:`) names the derivation. A new key or
 * construction gets `pt2:`; old batches keep their tokens (they are an audit
 * trail, not a lookup index) and comparisons are only ever made within a
 * single version.
 *
 * The same key (a different HKDF label) also keys the row hashes and group
 * signatures, which carry folio numbers and amounts.
 */
import { createHmac, hkdfSync } from "node:crypto";
import { validPan } from "../values";

export class PanTokenKeyMissingError extends Error {
  constructor() {
    super("RTA staging needs RTA_STAGING_TOKEN_KEY or ENCRYPTION_KEY (64 hex characters) to tokenise PANs — refusing to run without it");
    this.name = "PanTokenKeyMissingError";
  }
}

const keys = new Map<string, Buffer>();

function keyFor(label: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  const cacheKey = `${label}|${env.RTA_STAGING_TOKEN_KEY ?? ""}|${env.ENCRYPTION_KEY ?? ""}`;
  const hit = keys.get(cacheKey);
  if (hit) return hit;
  const hex = (env.RTA_STAGING_TOKEN_KEY || env.ENCRYPTION_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new PanTokenKeyMissingError();
  const ikm = Buffer.from(hex, "hex");
  const key = Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), `aina/rta-staging/${label}/v1`, 32));
  keys.set(cacheKey, key);
  return key;
}

/** Throws PanTokenKeyMissingError when no key is configured. */
export function assertTokenKey(env: NodeJS.ProcessEnv = process.env): void {
  keyFor("pan-token", env);
}

/** `pt1:<base64url>` for a valid PAN, null for anything else (never a token of garbage). */
export function panToken(tenantId: string, raw: string | null | undefined): string | null {
  const pan = validPan(raw);
  if (!pan) return null;
  return "pt1:" + createHmac("sha256", keyFor("pan-token")).update(`${tenantId}:${pan}`).digest("base64url");
}

/** Keyed digest for row hashes / invariant hashes / lot signatures. */
export function keyedDigest(tenantId: string, kind: string, payload: string): string {
  return "kd1:" + createHmac("sha256", keyFor("digest")).update(`${tenantId}:${kind}:${payload}`).digest("base64url");
}
