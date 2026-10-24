/** Account-bound durable writes. Attempts share one server deduplication key. */
import { create } from "zustand";
import { api, ApiError } from "../api/client";
import { storageGet, storageDelete } from "./storage";
import { bulkGet, bulkSet } from "./bulkStorage";
import { getAccountScope, onAccountChange } from "./accountScope";
import { useConnectivity } from "../state/connectivity";
import { toast } from "./toast";

const MAX = 100;
const key = (owner: string) => `offline_queue_v2.${owner}`;
let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${seq++}`;
export interface QueuedWrite {
  id: string; method: "POST" | "PATCH"; path: string; body: unknown; label: string; at: number;
  attempts: number; status: "pending" | "failed"; nextAttemptAt: number; error?: string; httpStatus?: number;
}
export function editableQueueFields(item: QueuedWrite): string[] {
  if (item.status !== "failed" || ![400, 422].includes(item.httpStatus ?? 0)) return [];
  if (item.method === "POST" && item.path === "/api/leads") return ["name", "phone", "email", "notes"];
  if (/^\/api\/leads\/[a-f\d-]+\/notes$/.test(item.path)) return ["note"];
  if (/^\/api\/activities(?:\/[a-f\d-]+)?$/.test(item.path)) return ["subject", "notes"];
  return [];
}
type Input = Pick<QueuedWrite, "method" | "path" | "body" | "label"> & { requestId?: string };
type Outcome = { value?: unknown; error?: Error };
interface QueueState {
  items: QueuedWrite[]; flushing: boolean; hydrated: boolean; legacyPending: boolean; storageError: string | null;
  hydrate: () => Promise<void>; enqueue: (w: Input) => Promise<QueuedWrite>;
  flush: () => Promise<Map<string, Outcome>>;
  reviseFields: (id: string, fields: Record<string, string>) => Promise<void>;
  retry: (id: string) => Promise<void>; discard: (id: string) => Promise<void>; clear: () => Promise<void>;
}
export function retryable(error: unknown): boolean {
  return error instanceof ApiError && (error.kind !== "http" || [408, 425, 429].includes(error.status) || error.status >= 500);
}
function supported(w: Input): boolean {
  return w.method === "POST" ? /^\/api\/(leads|activities|leads\/[a-f\d-]+\/notes)$/.test(w.path)
    : /^\/api\/(activities|tasks|investors)\/[a-f\d-]+$/.test(w.path);
}
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = writes.then(fn, fn); writes = result.catch(() => {}); return result;
}
let activeFlush: { generation: number; promise: Promise<Map<string, Outcome>> } | null = null;
export const useOfflineQueue = create<QueueState>((set, get) => {
  const update = (generation: number, change: (items: QueuedWrite[]) => QueuedWrite[]) => serial(async () => {
    const scope = getAccountScope();
    if (!scope.owner || scope.generation !== generation) throw new Error("Account changed. Sign in to the original account to sync this change.");
    const items = change(get().items);
    // AsyncStorage, not SecureStore: the queue outgrows SecureStore's 2 KB value cap.
    try { await bulkSet(key(scope.owner), JSON.stringify(items)); }
    catch { set({ storageError: "Device storage could not save your changes. Free space and try again." }); throw new Error("Unable to save offline change to device storage"); }
    if (getAccountScope().generation === generation) set({ items, storageError: null });
  });
  return {
    items: [], flushing: false, hydrated: false, legacyPending: false, storageError: null,
    hydrate: () => serial(async () => {
      const scope = getAccountScope();
      if (!scope.owner || get().hydrated) return;
      try {
        let raw = await bulkGet(key(scope.owner));
        if (raw == null) {
          // One-time move: builds before this one kept the queue in SecureStore.
          const moved = await storageGet(key(scope.owner));
          if (moved != null) { await bulkSet(key(scope.owner), moved); await storageDelete(key(scope.owner)); raw = moved; }
        }
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed) || !parsed.every((w) => w && typeof w.id === "string" && typeof w.at === "number" && supported(w) && ["pending", "failed"].includes(w.status))) throw new Error("Stored changes need recovery");
        const legacy = await storageGet("offline_queue_v1");
        if (getAccountScope().generation === scope.generation) set({ items: parsed, hydrated: true, legacyPending: !!legacy && legacy !== "[]", storageError: null });
      } catch (error) {
        if (getAccountScope().generation === scope.generation) set({ storageError: "Saved changes could not be loaded. Nothing has been deleted." });
        throw error;
      }
    }),
    enqueue: async (input) => {
      const scope = getAccountScope();
      if (!scope.owner || !supported(input)) throw new Error("This change cannot be saved offline");
      await get().hydrate();
      const { requestId, ...write } = input;
      const item: QueuedWrite = { ...write, id: requestId ?? nextId(), at: Date.now(), attempts: 0, status: "pending", nextAttemptAt: 0 };
      await update(scope.generation, (items) => {
        if (items.some(w => w.id === item.id)) return items;
        if (items.length >= MAX) throw new Error("Your sync queue is full. Sync or review existing changes before saving more.");
        return [...items, item];
      });
      return item;
    },
    flush: () => {
      const scope = getAccountScope();
      if (activeFlush?.generation === scope.generation) return activeFlush.promise;
      const promise = (async () => {
        const outcomes = new Map<string, Outcome>();
        if (!scope.owner) return outcomes;
        await get().hydrate();
        if (getAccountScope().generation !== scope.generation) return outcomes;
        set({ flushing: true });
        try {
          while (getAccountScope().generation === scope.generation) {
            const item = get().items.find((w) => w.status === "pending");
            if (!item || item.nextAttemptAt > Date.now()) break;
            let value: unknown;
            try {
              const options = { headers: { "Idempotency-Key": item.id } };
              value = item.method === "POST" ? await api.post(item.path, item.body, options) : await api.patch(item.path, item.body, options);
            } catch (error) {
              if (getAccountScope().generation !== scope.generation) break;
              const transient = retryable(error), attempts = item.attempts + 1;
              await update(scope.generation, (items) => items.map((w) => w.id !== item.id ? w : { ...w, attempts,
                status: transient ? "pending" : "failed", error: error instanceof Error ? error.message : "Sync failed", httpStatus: error instanceof ApiError ? error.status : undefined,
                nextAttemptAt: Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(attempts, 9)) }));
              outcomes.set(item.id, { error: error instanceof Error ? error : new Error("Sync failed") });
              if (transient) break;
              continue;
            }
            if (getAccountScope().generation !== scope.generation) break;
            await update(scope.generation, (items) => items.filter((w) => w.id !== item.id));
            outcomes.set(item.id, { value });
          }
        } finally { if (getAccountScope().generation === scope.generation) set({ flushing: false }); }
        return outcomes;
      })();
      activeFlush = { generation: scope.generation, promise };
      void promise.finally(() => { if (activeFlush?.promise === promise) activeFlush = null; }).catch(() => {});
      return promise;
    },
    reviseFields: async (id, fields) => {
      if (get().flushing) throw new Error("Wait for sync to finish before correcting this change.");
      await update(getAccountScope().generation, items => items.map(item => {
        if (item.id !== id) return item;
        const allowed = editableQueueFields(item);
        if (!allowed.length || !Object.keys(fields).length || Object.keys(fields).some(k => !allowed.includes(k) || typeof fields[k] !== "string")) throw new Error("This change cannot be corrected here.");
        return { ...item, id: nextId(), body: { ...(item.body as object), ...fields }, status: "pending", attempts: 0, nextAttemptAt: 0, error: undefined, httpStatus: undefined };
      }));
      await get().flush();
    },
    retry: async (id) => { await update(getAccountScope().generation, (items) => items.map((w) => w.id === id ? { ...w, status: "pending", nextAttemptAt: 0, error: undefined } : w)); await get().flush(); },
    discard: (id) => update(getAccountScope().generation, (items) => items.filter((w) => w.id !== id)),
    clear: () => update(getAccountScope().generation, () => []),
  };
});
onAccountChange(() => useOfflineQueue.setState({ items: [], flushing: false, hydrated: false, legacyPending: false, storageError: null }));

async function queuedWrite<T>(input: Input): Promise<T | null> {
  const item = await useOfflineQueue.getState().enqueue(input);
  const outcomes = await useOfflineQueue.getState().flush();
  const outcome = outcomes.get(item.id);
  if (outcome && !outcome.error) return outcome.value as T;
  if (outcome?.error && !retryable(outcome.error)) throw outcome.error;
  toast.info(`${input.label} saved on this device. View Sync to check progress.`);
  return null;
}
export const queuedPost = <T = unknown>(path: string, body: unknown, label: string) => queuedWrite<T>({ method: "POST", path, body, label });
export const queuedPatch = <T = unknown>(path: string, body: unknown, label: string) => queuedWrite<T>({ method: "PATCH", path, body, label });
export function watchConnectivityAndFlush(): () => void {
  const flush = () => { void useOfflineQueue.getState().flush().catch(() => {}); };
  const unsubscribe = useConnectivity.subscribe((state, prev) => { if (state.online && !prev.online) flush(); });
  const timer = setInterval(flush, 15_000);
  return () => { unsubscribe(); clearInterval(timer); };
}
