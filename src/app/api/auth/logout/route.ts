import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Clears ONLY the session cookie for the surface you're signing out of, so
 * logging out of the Aina console doesn't also kill an MFD session open in
 * another tab (and vice versa).
 *
 *   ?scope=admin  → clear aina_session
 *   ?scope=mfd    → clear mfd_session
 *   ?scope=all    → clear both
 *   (no scope)    → infer from the Referer; default to the MFD cookie
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  const scope = new URL(req.url).searchParams.get("scope");
  const referer = req.headers.get("referer") ?? "";
  const isAdmin =
    scope === "admin" ||
    (scope == null && /\/super-admin(\/|$|\?)/.test(referer));

  if (scope === "all") {
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(ADMIN_SESSION_COOKIE);
  } else {
    res.cookies.delete(isAdmin ? ADMIN_SESSION_COOKIE : SESSION_COOKIE);
  }
  return res;
}
