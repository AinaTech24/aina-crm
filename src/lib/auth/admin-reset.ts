/**
 * A password-reset link started by someone else — AINA support (Aina Admin →
 * firm → Team) or the firm's own admin (Team Members). Same token as the
 * self-service /api/auth/forgot flow: one-time, stored hashed, valid one
 * hour, emailed to the user. Whoever starts it never sees the link or the
 * password; setting the new password signs the user out everywhere
 * (/api/auth/reset).
 */

import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { sendSystemEmail, actionEmailHtml, type SystemEmailResult } from "@/lib/comms/system-email";

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}${"*".repeat(Math.max(1, user.length - 1))}@${domain}`;
}

/** Why a user cannot be sent a reset link, or null when they can. */
export function resetBlocker(u: { email: string | null; status: string }, inviteWhere: string): string | null {
  if (!u.email) return "This team member has no email address to send the link to.";
  if (u.status === "invited") return `This team member has not accepted their invite yet — resend the invite ${inviteWhere} instead.`;
  if (u.status !== "active") return `This team member's login is ${u.status}, so a reset link would not let them in.`;
  return null;
}

/** Store a one-hour reset token for the user and return the link (inside the caller's transaction). */
export async function createResetLink(
  tx: Tx,
  u: { id: string; tenantId: string; email: string },
  req: { headers: Headers },
  origin: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await tx.execute(sql`
    INSERT INTO password_resets (id, user_id, tenant_id, email, token_hash, expires_at,
                                 request_ip, request_user_agent, created_at, updated_at)
    VALUES (${uuid()}, ${u.id}, ${u.tenantId}, ${u.email.toLowerCase()}, ${tokenHash}, ${expiresAt},
            ${req.headers.get("x-forwarded-for") ?? origin},
            ${req.headers.get("user-agent") ?? ""},
            now(), now())
  `);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/reset-password?token=${token}`;
}

/** Email the link. `by` names who started it ("An administrator", "Your firm's admin"). */
export async function sendResetEmail(o: { tenantId: string; email: string; name: string | null; resetUrl: string; by: string }): Promise<SystemEmailResult> {
  const hi = `Hi${o.name ? " " + o.name : ""}`;
  const res = await sendSystemEmail({
    tenantId: o.tenantId,
    to: o.email,
    subject: "Reset your password",
    text:
      `${hi},\n\n` +
      `${o.by} started a password reset for your account. Open this link to set a new password (valid for 1 hour):\n${o.resetUrl}\n\n` +
      `If you didn't expect this, contact your administrator.`,
    html: actionEmailHtml({
      heading: "Reset your password",
      intro: `${hi}, ${o.by.charAt(0).toLowerCase() + o.by.slice(1)} started a password reset for your account. This link is valid for 1 hour.`,
      buttonLabel: "Set a new password",
      buttonUrl: o.resetUrl,
      note: "If you didn't expect this, please contact your administrator.",
    }),
    idempotencyKey: `pwreset-admin:${o.email}:${o.resetUrl.slice(-16)}`,
  });
  return res;
}
