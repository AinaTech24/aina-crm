/**
 * Session store (Zustand). The single source of truth for "are we logged in".
 * Holds the JWT, persists it in the device keychain, and exposes signIn/signOut.
 *
 * Importable outside React (`useSession.getState()`) so the API client can read
 * the token and force a sign-out on an unrecoverable 401 without prop-drilling.
 */

import { create } from "zustand";
import { storageGet, storageSet, storageDelete } from "../lib/storage";
import { TOKEN_KEY, PUSH_TOKEN_KEY } from "../config";
import { refreshToken, unregisterDevice } from "../api";
import { useRecentlyViewed } from "./recentlyViewed";
import { accountFromToken, setAccountScope } from "../lib/accountScope";
import { queryClient } from "../api/queryClient";
import { wipePersistedCache } from "../api/queryPersist";
import { isUnexpiredSession } from "../lib/offlineSession";
import { useConnectivity } from "./connectivity";

type Status = "loading" | "authed" | "guest";

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
      let fresh: string | null;
      try { fresh = await refreshToken(saved); }
      catch {
        if (!isUnexpiredSession(saved)) throw new Error("Reconnect to renew your session");
        fresh = saved;
        useConnectivity.getState().setOnline(false);
      }
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
