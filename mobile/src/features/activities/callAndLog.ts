/**
 * startCall — arm a pending call-log intent, then open the native dialer. Use
 * this everywhere instead of a raw `Linking.openURL("tel:…")` so the app can
 * prompt to log the call when the user returns (see CallLogPrompt).
 */

import { Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { useCallIntent, type CallIntent } from "../../state/callIntent";
import { usePrefs } from "../../state/prefs";
import { simCallsAvailable } from "./simCallSync";
import { callPermissionGranted } from "./simCallSync";
import { getAccountScope } from "../../lib/accountScope";
import { toast } from "../../lib/toast";

export async function startCall(intent: Omit<CallIntent, "armedAt">) {
  const phone = (intent.phone ?? "").trim();
  if (!phone) return;
  const scope = getAccountScope();
  const auto = usePrefs.getState().autoLogCalls && simCallsAvailable && await callPermissionGranted().catch(() => false);
  if (getAccountScope().generation !== scope.generation) return;
  if (!auto) useCallIntent.getState().arm({ ...intent, phone });
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  try { await Linking.openURL(`tel:${phone.replace(/[^+\d*#]/g, "")}`); }
  catch { if (getAccountScope().generation === scope.generation) { useCallIntent.getState().clear(); toast.error("Could not open the phone dialer. Try calling from your phone app."); } }
}
