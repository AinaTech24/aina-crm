import { AppState, PermissionsAndroid, Platform } from "react-native";
import Constants from "expo-constants";
import callLog, { type SimCall } from "../../../modules/aina-call-log";
import { api } from "../../api/client";
import { getAccountScope } from "../../lib/accountScope";
import { storageGet, storageSet } from "../../lib/storage";
import { usePrefs } from "../../state/prefs";
import { useOfflineQueue } from "../../lib/offlineQueue";
import { queryClient } from "../../api/queryClient";
import { callBody, indexContacts, matchIndexed, type CallContact } from "./callMatching";

/** False in the Play Store build, which ships without READ_CALL_LOG (app.config.ts). */
const callLogEnabled = Constants.expoConfig?.extra?.callLogEnabled !== false;
export const simCallsAvailable = Platform.OS === "android" && !!callLog && callLogEnabled;

// The contact index is the whole book in scope (firm-wide for owners — easily
// thousands of rows). It is fetched only when there are new calls to match,
// reused for 10 minutes, and refreshed once whenever a call misses against a
// cached copy — otherwise a lead created a minute ago and then called would
// never match, because the sync position moves past that call for good.
const CONTACTS_TTL_MS = 10 * 60_000;
let contactCache: { owner: string; generation: number; at: number; index: Map<string, CallContact[]> } | null = null;
async function contactIndex(owner: string, generation: number, fresh: boolean) {
  const c = contactCache;
  if (!fresh && c && c.owner === owner && c.generation === generation && Date.now() - c.at < CONTACTS_TTL_MS) {
    return { index: c.index, fetched: false };
  }
  const { contacts } = await api.get<{ contacts: CallContact[] }>("/api/mobile/call-contacts");
  const index = indexContacts(contacts);
  contactCache = { owner, generation, at: Date.now(), index };
  return { index, fetched: true };
}
const RELEVANT_TYPES = [1, 2, 3, 5]; // incoming, outgoing, missed, rejected
export async function enableSimCalls(): Promise<boolean> {
  if (!simCallsAvailable) {
    throw new Error(callLogEnabled ? "SIM call import requires the Android APK." : "SIM call import isn't available in this version of the app.");
  }
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG, {
    title: "Log CRM calls", message: "Aina CRM reads call metadata on this phone to match your CRM leads and clients. Only matching calls are sent to your firm. Audio is not recorded. You can turn this off anytime.",
    buttonPositive: "Allow", buttonNegative: "Not now",
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
  const owner = getAccountScope().owner;
  if (!owner) return false;
  await storageSet(`sim_since.${owner}`, String(Date.now()));
  usePrefs.getState().set("autoLogCalls", true);
  return true;
}
let syncing = false;
export async function syncSimCalls() {
  const scope = getAccountScope();
  if (syncing || !scope.owner || !usePrefs.getState().autoLogCalls || !simCallsAvailable) return;
  const current = () => getAccountScope().generation === scope.generation && usePrefs.getState().autoLogCalls;
  syncing = true;
  try {
    if (!await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG)) return;
    const key = `sim_since.${scope.owner}`;
    const saved = await storageGet(key);
    // New users explicitly opt in; never import pre-consent history.
    if (!saved) return;
    const since = Number(saved);
    if (!Number.isFinite(since)) throw new Error("Invalid call sync position");
    const until = Date.now() - 15_000; // allow Android to finish writing the call
    if (until <= since) return;
    const calls = await callLog!.readCalls(since, until);
    const relevant = calls.filter((c) => RELEVANT_TYPES.includes(c.type));
    const matched: { call: SimCall; contact: CallContact }[] = [];
    if (relevant.length > 0) {
      let { index, fetched } = await contactIndex(scope.owner, scope.generation, false);
      if (!current()) return;
      let unmatched = relevant.filter((call) => {
        const contact = matchIndexed(call, index);
        if (contact) matched.push({ call, contact });
        return !contact;
      });
      if (unmatched.length > 0 && !fetched) {
        ({ index } = await contactIndex(scope.owner, scope.generation, true));
        if (!current()) return;
        unmatched = unmatched.filter((call) => {
          const contact = matchIndexed(call, index);
          if (contact) matched.push({ call, contact });
          return !contact;
        });
      }
      matched.sort((a, b) => a.call.date - b.call.date);
    }
    let device = await storageGet("sim_device_id");
    if (!device) { device = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; await storageSet("sim_device_id", device); }
    for (const { call, contact } of matched) {
      if (!current()) return;
      await useOfflineQueue.getState().enqueue({ method: "POST", path: "/api/activities", body: callBody(call, contact), label: "SIM call",
        requestId: `sim_${device}_${call.id}_${Math.trunc(call.date)}` });
      await useOfflineQueue.getState().flush();
    }
    if (!current()) return;
    // Inclusive replay at the page boundary is safe because call IDs are stable.
    await storageSet(key, String(calls.length >= 5000 ? calls[calls.length - 1].date : until));
    // Only when something was logged — this runs every 30s, and an unconditional
    // invalidation made the Activities list refetch on every tick.
    if (matched.length > 0) queryClient.invalidateQueries({ queryKey: ["activities"] });
  } finally { syncing = false; }
}
export function watchSimCalls() {
  const run = () => { void syncSimCalls().catch(() => {}); };
  const sub = AppState.addEventListener("change", state => { if (state === "active") run(); });
  const timer = setInterval(() => { if (AppState.currentState === "active") run(); }, 30_000);
  run();
  return () => { sub.remove(); clearInterval(timer); };
}
