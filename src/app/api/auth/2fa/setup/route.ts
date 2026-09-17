import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/auth/2fa/setup
 *   Begins TOTP enrollment for the logged-in user. Generates a fresh secret
 *   (stored pending — twoFaEnabled stays false until the first code verifies),
 *   and returns the otpauth URI, a QR data-URL, and the secret for manual entry.
 *
 *   Self-service: any authenticated user can set up 2FA on their own account.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import QRCode from "qrcode";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { generateSecret, otpauthUri, encryptSecret } from "@/lib/auth/totp";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    if (!session.authTime || Date.now() / 1000 - session.authTime > 15 * 60) {
      return NextResponse.json({ error: "Sign in again before changing two-factor authentication" }, { status: 403 });
    }

    const secret = generateSecret();
    // Store the pending secret ENCRYPTED at rest; do NOT enable until /enable
    // verifies a code. The plaintext is only returned to the enrolling browser.
    const storedSecret = encryptSecret(secret);
    const updated = await withTenant(session.tenantId, async (tx) => {
      return tx.execute(sql`
        UPDATE users
        SET two_fa_secret = ${storedSecret}, updated_at = now()
        WHERE id = ${session.userId} AND two_fa_enabled IS NOT TRUE
        RETURNING id
      `);
    });
    if (!updated.rows.length) {
      return NextResponse.json({ error: "Two-factor authentication is already enabled. Disable it with your password before starting a new enrollment." }, { status: 409 });
    }

    const uri = otpauthUri(secret, session.email || session.userId);
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });

    return NextResponse.json({ secret, otpauthUri: uri, qrDataUrl });
  } catch (err: any) {
    return handleApiError(err);
  }
}
