/**
 * Who may use the Zoho CRM import: only a firm whose "Zoho CRM import" flag is
 * on (Aina Admin → the firm → Access → feature flags; set for We Care Freedom
 * Wealth on 2026-11-14), and inside it only someone who may edit every client
 * (clients) or manage every meeting (meetings).
 */

import { loadTenantLicense } from "@/lib/auth/license";
import { can } from "@/lib/auth/rbac";

export const ZOHO_IMPORT_FLAG = "zohoImport";

type SessionLike = { tenantId: string; roles: string[]; permissions?: any };

export async function zohoImportEnabled(tenantId: string, roles?: string[]): Promise<boolean> {
  const license = await loadTenantLicense(tenantId, roles);
  return license.featureFlags?.[ZOHO_IMPORT_FLAG] === true;
}

export function mayImportZoho(session: SessionLike, kind: "contacts" | "meetings"): boolean {
  return kind === "contacts"
    ? can(session.roles, "investor.edit.all", session.permissions)
    : can(session.roles, "review_meeting.manage.all", session.permissions);
}

/** Throws a 404-shaped error when the firm does not have it, 403 when the person may not. */
export async function assertZohoImport(session: SessionLike, kind: "contacts" | "meetings"): Promise<void> {
  if (!(await zohoImportEnabled(session.tenantId, session.roles))) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
  if (!mayImportZoho(session, kind)) {
    throw Object.assign(new Error(kind === "contacts" ? "You need permission to edit all clients." : "You need permission to manage all meetings."), { status: 403 });
  }
}
