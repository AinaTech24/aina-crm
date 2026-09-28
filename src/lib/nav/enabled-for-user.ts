import { loadTenantLicense } from "@/lib/auth/license";
import { loadModuleControls } from "@/lib/platform/module-controls";
import { isGatableNav, tenantAccessibleNavKeys } from "@/config/nav-access";

/**
 * Whether this user's sidebar offers `href`: the same three gates the
 * dashboard layout applies to every nav item — the platform Module Controls
 * kill-switch, the firm's nav grant, and the user's own grant (an owner always
 * gets the firm's full set). Role gates differ per item and stay the caller's.
 *
 * For a screen that should mention a module only when the user can open it
 * (My Day's "Clock in for today" and Attendance).
 */
export async function navEnabledForUser(
  session: { tenantId: string; roles: string[] },
  /** users.enabled_modules — null means "inherit the firm's set". */
  userModules: string[] | null,
  href: string
): Promise<boolean> {
  const controls = await loadModuleControls();
  if (controls[href] === "disabled") return false;
  if (!isGatableNav(href)) return true;
  const license = await loadTenantLicense(session.tenantId, session.roles);
  const allowed = tenantAccessibleNavKeys({
    allowedNav: license.allowedNav,
    enabledModules: license.enabledModules,
    enabledFeatures: license.enabledFeatures,
  });
  if (!allowed.includes(href)) return false;
  if (session.roles.includes("owner")) return true;
  return userModules === null || userModules.includes(href);
}
