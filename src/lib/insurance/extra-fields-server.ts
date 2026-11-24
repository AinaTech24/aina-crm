import { loadTenantLicense } from "@/lib/auth/license";
import { INSURANCE_EXTRA_FIELDS_FLAG } from "./extra-fields";

/** Whether the firm has the insuranceExtraFields flag (server pages and APIs). */
export async function insuranceExtraFieldsOn(tenantId: string, roles?: string[]): Promise<boolean> {
  const license = await loadTenantLicense(tenantId, roles);
  return license.featureFlags?.[INSURANCE_EXTRA_FIELDS_FLAG] === true;
}
