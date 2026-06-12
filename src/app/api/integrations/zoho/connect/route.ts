/**
 * GET /api/integrations/zoho/connect
 *
 * Starts the Zoho OAuth consent flow for the signed-in MFD. Redirects the
 * browser to Zoho's authorize screen; Zoho redirects back to /callback with an
 * authorization code (and the user's data-center `location`).
 *
 * The platform's Zoho *app* credentials come from env (ZOHO_CLIENT_ID /
 * ZOHO_CLIENT_SECRET) — set once by the operator, never per tenant.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { accountsServer, dcFromLocation } from "@/lib/integrations/zoho/datacenters";
import { zohoAppCredentials } from "@/lib/integrations/zoho/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await requireSession(); // only a signed-in MFD user may begin the connect flow

  const app = zohoAppCredentials();
  if (!app) {
    return NextResponse.json(
      { error: "Zoho isn't configured on the server. Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const redirectUri = `${proto}://${host}/api/integrations/zoho/callback`;

  // Start at the configured default DC (India for this product). Zoho returns
  // the user's actual DC as `location` on the callback, which we honour there.
  const dc = dcFromLocation(process.env.ZOHO_DEFAULT_DC ?? "in");

  const url = new URL(`${accountsServer(dc)}/oauth/v2/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("scope", "ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.org.READ");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("access_type", "offline"); // we need a refresh token
  url.searchParams.set("prompt", "consent");

  return NextResponse.redirect(url.toString());
}
