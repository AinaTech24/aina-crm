import React, { useEffect, useState } from "react";
import { AppState, Linking, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { Card, Text, Button } from "../../components/ui";
import { usePrefs } from "../../state/prefs";
import { useOfflineQueue } from "../../lib/offlineQueue";
import { callPermissionGranted, enableSimCalls, simCallsAvailable, syncSimCalls, useCallSyncStatus } from "./simCallSync";
import { toast } from "../../lib/toast";
import { errorMessage } from "../../lib/errors";
import { spacing } from "../../theme/tokens";

export function CallLoggingCard() {
  const enabled = usePrefs(s => s.autoLogCalls);
  const status = useCallSyncStatus();
  const items = useOfflineQueue(s => s.items);
  const queued = items.filter(item => item.label === "SIM call");
  const [permission, setPermission] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const check = () => { void callPermissionGranted().then(ok => { if (active) setPermission(ok); }).catch(() => { if (active) setPermission(false); }); };
    check();
    const sub = AppState.addEventListener("change", state => { if (state === "active") check(); });
    return () => { active = false; sub.remove(); };
  }, [enabled]);
  const enable = async () => {
    setEnabling(true);
    try {
      if (await enableSimCalls()) { setPermission(true); toast.success("Automatic CRM call logging enabled from now"); }
      else toast.info("Permission was not granted. Manual call logging is available.");
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setEnabling(false); }
  };
  const title = !simCallsAvailable ? "Manual call logging" : !enabled ? "Automatic call logging is off" : permission === false ? "Call permission needs attention" : "Automatic CRM call logging";
  return <Card flat>
    <Text variant="subtitle">{title}</Text>
    <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
      {!simCallsAvailable ? "Calls started from Aina CRM prompt for a manual log when you return. This build does not support Android call-log import." : enabled ? "Matching incoming, outgoing, missed and rejected calls sync while Aina CRM is open or when you return." : "Enable Android call-log access to capture CRM calls, including calls made outside Aina CRM. You can turn it off in Preferences."}
    </Text>
    {enabled ? <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Last check: {status.checkedAt ? new Date(status.checkedAt).toLocaleString("en-IN") : "Not yet checked"}{status.checkedAt ? ` · ${status.matched} new calls saved or queued` : ""}</Text> : null}
    {queued.length ? <Button label={`${queued.length} call${queued.length === 1 ? "" : "s"} awaiting sync or review`} variant="ghost" onPress={() => router.push("/sync" as any)} /> : null}
    {status.error ? <Text variant="caption" tone="danger" style={{ marginTop: spacing.sm }}>{status.error}</Text> : null}
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      {simCallsAvailable && !enabled ? <Button label="Enable automatic logging" loading={enabling} onPress={enable} /> : null}
      {enabled && simCallsAvailable && permission !== false ? <Button label="Sync phone calls" variant="secondary" loading={status.busy} onPress={() => syncSimCalls().catch(e => toast.error(errorMessage(e)))} /> : null}
      {enabled && permission === false && Platform.OS !== "web" ? <Button label="Allow call-log access in phone settings" variant="secondary" onPress={() => Linking.openSettings()} /> : null}
    </View>
    <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>For a discussion summary, open a logged call and choose its participant-consented recording. Hindi and Gujarati speech can be summarized in English.</Text>
  </Card>;
}
