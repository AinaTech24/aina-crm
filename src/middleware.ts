/**
 * Edge middleware. Runs on every dashboard + API request.
 *
 * REV: 2025-12 — added /r /d /p public form whitelist for client share-links.
 *
 * Responsibilities:
 *   1. Verify the session JWT once, stash decoded payload on the
 *      `x-mfd-session` header so downstream handlers don't re-verify.
 *   2. Redirect unauthenticated users away from /dashboard.
 *   3. Reject unauthenticated /api/* calls with 401.
 *
 * NOTE: tenant scoping itself happens in `withTenant()` at the DB layer —
 * this middleware just ensures the session exists and is valid. The actual
 * RLS enforcement is in Postgres.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const config = {
  /**
   * Match all paths EXCEPT static assets + Next internals.
   * Excluding more file types here cuts ~30-40 % of middleware invocations
   * on a typical page load (every CSS/font/JS chunk would otherwise trigger
   * JWT verification).
   */
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|css|js|map)).*)",
  ],
};

const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite"]);

/**
 * Path prefixes that should never require a session.
 *
 *   /r/*    — public risk-profile questionnaire (client clicks WA/email link)
 *   /d/*    — public document-collection form
 *   /p/*    — public proposal-approval page
 *   /api/public/*  — submission endpoints for the above
 *   /api/webhooks/* — AiSensy / Resend / etc.
 *   /api/health, /api/auth/*, /api/employees/accept-invite — auth flows
 */
const PUBLIC_PATH_PREFIXES = ["/r/", "/d/", "/p/"];
const PUBLIC_API_PREFIXES = [
  "/api/public/",
  "/api/webhooks/",
  "/api/health",
  "/api/auth/",
  "/api/employees/accept-invite",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public marketing pages
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  // Public form routes — clients click WA/email links without logging in
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Dev escape hatch — set NO_AUTH=1 to bypass and inject the demo session.
  // Useful for previewing the UI before a real auth wiring lands.
  // HARD-DISABLED in production builds: an accidentally-set env var would
  // hand any unauthenticated visitor an owner+rm+compliance session.
  if (process.env.NO_AUTH === "1" && process.env.NODE_ENV !== "production") {
    const res = NextResponse.next();
    res.headers.set(
      "x-mfd-session",
      JSON.stringify({
        userId: "00000000-0000-0000-0000-000000000001",
        tenantId: "00000000-0000-0000-0000-000000000001",
        branchId: "00000000-0000-0000-0000-000000000002",
        roles: ["owner", "rm", "compliance"],
        email: "owner@demo.local",
        name: "Demo Owner",
      })
    );
    return res;
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Platform admin trying to access MFD dashboard? Redirect to /super-admin
  // (and vice versa — MFD users blocked from /super-admin)
  if (session.isPlatformAdmin) {
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
      return NextResponse.redirect(new URL("/super-admin", req.url));
    }
  } else {
    if (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const res = NextResponse.next();
  res.headers.set("x-mfd-session", JSON.stringify(session));
  // Expose the request pathname so server components can do path-aware
  // logic (e.g. license-restricted carve-out for /dashboard/billing).
  res.headers.set("x-pathname", pathname);
  return res;
}
