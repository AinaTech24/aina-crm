/**
 * Verifying the buyer's mobile at /pricing's account step — WITHOUT ever
 * blocking a sign-up (the owner's rule, 2026-11-18).
 *
 * Only when SMS one-time codes are configured: MSG91's auth key
 * (`MSG91_AUTH_KEY`) and a DLT-registered OTP template (`MSG91_OTP_TEMPLATE_ID`;
 * the code goes in the flow variable `MSG91_OTP_VAR`, default `var1`). When it
 * is not configured, or MSG91 refuses or is down, the step is skipped and the
 * mobile is recorded as unverified with a server log — the buyer carries on.
 *
 * The code lives on the quote itself (pricing_quotes.mobile_*, migration 0269;
 * there is no firm yet): only its keyed hash (lib/public-otp.ts), 10 minutes,
 * 5 wrong tries, 60 s between sends and at most 5 sends per quote. Verifying
 * stamps `mobile_verified_at`, which the account creation copies onto the
 * owner (users.mobile_verified_at).
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { TemplateVersion } from "@/db/schema";
import { smsAdapter } from "@/lib/comms/adapters/msg91";
import { generateOtpCode, hashOtpCode, OTP_RESEND_COOLDOWN_SEC, OTP_TTL_MS } from "@/lib/public-otp";
import { checkOtp, type OtpCheck } from "./nda-otp";

/** Sends allowed per quote — a resend loop is not a way to text someone 50 times. */
export const MOBILE_OTP_MAX_SENDS = 5;

export type SmsOtpConfig = { authKey: string; templateId: string; variable: string; senderId?: string };

/** The SMS OTP settings, or null when they are not all there. */
export function smsOtpConfig(env: Record<string, string | undefined> = process.env): SmsOtpConfig | null {
  const authKey = (env.MSG91_AUTH_KEY ?? "").trim();
  const templateId = (env.MSG91_OTP_TEMPLATE_ID ?? "").trim();
  if (!authKey || !templateId) return null;
  return { authKey, templateId, variable: (env.MSG91_OTP_VAR ?? "").trim() || "var1", senderId: (env.MSG91_SENDER_ID ?? "").trim() || undefined };
}

export type OtpState = {
  mobile_otp_hash: string | null;
  mobile_otp_expires_at: string | Date | null;
  mobile_otp_attempts: number;
  mobile_otp_sent_at: string | Date | null;
  mobile_otp_sends: number;
  mobile_verified_at: string | Date | null;
};

/** Pure: may a (new) code be sent now? */
export function canSendMobileOtp(s: OtpState, now: Date): { ok: true } | { ok: false; reason: "verified" | "wait" | "too_many"; waitSec?: number } {
  if (s.mobile_verified_at) return { ok: false, reason: "verified" };
  if (Number(s.mobile_otp_sends) >= MOBILE_OTP_MAX_SENDS) return { ok: false, reason: "too_many" };
  if (s.mobile_otp_sent_at) {
    const since = (now.getTime() - new Date(s.mobile_otp_sent_at).getTime()) / 1000;
    if (since < OTP_RESEND_COOLDOWN_SEC) return { ok: false, reason: "wait", waitSec: Math.ceil(OTP_RESEND_COOLDOWN_SEC - since) };
  }
  return { ok: true };
}

/** Pure: is this code good for this quote now? (The NDA code's rules: expiry, 5 tries, hash.) */
export function checkMobileOtp(s: OtpState, code: string, now: Date): OtpCheck {
  if (!s.mobile_otp_hash || !s.mobile_otp_expires_at) return checkOtp(null, code, now);
  return checkOtp(
    { code_hash: s.mobile_otp_hash, expires_at: s.mobile_otp_expires_at, attempts: s.mobile_otp_attempts, verified_at: null, created_at: s.mobile_otp_sent_at ?? now },
    code,
    now
  );
}

/** "+919876543210" → "+91 98••• ••210". */
export function maskMobile(m: string): string {
  const d = m.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 2)}••• ••${d.slice(7)}` : "your mobile";
}

const STATE_COLS = sql`mobile_otp_hash, mobile_otp_expires_at, mobile_otp_attempts, mobile_otp_sent_at, mobile_otp_sends, mobile_verified_at`;

export type SendResult =
  | { status: "sent"; sentTo: string; resendInSec: number }
  | { status: "verified" }
  /** SMS is not configured, or MSG91 failed: carry on unverified. */
  | { status: "skipped" }
  | { status: "wait"; waitSec: number }
  | { status: "too_many" };

type Sender = (a: { cfg: SmsOtpConfig; mobile: string; code: string; quoteId: string; attempt: number }) => Promise<void>;

const msg91Sender: Sender = async ({ cfg, mobile, code, quoteId, attempt }) => {
  await smsAdapter.send({
    tenantId: "platform",
    templateVersion: { body: { dltTemplateId: cfg.templateId } } as unknown as TemplateVersion,
    tokens: { [cfg.variable]: code },
    rendered: { text: "", tokens: {} },
    recipient: mobile,
    apiKey: cfg.authKey,
    senderId: cfg.senderId,
    idempotencyKey: `pricing-otp:${quoteId}:${attempt}`,
  });
};

/**
 * Text a code to the quote's mobile. Runs in the caller's (system) transaction,
 * the quote row locked. Never throws for an SMS problem — that is `skipped`.
 */
export async function sendMobileOtp(
  tx: Tx,
  quoteId: string,
  opts: { now?: Date; env?: Record<string, string | undefined>; send?: Sender } = {}
): Promise<SendResult> {
  const cfg = smsOtpConfig(opts.env);
  if (!cfg) return { status: "skipped" };
  const now = opts.now ?? new Date();
  const row = (await tx.execute(sql`SELECT mobile, ${STATE_COLS} FROM pricing_quotes WHERE id = ${quoteId}::uuid FOR UPDATE`)).rows[0] as
    | (OtpState & { mobile: string })
    | undefined;
  if (!row) return { status: "skipped" };
  const may = canSendMobileOtp(row, now);
  if (!may.ok) {
    if (may.reason === "verified") return { status: "verified" };
    if (may.reason === "wait") return { status: "wait", waitSec: may.waitSec ?? OTP_RESEND_COOLDOWN_SEC };
    return { status: "too_many" };
  }
  const code = generateOtpCode();
  const attempt = Number(row.mobile_otp_sends) + 1;
  try {
    await (opts.send ?? msg91Sender)({ cfg, mobile: row.mobile, code, quoteId, attempt });
  } catch (err) {
    console.error(`[pricing-otp] SMS could not be sent for quote ${quoteId} — continuing unverified:`, (err as Error)?.message ?? err);
    return { status: "skipped" };
  }
  await tx.execute(sql`
    UPDATE pricing_quotes
       SET mobile_otp_hash = ${hashOtpCode(code)}, mobile_otp_expires_at = ${new Date(now.getTime() + OTP_TTL_MS)},
           mobile_otp_attempts = 0, mobile_otp_sent_at = ${now}, mobile_otp_sends = mobile_otp_sends + 1, updated_at = now()
     WHERE id = ${quoteId}::uuid
  `);
  return { status: "sent", sentTo: maskMobile(row.mobile), resendInSec: OTP_RESEND_COOLDOWN_SEC };
}

/** Check (and consume) a code; a wrong one costs a try. */
export async function verifyMobileOtp(tx: Tx, quoteId: string, code: string, now = new Date()): Promise<OtpCheck | { ok: true; already: true }> {
  const row = (await tx.execute(sql`SELECT ${STATE_COLS} FROM pricing_quotes WHERE id = ${quoteId}::uuid FOR UPDATE`)).rows[0] as OtpState | undefined;
  if (!row) return checkOtp(null, code, now);
  if (row.mobile_verified_at) return { ok: true, already: true };
  const r = checkMobileOtp(row, code, now);
  if (!r.ok && r.reason === "wrong") {
    await tx.execute(sql`UPDATE pricing_quotes SET mobile_otp_attempts = mobile_otp_attempts + 1, updated_at = now() WHERE id = ${quoteId}::uuid`);
  }
  if (r.ok) {
    await tx.execute(sql`
      UPDATE pricing_quotes SET mobile_verified_at = ${now}, mobile_otp_hash = NULL, mobile_otp_expires_at = NULL, updated_at = now()
       WHERE id = ${quoteId}::uuid
    `);
  }
  return r;
}
