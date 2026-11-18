/**
 * The one-time code that confirms an NDA signature (owner's addition C.4).
 *
 * Reuses the platform's email-OTP mechanism (lib/public-otp.ts and the
 * public_email_otps table, migration 0173): a random 6-digit code, only its
 * keyed SHA-256 stored, 10-minute expiry, 5 wrong tries, 60 s between resends.
 * The code goes to the signer's VERIFIED sign-in email. One live code per
 * (firm, signer, NDA version) — its row id is derived from those, so a resend
 * replaces the previous code.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { generateOtpCode, hashOtpCode, otpHashMatches, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SEC, OTP_TTL_MS } from "@/lib/public-otp";

/** Deterministic token id for (tenant, user, document). */
export function ndaOtpTokenId(tenantId: string, userId: string, documentId: string): string {
  const h = crypto.createHash("sha256").update(`nda-otp:${tenantId}:${userId}:${documentId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type OtpRow = { code_hash: string; expires_at: string | Date; attempts: number; verified_at: string | Date | null; created_at: string | Date };

export type OtpCheck = { ok: true } | { ok: false; reason: "none" | "expired" | "too_many" | "wrong"; message: string };

/** Pure: is this code good for this row now? (A wrong code costs a try.) */
export function checkOtp(row: OtpRow | null | undefined, code: string, now: Date): OtpCheck {
  if (!row) return { ok: false, reason: "none", message: "Send yourself a code first." };
  if (new Date(row.expires_at).getTime() < now.getTime()) return { ok: false, reason: "expired", message: "That code has expired — send a new one." };
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "too_many", message: "Too many wrong tries — send a new code." };
  if (!/^\d{6}$/.test(code.trim()) || !otpHashMatches(code.trim(), row.code_hash)) {
    const left = OTP_MAX_ATTEMPTS - Number(row.attempts) - 1;
    return { ok: false, reason: "wrong", message: left > 0 ? `That code is not right — ${left} tr${left === 1 ? "y" : "ies"} left.` : "That code is not right — send a new one." };
  }
  return { ok: true };
}

/** Create (or replace) the code. Returns it for the caller to email, or a wait. */
export async function issueNdaOtp(
  tx: Tx,
  a: { tenantId: string; userId: string; documentId: string; email: string; now?: Date }
): Promise<{ ok: true; code: string } | { ok: false; waitSec: number }> {
  const now = a.now ?? new Date();
  const tokenId = ndaOtpTokenId(a.tenantId, a.userId, a.documentId);
  const prev = (await tx.execute(sql`SELECT created_at FROM public_email_otps WHERE token_id = ${tokenId}::uuid`)).rows[0] as { created_at: string } | undefined;
  if (prev) {
    const since = (now.getTime() - new Date(prev.created_at).getTime()) / 1000;
    if (since < OTP_RESEND_COOLDOWN_SEC) return { ok: false, waitSec: Math.ceil(OTP_RESEND_COOLDOWN_SEC - since) };
  }
  const code = generateOtpCode();
  await tx.execute(sql`
    INSERT INTO public_email_otps (tenant_id, token_id, email, code_hash, expires_at, attempts, verified_at, created_at)
    VALUES (${a.tenantId}::uuid, ${tokenId}::uuid, ${a.email}, ${hashOtpCode(code)}, ${new Date(now.getTime() + OTP_TTL_MS)}, 0, NULL, ${now})
    ON CONFLICT (token_id) DO UPDATE SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
                                         attempts = 0, verified_at = NULL, created_at = EXCLUDED.created_at
  `);
  return { ok: true, code };
}

/** Verify (and consume) the code inside the signing transaction. */
export async function verifyNdaOtp(tx: Tx, a: { tenantId: string; userId: string; documentId: string; code: string; now?: Date }): Promise<OtpCheck> {
  const now = a.now ?? new Date();
  const tokenId = ndaOtpTokenId(a.tenantId, a.userId, a.documentId);
  const row = (await tx.execute(sql`
    SELECT code_hash, expires_at, attempts, verified_at, created_at FROM public_email_otps WHERE token_id = ${tokenId}::uuid FOR UPDATE
  `)).rows[0] as OtpRow | undefined;
  if (row?.verified_at) return { ok: false, reason: "none", message: "That code was already used — send a new one." };
  const r = checkOtp(row, a.code, now);
  if (!r.ok && r.reason === "wrong") {
    await tx.execute(sql`UPDATE public_email_otps SET attempts = attempts + 1 WHERE token_id = ${tokenId}::uuid`);
  }
  if (r.ok) await tx.execute(sql`UPDATE public_email_otps SET verified_at = ${now} WHERE token_id = ${tokenId}::uuid`);
  return r;
}
