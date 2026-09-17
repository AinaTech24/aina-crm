/**
 * Persist the TanStack Query cache to disk so a cold start (or an app-lock
 * unlock) paints Home / client lists instantly from the last good data and
 * refreshes in the background — instead of a wall of skeletons. It also makes
 * the app *readable* with no signal at all.
 *
 * Sensitive by nature (client names, AUM), so the cache is cleared on sign-out
 * (see the root layout) and never outlives MAX_AGE. AsyncStorage, not
 * SecureStore: the keychain caps entries at ~2 KB and this is megabytes.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

/** Structural, not the `Query` class: the persist package ships its own copy of
 *  query-core, and its `Query` (with a #private field) isn't nominally
 *  assignable to react-query's. We only read two public fields anyway. */
type PersistableQuery = { state: { status: string }; queryKey: readonly unknown[] };

export const CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

/** Query families that must never be restored from disk. */
const NEVER_PERSIST = new Set<string>([
  "search",       // typed-ahead results — stale and large
  "notifications" // must reflect the server, not a snapshot
]);

export const createQueryPersister = (owner: string) => createAsyncStoragePersister({
  storage: AsyncStorage,
  key: `aina-rq-cache-v2.${owner}`,
  throttleTime: 1000,
});

export function shouldPersistQuery(q: PersistableQuery): boolean {
  if (q.state.status !== "success") return false;
  const head = q.queryKey[0];
  return typeof head === "string" ? !NEVER_PERSIST.has(head) : true;
}

export async function wipePersistedCache(owner?: string): Promise<void> {
  try {
    if (owner) await createQueryPersister(owner).removeClient();
    await AsyncStorage.removeItem("aina-rq-cache-v1");
  } catch {
    /* best-effort */
  }
}
