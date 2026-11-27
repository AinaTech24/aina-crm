/**
 * One shared client book on every screen (Investment Options, 2026-11-27).
 *
 * With the data wall off, the client list and client pages already show every
 * client to everyone who may see clients. About 30 other screens (business
 * entries, activities, calendar, communications, goals, plans …) still ask
 * can(…, "investor.view.all"), which an RM, branch head or insurance team
 * member lacks by role. With the firm's "clientBookEverywhere" switch on,
 * getSession appends SHARED_BOOK_MARKER to such a viewer's roles for the
 * request, and can() reads it as "View all clients" — one rule instead of 227
 * call sites.
 *
 * Never for: the owner (already sees all), platform staff, someone whose
 * access was customised (their ticks are an allow-list and stay exact), or a
 * role that may not see clients at all (marketing). Never written to a token
 * (signSession strips it), so switching the flag off takes effect at once.
 */

import { can, SHARED_BOOK_MARKER } from "./rbac";
import { loadTenantLicense } from "./license";
import type { SessionUser } from "./jwt";

export const CLIENT_BOOK_EVERYWHERE_FLAG = "clientBookEverywhere";

/** Should this viewer get the marker, before the firm's switch is read? */
export function sharedBookCandidate(session: SessionUser): boolean {
  const roles = session.roles ?? [];
  if (!roles.length || session.isPlatformAdmin) return false;
  if (roles.includes("owner") || roles.includes(SHARED_BOOK_MARKER)) return false;
  if ((session.permissions?.length ?? 0) > 0) return false;
  if (roles.some((r) => r.startsWith("platform_"))) return false;
  return can(roles, "investor.view.assigned") && !can(roles, "investor.view.all");
}

export async function withSharedClientBook(session: SessionUser): Promise<SessionUser> {
  if (!sharedBookCandidate(session)) return session;
  try {
    const lic = await loadTenantLicense(session.tenantId, session.roles);
    if (lic.featureFlags?.[CLIENT_BOOK_EVERYWHERE_FLAG] !== true) return session;
  } catch {
    return session;
  }
  // Appended IN PLACE: this request's session is a fresh object (readSession),
  // and keeping the same array lets every later loadTenantLicense(tenantId,
  // session.roles) in the request hit React.cache instead of reading again.
  session.roles.push(SHARED_BOOK_MARKER);
  return session;
}
