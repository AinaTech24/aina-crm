/**
 * Whether the CRM may make or fill families on a firm's behalf (2026-11-23,
 * Shah Financial Services).
 *
 * An RTA file used to create a household family on its own: every guardian of a
 * minor got "<guardian> Family" with the minors placed in it (importRtaFolios,
 * step 6) — no RM, no review date, named from the registrar's text. A firm that
 * maps its families by hand finds those among its own and cannot tell which are
 * real, so the "Do not create families automatically" firm switch
 * (feature flag `noAutoFamilies`, set per firm in Aina Admin) stops every
 * automatic creation and filling. A family a person makes (New family, Map
 * clients, the suggestions panel, a Zoho import the firm asked for) is never
 * affected: this is only about what happens WITHOUT anyone asking.
 */

import { loadTenantLicense } from "@/lib/auth/license";

export const NO_AUTO_FAMILIES_FLAG = "noAutoFamilies";

/** Pure: the rule over a firm's merged feature flags. */
export function autoFamiliesAllowedFor(flags: Record<string, unknown> | null | undefined): boolean {
  return flags?.[NO_AUTO_FAMILIES_FLAG] !== true;
}

/** True unless the firm switched automatic families off. */
export async function autoFamiliesAllowed(tenantId: string): Promise<boolean> {
  const lic = await loadTenantLicense(tenantId, undefined);
  return autoFamiliesAllowedFor(lic.featureFlags);
}
