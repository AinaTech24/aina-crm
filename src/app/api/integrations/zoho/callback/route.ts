/**
 * GET /api/integrations/zoho/callback
 *
 * OAuth redirect target. Exchanges the authorization code for a long-lived
 * refresh token and stores the per-tenant Zoho connection, then bounces the
 * user back to Settings.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withTenant } from "@/db/client";
import { dcFromLocation } from "@/lib/integrations/zoho/datacenters";
import { exchangeCodeForTokens } from "@/lib/integrations/zoho/client";
import { saveZohoConnection } from "@/lib/integrations/zoho/credentials";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const sp = req.nextUrl.searchParams;
  const settingsUrl = new URL("/dashboard/settings/integrations", req.url);

  const code = sp.get("code");
  if (sp.get("error") || !code) {
    settingsUrl.searchParams.set("zoho", "error");
    return NextResponse.redirect(settingsUrl);
  }

  const dc = dcFromLocation(sp.get("location"));
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const redirectUri = `${proto}://${host}/api/integrations/zoho/callback`;

  const result = await exchangeCodeForTokens(dc, code, redirectUri);
  if ("error" in result) {
    console.error("[zoho] token exchange failed:", result.error);
    settingsUrl.searchParams.set("zoho", "error");
    return NextResponse.redirect(settingsUrl);
  }

  await withTenant(session.tenantId, async (tx) => {
    await saveZohoConnection(tx, session.tenantId, {
      dataCenter: dc,
      refreshToken: result.refreshToken,
      grantedBy: session.email ?? session.userId,
    });
  });

  settingsUrl.searchParams.set("zoho", "connected");
  return NextResponse.redirect(settingsUrl);
}
