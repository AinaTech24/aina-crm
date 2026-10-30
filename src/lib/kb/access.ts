/**
 * Who may read the Knowledge Base: a signed-in user whose firm has a live
 * subscription (active or trial), or AINA platform staff. Everyone else —
 * anonymous, lapsed, expired, never subscribed — is told the page does not exist
 * (404, not a login redirect), so the help centre is not discoverable by URL.
 */

import { getSession } from "@/lib/auth/session";
import { loadTenantLicense } from "@/lib/auth/license";
import { isPlatformAdmin } from "@/lib/platform";

export async function canReadKnowledgeBase(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  if (isPlatformAdmin(session.roles)) return true;
  if (!session.tenantId) return false;
  const lic = await loadTenantLicense(session.tenantId, session.roles);
  return lic.status === "active" || lic.status === "trial";
}
