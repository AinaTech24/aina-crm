import { AppState, PermissionsAndroid, Platform } from "react-native";
import Constants from "expo-constants";
import callLog, { type SimCall } from "../../../modules/aina-call-log";
import { api } from "../../api/client";
import { create } from "zustand";
import { getAccountScope, onAccountChange } from "../../lib/accountScope";
import { storageGet, storageSet } from "../../lib/storage";
import { bulkGet, bulkSet } from "../../lib/bulkStorage";
import { usePrefs } from "../../state/prefs";
import { useOfflineQueue } from "../../lib/offlineQueue";
import { queryClient } from "../../api/queryClient";
import { callBody, indexContacts, matchIndexed, type CallContact } from "./callMatching";
import { advanceCallImport, callIdentity, callReadFrom, parseCallImportState } from "./callImportState";

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
  const scope = getAccountScope();
  if (!scope.owner) throw new Error("Sign in before enabling call logging.");
  if (!simCallsAvailable) {
    throw new Error(callLogEnabled ? "SIM call import requires the Android APK." : "SIM call import isn't available in this version of the app.");
  }
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG, {
    title: "Log CRM calls", message: "Aina CRM reads call metadata on this phone to match your CRM leads and clients. Only matching calls are sent to your firm. Audio is not recorded. You can turn this off anytime.",
    buttonPositive: "Allow", buttonNegative: "Not now",
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
  if (getAccountScope().generation !== scope.generation) throw new Error("Account changed. Enable logging for the signed-in account.");
  const optedInAt = Date.now();
  await bulkSet(`sim_import_v2.${scope.owner}`, JSON.stringify({ cursor: optedInAt, seen: {} }));
  await storageSet(`sim_since.${scope.owner}`, String(optedInAt));
  await storageSet(`sim_opted_in.${scope.owner}`, String(optedInAt));
  if (getAccountScope().generation !== scope.generation) return false;
  await storageSet(`sim_enabled.${scope.owner}`, "true");
  if (getAccountScope().generation !== scope.generation) return false;
  usePrefs.getState().set("autoLogCalls", true);
  return true;
}
export const useCallSyncStatus = create<{ checkedAt: number | null; matched: number; skipped: number; error: string | null; busy: boolean }>(() => ({ checkedAt: null, matched: 0, skipped: 0, error: null, busy: false }));
onAccountChange(() => { contactCache = null; useCallSyncStatus.setState({ checkedAt: null, matched: 0, skipped: 0, error: null, busy: false }); });
export async function callPermissionGranted() { return simCallsAvailable && await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG); }
let syncing = false;
export async function syncSimCalls() {
  const scope = getAccountScope();
  if (syncing || !scope.owner || !usePrefs.getState().autoLogCalls || !simCallsAvailable) return;
  const sameAccount = () => getAccountScope().generation === scope.generation;
  const current = () => sameAccount() && usePrefs.getState().autoLogCalls;
  syncing = true;
  useCallSyncStatus.setState({ busy: true, error: null });
  try {
    if (!await callPermissionGranted()) throw new Error("Call-log permission is blocked. Enable it in phone settings, or turn automatic logging off.");
    const key = `sim_since.${scope.owner}`;
    const saved = await storageGet(key);
    // New users explicitly opt in; never import pre-consent history.
    if (!saved) throw new Error("Turn automatic logging off and on to start a new sync session.");
    const cursor = Number(saved);
    if (!Number.isFinite(cursor) || cursor < 0) throw new Error("Invalid call sync position");
    const stateKey = `sim_import_v2.${scope.owner}`;
    const state = parseCallImportState(await bulkGet(stateKey), cursor);
    // An older build did not keep the opt-in time. Its last cursor is the safe
    // lower boundary: never reach into unconfirmed pre-consent history.
    const savedOptIn = await storageGet(`sim_opted_in.${scope.owner}`);
    const optedInAt = Number(savedOptIn ?? cursor);
    if (!Number.isFinite(optedInAt) || optedInAt < 0) throw new Error("Invalid call-logging consent position");
    if (!current()) return;
    if (savedOptIn === null) await storageSet(`sim_opted_in.${scope.owner}`, String(optedInAt));
    const since = callReadFrom(state, optedInAt);
    const until = Date.now() - 15_000; // allow Android to finish writing the call
    if (until <= since) { useCallSyncStatus.setState({ checkedAt: Date.now(), matched: 0, skipped: 0 }); return; }
    const calls = await callLog!.readCalls(since, until);
    if (calls.length >= 5000 && calls[calls.length - 1].date <= since) throw new Error("Android returned too many calls at the same time. Call history needs manual review; the sync position has been preserved.");
    if (!current()) return;
    const relevant = calls.filter((c) => RELEVANT_TYPES.includes(c.type) && !(callIdentity(c) in state.seen));
    const matched: { call: SimCall; contact: CallContact }[] = [];
    if (relevant.length > 0) {
      let { index, fetched } = await contactIndex(scope.owner, scope.generation, false);
      if (!current()) return;
      let unmatched = relevant.filter((call) => {
        const contact = matchIndexed(call, index);
        if (contact) matched.push({ call, contact });
        return !contact;
      });
      if (unmatched.length > 0 && !fetched && Date.now() - (contactCache?.at ?? 0) >= 60_000) {
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
      if (!current()) return;
      // Mark only AFTER the queue has durably stored the call. Queue failures
      // leave the cursor unchanged, allowing the next check to retry safely.
      state.seen[callIdentity(call)] = call.date;
      await bulkSet(stateKey, JSON.stringify(state));
      if (!current()) return;
      if (useOfflineQueue.getState().items.length >= 80) await useOfflineQueue.getState().flush();
    }
    if (!current()) return;
    // Inclusive replay at the page boundary is safe because call IDs are stable.
    const advanced = advanceCallImport(state, until, calls);
    // Keep the old cursor for backwards-compatible installs; the durable v2
    // state is authoritative for this version.
    await bulkSet(stateKey, JSON.stringify(advanced));
    if (!current()) return;
    await storageSet(key, String(advanced.cursor));
    if (!current()) return;
    // Only when something was logged — this runs every 30s, and an unconditional
    // invalidation made the Activities list refetch on every tick.
    useCallSyncStatus.setState({ checkedAt: Date.now(), matched: matched.length, skipped: relevant.length - matched.length, error: null });
    if (matched.length > 0) queryClient.invalidateQueries({ queryKey: ["activities"] });
    await useOfflineQueue.getState().flush();
  } catch (error) { if (current()) useCallSyncStatus.setState({ error: error instanceof Error ? error.message : "Call sync failed" }); throw error; } finally { syncing = false; if (sameAccount()) useCallSyncStatus.setState({ busy: false }); }
}
export function watchSimCalls() {
  const run = () => { void syncSimCalls().catch(() => {}); };
  const sub = AppState.addEventListener("change", state => { if (state === "active") run(); });
  const timer = setInterval(() => { if (AppState.currentState === "active") run(); }, 30_000);
  run();
  return () => { sub.remove(); clearInterval(timer); };
}
