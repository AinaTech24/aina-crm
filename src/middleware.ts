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
// Import from the Edge-safe primitives module — NOT @/lib/auth/session, which
// pulls in the Node-only DB-backed revocation check (pg) and would break the
// Edge middleware bundle.
import {
  SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  verifySession,
  isAdminSurface,
  sessionCookieForPath,
} from "@/lib/auth/jwt";

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
 *   /lf/*   — public lead-capture form (Sprint 3 #15) — MFD embeds on
 *             their own website; submissions create a new lead
 *   /api/public/*  — submission endpoints for the above
 *   /api/webhooks/* — Wapi / Resend / etc.
 *   /api/health, /api/auth/*, /api/employees/accept-invite — auth flows
 */
const PUBLIC_PATH_PREFIXES = ["/r/", "/d/", "/p/", "/lf/"];
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
    // Point the demo session at the seeded demo owner (tenant that actually
    // holds the demo book) so every tenant-scoped page renders populated.
    // Overridable via DEMO_* env vars for a reseeded DB with fresh ids.
    res.headers.set(
      "x-mfd-session",
      JSON.stringify({
        userId: process.env.DEMO_USER_ID ?? "c59fb71f-2bc9-426d-a7b4-8d59cad5481b",
        tenantId: process.env.DEMO_TENANT_ID ?? "3a8231bb-8ff2-4f49-bcca-bb41857c5be2",
        branchId: process.env.DEMO_BRANCH_ID ?? "cfdc80f1-e03f-414f-bab5-460967f524a5",
        roles: ["owner", "rm", "compliance"],
        email: "owner@demo.in",
        name: "Rajesh Demo (Owner)",
      })
    );
    return res;
  }

  // Resolve the session from the cookie that governs THIS surface. The admin
  // console (/super-admin, /api/super-admin) reads `aina_session`; everything
  // else reads `mfd_session`. Two separate cookies = an Aina-admin login and an
  // MFD login can coexist in the same browser without overwriting each other.
  const onAdminSurface = isAdminSurface(pathname);
  const cookieName = sessionCookieForPath(pathname);
  const token = req.cookies.get(cookieName)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }
    // Nicety: an Aina admin who lands on an MFD page (no mfd_session) but holds
    // a valid admin session is sent to their console instead of the login page.
    if (!onAdminSurface) {
      const adminToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
      if (adminToken && (await verifySession(adminToken))?.isPlatformAdmin) {
        return NextResponse.redirect(new URL("/super-admin", req.url));
      }
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Surface ↔ role consistency. With separate cookies this is mostly defensive,
  // but it keeps a stray/forged token from landing on the wrong console.
  if (onAdminSurface) {
    if (!session.isPlatformAdmin) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  } else if (
    session.isPlatformAdmin &&
    (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))
  ) {
    return NextResponse.redirect(new URL("/super-admin", req.url));
  }

  const res = NextResponse.next();
  res.headers.set("x-mfd-session", JSON.stringify(session));
  // Expose the request pathname so server components can do path-aware
  // logic (e.g. license-restricted carve-out for /dashboard/billing).
  res.headers.set("x-pathname", pathname);
  return res;
}
