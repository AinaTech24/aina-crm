/**
 * Session store (Zustand). The single source of truth for "are we logged in".
 * Holds the JWT, persists it in the device keychain, and exposes signIn/signOut.
 *
 * Importable outside React (`useSession.getState()`) so the API client can read
 * the token and force a sign-out on an unrecoverable 401 without prop-drilling.
 *
 * Cold start never waits on the network when it doesn't have to: a stored,
 * UNEXPIRED session opens the app at once (the screens paint from the query
 * cache saved on this phone, scoped to the same account) and is renewed in the
 * background. If the server says the session is gone, that renewal signs out
 * → login. Only an EXPIRED stored session must be renewed before anything is
 * shown. Offline with an unexpired session is the same rule as before: the app
 * opens, read-only data from the saved copy, writes queue.
 */

import { create } from "zustand";
import { storageGet, storageSet, storageDelete } from "../lib/storage";
import { TOKEN_KEY, PUSH_TOKEN_KEY } from "../config";
import { unregisterDevice } from "../api";
import { sharedRefresh } from "../api/refresh";
import { useRecentlyViewed } from "./recentlyViewed";
import { accountFromToken, setAccountScope } from "../lib/accountScope";
import { queryClient } from "../api/queryClient";
import { wipePersistedCache } from "../api/queryPersist";
import { isUnexpiredSession } from "../lib/offlineSession";
import { useConnectivity } from "./connectivity";

type Status = "loading" | "authed" | "guest";

/** Set by signIn(), read once by the first tenant-brand load (settings/api.ts):
 *  a fresh sign-in may need one bundle reload to carry the firm's colour. Only
 *  within 15 s of signing in (the brand normally loads in under a second) —
 *  never a reload under someone half-way through a form on a slow network. */
let signedInAt = 0;
export function consumeFreshSignIn(): boolean {
  const ok = signedInAt > 0 && Date.now() - signedInAt < 15_000;
  signedInAt = 0;
  return ok;
}

/** Renew a session the app has ALREADY opened on. Network trouble keeps it
 *  (the token is unexpired; the API client renews on its first 401); a server
 *  "no" signs out; a renewal for an account no longer on screen is dropped. */
async function renewInBackground(saved: string, owner: string): Promise<void> {
  let fresh: string | null;
  try {
    fresh = await sharedRefresh(saved);
  } catch {
    useConnectivity.getState().setOnline(false);
    return;
  }
  const s = useSession.getState();
  if (s.status !== "authed" || s.owner !== owner) return;
  let sameAccount = false;
  try { sameAccount = !!fresh && accountFromToken(fresh) === owner; } catch { sameAccount = false; }
  if (!fresh || !sameAccount) { await s.signOut(); return; }
  // The API client may already have renewed it (a 401 raced us) — keep the newer.
  if (s.token === saved) await s.setToken(fresh);
}

interface SessionState {
  token: string | null;
  owner: string | null;
  status: Status;
  /** Cold-start: read keychain, refresh once; sets status. Call from root layout. */
  hydrate: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Swap in a freshly-refreshed token (called by the API client interceptor). */
  setToken: (token: string) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  token: null,
  owner: null,
  status: "loading",

  hydrate: async () => {
    queryClient.clear();
    await wipePersistedCache();
    await useRecentlyViewed.getState().clear();
    try {
      const saved = await storageGet(TOKEN_KEY);
      if (!saved) { setAccountScope(null); return set({ status: "guest", token: null, owner: null }); }
      if (isUnexpiredSession(saved)) {
        // Fast start: open now on the saved session; renew behind the first paint.
        const owner = accountFromToken(saved);
        setAccountScope(owner);
        set({ token: saved, owner, status: "authed" });
        void renewInBackground(saved, owner);
        return;
      }
      // Expired: nothing is shown until the server renews it.
      const fresh = await sharedRefresh(saved);
      if (fresh) {
        const owner = accountFromToken(fresh);
        if (owner !== accountFromToken(saved)) throw new Error("Account changed during refresh");
        await storageSet(TOKEN_KEY, fresh);
        setAccountScope(owner);
        set({ token: fresh, owner, status: "authed" });
      } else {
        await storageDelete(TOKEN_KEY);
        setAccountScope(null);
        set({ token: null, owner: null, status: "guest" });
      }
    } catch {
      setAccountScope(null);
      set({ token: null, owner: null, status: "guest" });
    }
  },

  signIn: async (token) => {
    const owner = accountFromToken(token);
    signedInAt = Date.now();
    queryClient.clear();
    await useRecentlyViewed.getState().clear();
    await storageSet(TOKEN_KEY, token);
    setAccountScope(owner);
    set({ token, owner, status: "authed" });
  },

  setToken: async (token) => {
    if (get().status !== "authed" || accountFromToken(token) !== get().owner) return;
    await storageSet(TOKEN_KEY, token);
    set({ token });
  },

  signOut: async () => {
    const owner = get().owner;
    const oldToken = get().token;
    setAccountScope(null);
    queryClient.clear();
    set({ token: null, owner: null, status: "guest" });
    try {
      const [sessionToken, pushToken] = await Promise.all([
        Promise.resolve(oldToken),
        storageGet(PUSH_TOKEN_KEY),
      ]);
      if (sessionToken && pushToken) await unregisterDevice(sessionToken, pushToken);
    } catch {
      /* best-effort */
    }
    await storageDelete(PUSH_TOKEN_KEY);
    await storageDelete(TOKEN_KEY);
    // Client names cached for the Home rail are PII — they must not outlive the
    // session (or greet the next user to sign in on this device).
    await useRecentlyViewed.getState().clear();
    if (owner) await wipePersistedCache(owner);
  },
}));
