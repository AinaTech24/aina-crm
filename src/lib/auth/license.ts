/**
 * License gate helpers.
 *
 * Every MFD dashboard server component calls `loadTenantLicense(tenantId)`.
 * The returned object tells the dashboard layout whether to render the
 * full app or the restricted "Renew your license" screen.
 *
 * Allowed routes when restricted:
 *   - /dashboard/billing
 *   - /dashboard/support
 * Everything else shows the restricted screen, no data leaks.
 */

import { cache } from "react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { subscriptions, packages } from "@/db/schema";
import { isPlatformAdmin } from "@/lib/platform";

export type LicenseState = {
  status: "trial" | "active" | "past_due" | "suspended" | "expired" | "cancelled" | "no_subscription";
  packageKey: string | null;
  enabledModules: string[];
  allowedFields: string[] | null;
  /** Admin → MFD sidebar nav grant (hrefs). null = package-module default. */
  allowedNav: string[] | null;
  /** Admin → MFD dashboard-widget grant (keys). null = all widgets visible. */
  allowedDashboardWidgets: string[] | null;
  featureFlags: Record<string, any>;
  maxUsers: number;
  maxInvestors: number;
  trialEndsAt: Date | null;
  licenseEndAt: Date | null;
  nextRenewalAt: Date | null;
  isRestricted: boolean; // true → only billing + support visible
  reason?: string;
};

const RESTRICTED_STATUSES = new Set(["suspended", "expired", "cancelled"]);

/**
 * Per-request memoized. The layout + several server components all call this
 * with the same (tenantId, session.roles) within one render; React.cache()
 * collapses them to a single subscription+package DB read. session.roles is a
 * stable reference per request (getSession is itself cached), so it hits.
 */
export const loadTenantLicense = cache(loadTenantLicenseImpl);

async function loadTenantLicenseImpl(tenantId: string, roles?: string[]): Promise<LicenseState> {
  // Platform admins are never restricted.
  if (isPlatformAdmin(roles)) {
    return {
      status: "active",
      packageKey: "platform_admin",
      enabledModules: [],
      allowedFields: null,
      allowedNav: null,
      allowedDashboardWidgets: null,
      featureFlags: {},
      maxUsers: 1e9,
      maxInvestors: 1e9,
      trialEndsAt: null,
      licenseEndAt: null,
      nextRenewalAt: null,
      isRestricted: false,
    };
  }

  // Read the tenant's own subscription + package inside a tenant context so it
  // works under RLS (a non-superuser app role can't read cross-tenant). The
  // tenant_isolation policy scopes the subscription; packages is a public
  // catalog (packages_read).
  const { sub, pkg } = await withTenant(tenantId, async (tx) => {
    const subs = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
    const s = subs[0];
    if (!s) return { sub: null as typeof subs[number] | null, pkg: null as any };
    const pkgRows = await tx.select().from(packages).where(eq(packages.id, s.packageId)).limit(1);
    return { sub: s, pkg: pkgRows[0] ?? null };
  });
  if (!sub) {
    return {
      status: "no_subscription",
      packageKey: null,
      enabledModules: [],
      allowedFields: null,
      allowedNav: null,
      allowedDashboardWidgets: null,
      featureFlags: {},
      maxUsers: 1,
      maxInvestors: 100,
      trialEndsAt: null,
      licenseEndAt: null,
      nextRenewalAt: null,
      isRestricted: true,
      reason: "No active subscription. Contact AINA to provision your license.",
    };
  }

  // `pkg` already loaded in the withTenant block above.

  // Auto-expire if trial / license end passed
  let effectiveStatus = sub.status;
  const now = Date.now();
  if (sub.status === "trial" && sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() < now) {
    effectiveStatus = "expired";
  } else if (sub.status === "active" && sub.licenseEndAt && new Date(sub.licenseEndAt).getTime() < now) {
    effectiveStatus = "expired";
  }

  const isRestricted = RESTRICTED_STATUSES.has(effectiveStatus);

  const enabledModules = sub.modulesOverride
    ? (sub.modulesOverride as string[])
    : ((pkg?.enabledModules as string[]) ?? []);
  const allowedFields = (sub.allowedFields as string[]) ?? null;
  const allowedNav = (sub.allowedNav as string[]) ?? null;
  const allowedDashboardWidgets = (sub.allowedDashboardWidgets as string[]) ?? null;

  return {
    status: effectiveStatus as LicenseState["status"],
    packageKey: sub.packageKey,
    enabledModules,
    allowedFields,
    allowedNav,
    allowedDashboardWidgets,
    featureFlags: (pkg?.featureFlags as Record<string, any>) ?? {},
    maxUsers: pkg?.maxUsers ?? 1,
    maxInvestors: pkg?.maxInvestors ?? 100,
    trialEndsAt: sub.trialEndsAt ? new Date(sub.trialEndsAt) : null,
    licenseEndAt: sub.licenseEndAt ? new Date(sub.licenseEndAt) : null,
    nextRenewalAt: sub.nextRenewalAt ? new Date(sub.nextRenewalAt) : null,
    isRestricted,
    reason: isRestricted
      ? sub.suspendedReason ?? sub.cancelledReason ?? "Your license is not active. Please contact AINA to reactivate."
      : undefined,
  };
}

/** Allowed paths during restriction. */
export function isPathAllowedWhenRestricted(pathname: string): boolean {
  return (
    pathname === "/dashboard/billing" ||
    pathname.startsWith("/dashboard/billing/") ||
    pathname === "/dashboard/support" ||
    pathname.startsWith("/dashboard/support/") ||
    pathname === "/api/auth/logout"
  );
}

/**
 * API-side license guard. Call from any mutating endpoint to block writes when
 * the tenant's license is suspended/expired/cancelled. Platform admins always
 * pass. Throws a 402-shaped error (Payment Required) — the route handler's
 * catch block surfaces it as JSON.
 *
 * Read-only routes intentionally do NOT call this — restricted tenants can
 * still view their data, they just can't mutate.
 *
 * Usage:
 *   const session = await requireSession();
 *   await assertActiveLicense(session.tenantId, session.roles);
 */
export async function assertActiveLicense(tenantId: string, roles?: string[]): Promise<void> {
  const license = await loadTenantLicense(tenantId, roles);
  if (license.isRestricted) {
    throw Object.assign(new Error(`license ${license.status}: ${license.reason ?? "renew to continue"}`), {
      status: 402,
    });
  }
}

/**
 * Server-side MODULE gate. The sidebar already hides modules a tenant's plan
 * doesn't include, but that's UI-only — a direct URL/API hit would bypass it.
 * Call this in module APIs (e.g. leads, investors, campaigns) so a tenant
 * without the module in their plan can't reach the data through the back door.
 *
 * Platform admins always pass. FAIL-OPEN when a plan has NO modules configured
 * (misconfigured / legacy tenant) so we never accidentally lock a firm out of
 * their own data — we only block when the plan explicitly lists modules and
 * this one isn't among them. Throws a 403-shaped error.
 */
export async function assertModuleEnabled(
  tenantId: string,
  moduleKey: string,
  roles?: string[]
): Promise<void> {
  if (isPlatformAdmin(roles)) return;
  const license = await loadTenantLicense(tenantId, roles);
  if (license.enabledModules.length > 0 && !license.enabledModules.includes(moduleKey)) {
    throw Object.assign(
      new Error(`module '${moduleKey}' is not included in your plan`),
      { status: 403 }
    );
  }
}
