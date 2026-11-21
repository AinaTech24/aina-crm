/**
 * Cold start: a stored, unexpired session opens the app without waiting on the
 * network and is renewed behind it; the server's "no" still signs out; an
 * expired session is renewed before anything is shown.
 */

const mockStore = new Map<string, string>();
jest.mock("../../lib/storage", () => ({
  storageGet: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  storageSet: jest.fn(async (k: string, v: string) => { mockStore.set(k, v); }),
  storageDelete: jest.fn(async (k: string) => { mockStore.delete(k); }),
}));
jest.mock("../../api", () => ({ unregisterDevice: jest.fn(async () => {}) }));
const mockRefresh = jest.fn<Promise<string | null>, [string]>();
jest.mock("../../api/refresh", () => ({ sharedRefresh: (t: string) => mockRefresh(t) }));
jest.mock("../../api/queryPersist", () => ({ wipePersistedCache: jest.fn(async () => {}) }));
jest.mock("../recentlyViewed", () => ({ useRecentlyViewed: { getState: () => ({ clear: async () => {} }) } }));
jest.mock("../../api/queryClient", () => ({ queryClient: { clear: jest.fn() } }));

import { useSession } from "../session";
import { TOKEN_KEY } from "../../config";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (expInSec: number, userId = USER) => `h.${b64({ tenantId: TENANT, userId, exp: Math.floor(Date.now() / 1000) + expInSec })}.s`;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockStore.clear();
  mockRefresh.mockReset();
  useSession.setState({ token: null, owner: null, status: "loading" });
});

it("opens at once on an unexpired stored session, before the renewal answers", async () => {
  const saved = jwt(3600);
  mockStore.set(TOKEN_KEY, saved);
  let answer!: (v: string | null) => void;
  mockRefresh.mockReturnValue(new Promise((r) => { answer = r; }));
  await useSession.getState().hydrate();
  expect(useSession.getState().status).toBe("authed");
  expect(useSession.getState().token).toBe(saved);
  const fresh = jwt(7200);
  answer(fresh);
  await flush(); await flush();
  expect(useSession.getState().token).toBe(fresh);
  expect(mockStore.get(TOKEN_KEY)).toBe(fresh);
});

it("signs out when the server says the session is gone", async () => {
  mockStore.set(TOKEN_KEY, jwt(3600));
  mockRefresh.mockResolvedValue(null);
  await useSession.getState().hydrate();
  await flush(); await flush();
  expect(useSession.getState().status).toBe("guest");
  expect(mockStore.has(TOKEN_KEY)).toBe(false);
});

it("signs out when the renewal comes back for a different account", async () => {
  mockStore.set(TOKEN_KEY, jwt(3600));
  mockRefresh.mockResolvedValue(jwt(3600, "33333333-3333-4333-8333-333333333333"));
  await useSession.getState().hydrate();
  await flush(); await flush();
  expect(useSession.getState().status).toBe("guest");
});

it("keeps the session when offline (the token is still valid)", async () => {
  const saved = jwt(3600);
  mockStore.set(TOKEN_KEY, saved);
  mockRefresh.mockRejectedValue(new Error("network"));
  await useSession.getState().hydrate();
  await flush();
  expect(useSession.getState().status).toBe("authed");
  expect(useSession.getState().token).toBe(saved);
});

it("an expired session is renewed before anything is shown — and offline it goes to login", async () => {
  mockStore.set(TOKEN_KEY, jwt(-60));
  mockRefresh.mockRejectedValue(new Error("network"));
  await useSession.getState().hydrate();
  expect(useSession.getState().status).toBe("guest");

  const fresh = jwt(3600);
  mockStore.set(TOKEN_KEY, jwt(-60));
  mockRefresh.mockResolvedValue(fresh);
  await useSession.getState().hydrate();
  expect(useSession.getState().status).toBe("authed");
  expect(useSession.getState().token).toBe(fresh);
});

it("no stored session → login", async () => {
  await useSession.getState().hydrate();
  expect(useSession.getState().status).toBe("guest");
  expect(mockRefresh).not.toHaveBeenCalled();
});
