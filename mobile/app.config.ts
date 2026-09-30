/**
 * Layered over app.json (which stays the source of truth). The only job here is
 * the Play Store variant:
 *
 *   AINA_STORE_BUILD=1  (set by the `production` profile in eas.json — the AAB
 *                        that goes to Google Play)
 *
 * READ_CALL_LOG is a Google Play *restricted* permission, reserved for default
 * dialer / SMS apps; a CRM declaring it is routinely rejected. So the store
 * build removes it — including the copy the local aina-call-log module merges
 * into the manifest (blockedPermissions emits tools:node="remove") — and tells
 * the JS the feature is off (extra.callLogEnabled), which hides SIM call sync.
 * The sideloaded APK (`preview`) keeps it.
 */

import type { ConfigContext, ExpoConfig } from "expo/config";

const CALL_LOG = "android.permission.READ_CALL_LOG";

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (process.env.AINA_STORE_BUILD !== "1") return base;

  return {
    ...base,
    android: {
      ...base.android,
      permissions: (base.android?.permissions ?? []).filter((p) => p !== CALL_LOG),
      blockedPermissions: [...(base.android?.blockedPermissions ?? []), CALL_LOG],
    },
    extra: { ...base.extra, callLogEnabled: false },
  };
};
