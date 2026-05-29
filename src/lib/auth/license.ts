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

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { subscriptions, packages } from "@/db/schema";
import { isPlatformAdmin } from "@/lib/platform";

export type LicenseState = {
  status: "trial" | "active" | "past_due" | "suspended" | "expired" | "cancelled" | "no_subscription";
  packageKey: string | null;
  enabledModules: string[];
  allowedFields: string[] | null;
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

export async function loadTenantLicense(tenantId: string, roles?: string[]): Promise<LicenseState> {
  // Platform admins are never restricted.
  if (isPlatformAdmin(roles)) {
    return {
      status: "active",
      packageKey: "platform_admin",
      enabledModules: [],
      allowedFields: null,
      featureFlags: {},
      maxUsers: 1e9,
      maxInvestors: 1e9,
      trialEndsAt: null,
      licenseEndAt: null,
      nextRenewalAt: null,
      isRestricted: false,
    };
  }

  // Query directly without RLS — license info is OK to surface to the tenant
  // owner regardless. Uses a separate connection / public role.
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  const sub = subs[0];
  if (!sub) {
    return {
      status: "no_subscription",
      packageKey: null,
      enabledModules: [],
      allowedFields: null,
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

  const pkgRows = await db.select().from(packages).where(eq(packages.id, sub.packageId)).limit(1);
  const pkg = pkgRows[0];

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

  return {
    status: effectiveStatus as LicenseState["status"],
    packageKey: sub.packageKey,
    enabledModules,
    allowedFields,
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
