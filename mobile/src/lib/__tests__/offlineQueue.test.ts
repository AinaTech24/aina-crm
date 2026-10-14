jest.mock("../../api/client", () => {
  // Plain field assignments, NOT TypeScript parameter properties. Babel's TS
  // transform rewrites `constructor(public status: number, ...)` into helper
  // calls, and babel-plugin-jest-hoist then rejects the factory for referencing
  // identifiers it cannot resolve ("not allowed to reference any out-of-scope
  // variables"). Same runtime shape, no transform.
  class ApiError extends Error {
    status: number;
    body?: unknown;
    kind: string;
    constructor(status: number, message: string, body?: unknown, kind = "http") {
      super(message);
      this.status = status;
      this.body = body;
      this.kind = kind;
    }
  }
  return { api: { post: jest.fn(), patch: jest.fn() }, ApiError };
});
jest.mock("../storage", () => ({ storageGet: jest.fn(), storageSet: jest.fn(), storageDelete: jest.fn() }));
jest.mock("../bulkStorage", () => ({ bulkGet: jest.fn(), bulkSet: jest.fn(), bulkDelete: jest.fn() }));
jest.mock("../toast", () => ({ toast: { info: jest.fn(), success: jest.fn() } }));
import { api, ApiError } from "../../api/client";
import { storageGet, storageDelete } from "../storage";
import { bulkGet, bulkSet } from "../bulkStorage";
import { setAccountScope } from "../accountScope";
import { useOfflineQueue, queuedPost } from "../offlineQueue";

const secure = new Map<string, string>(); // SecureStore
const disk = new Map<string, string>();   // bulk (AsyncStorage)
const post = jest.mocked(api.post);
const store = jest.mocked(bulkSet);
const queue = () => useOfflineQueue.getState();
const input = { method: "POST" as const, path: "/api/activities", body: { notes: "A call" }, label: "Call log" };
beforeEach(() => {
  jest.clearAllMocks(); disk.clear(); secure.clear(); setAccountScope(null); setAccountScope("tenant.user-a");
  jest.mocked(storageGet).mockImplementation(async (key) => secure.get(key) ?? null);
  jest.mocked(storageDelete).mockImplementation(async (key) => { secure.delete(key); });
  jest.mocked(bulkGet).mockImplementation(async (key) => disk.get(key) ?? null);
  store.mockImplementation(async (key, value) => { disk.set(key, value); });
  post.mockResolvedValue({ id: "saved" });
});

test("correcting a validation rejection creates a new request identity and preserves the original subject", async () => {
  post.mockRejectedValueOnce(new ApiError(400, "Invalid notes"));
  await expect(queuedPost(input.path, { subject_id: "original", notes: "Bad" }, input.label)).rejects.toThrow();
  const item = queue().items[0];
  expect(item.httpStatus).toBe(400);
  await queue().reviseFields(item.id, { notes: "Corrected" });
  expect(post.mock.calls[1][1]).toEqual({ subject_id: "original", notes: "Corrected" });
  expect(post.mock.calls[1][2]).not.toEqual(post.mock.calls[0][2]);
  expect(queue().items).toHaveLength(0);
});

test("does not let correction change assignment or retry an uncertain write as a new request", async () => {
  post.mockRejectedValueOnce(new ApiError(400, "Invalid notes"));
  await expect(queuedPost(input.path, input.body, input.label)).rejects.toThrow();
  const item = queue().items[0];
  await expect(queue().reviseFields(item.id, { owner_user_id: "someone-else" })).rejects.toThrow();
  post.mockRejectedValueOnce(new ApiError(503, "Try later"));
  await queuedPost(input.path, input.body, input.label);
  const pending = queue().items.find(w => w.status === "pending")!;
  await expect(queue().reviseFields(pending.id, { notes: "Changed" })).rejects.toThrow();
});
test.each([429, 503])("retains HTTP %s and reuses its request key", async (status) => {
  post.mockRejectedValueOnce(new ApiError(status, "Try later"));
  await expect(queuedPost(input.path, input.body, input.label)).resolves.toBeNull();
  expect(queue().items).toHaveLength(1);
  const item = queue().items[0];
  expect(item.status).toBe("pending");
  await queue().retry(item.id);
  expect(queue().items).toHaveLength(0);
  expect(post.mock.calls[0][2]).toEqual(post.mock.calls[1][2]);
});
test("acknowledgement preserves concurrently enqueued writes", async () => {
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => { started = resolve; });
  post.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
  await queue().enqueue(input);
  const flushing = queue().flush();
  await sending;
  const second = await queue().enqueue({ ...input, body: { notes: "Second" } });
  post.mockRejectedValueOnce(new ApiError(503, "Unavailable"));
  finish({ id: "first" }); await flushing;
  expect(queue().items.map((w) => w.id)).toEqual([second.id]);
  expect(JSON.parse(disk.get("offline_queue_v2.tenant.user-a")!)).toHaveLength(1);
});
test("a late response cannot remove or replay another account's queue", async () => {
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => { started = resolve; });
  post.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
  const old = await queue().enqueue(input);
  const flushing = queue().flush(); await sending;
  setAccountScope("tenant.user-b"); await queue().hydrate();
  expect(queue().items).toHaveLength(0);
  finish({ id: "saved" }); await flushing;
  expect(queue().items).toHaveLength(0);
  expect(post).toHaveBeenCalledTimes(1);
  setAccountScope("tenant.user-a"); await queue().hydrate();
  expect(queue().items[0].id).toBe(old.id);
});
test("a rejected write remains visible for review", async () => {
  post.mockRejectedValueOnce(new ApiError(403, "No access"));
  await expect(queuedPost(input.path, input.body, input.label)).rejects.toThrow("No access");
  expect(queue().items[0].status).toBe("failed");
  await queue().flush(); expect(post).toHaveBeenCalledTimes(1);
});
test("storage failure never reports a successful save or sends the write", async () => {
  store.mockRejectedValueOnce(new Error("Disk full"));
  await expect(queuedPost(input.path, input.body, input.label)).rejects.toThrow("device storage");
  expect(queue().items).toHaveLength(0); expect(post).not.toHaveBeenCalled();
});
test("capacity rejects new work without dropping old work", async () => {
  for (let n = 0; n < 100; n++) await queue().enqueue(input);
  const first = queue().items[0].id;
  await expect(queue().enqueue(input)).rejects.toThrow("full");
  expect(queue().items).toHaveLength(100); expect(queue().items[0].id).toBe(first);
});
test("legacy writes remain quarantined without exposing their records", async () => {
  secure.set("offline_queue_v1", JSON.stringify([{ ...input, label: "Other client" }]));
  await queue().hydrate(); await queue().flush();
  expect(queue().legacyPending).toBe(true); expect(queue().items).toEqual([]);
  expect(post).not.toHaveBeenCalled(); expect(secure.has("offline_queue_v1")).toBe(true);
});
test("offline lead creation retains its request ID across retries", async () => {
  post.mockRejectedValueOnce(new ApiError(0, "Offline", undefined, "network"));
  await expect(queuedPost("/api/leads", { name: "New prospect" }, "Lead")).resolves.toBeNull();
  const item = queue().items[0];
  await queue().retry(item.id);
  expect(post.mock.calls[0][2]).toEqual(post.mock.calls[1][2]);
});
test("re-reading the same SIM call does not duplicate the pending queue", async () => {
  await queue().enqueue({ ...input, requestId: "sim_device_1_1700000000" });
  await queue().enqueue({ ...input, requestId: "sim_device_1_1700000000" });
  expect(queue().items).toHaveLength(1);
});
test("a queue saved to SecureStore by an older build moves to bulk storage intact", async () => {
  const saved = [{ ...input, id: "w1", at: 1, attempts: 0, status: "pending", nextAttemptAt: 0 }];
  secure.set("offline_queue_v2.tenant.user-a", JSON.stringify(saved));
  await queue().hydrate();
  expect(queue().items.map((w) => w.id)).toEqual(["w1"]);
  expect(JSON.parse(disk.get("offline_queue_v2.tenant.user-a")!)).toHaveLength(1);
  expect(secure.has("offline_queue_v2.tenant.user-a")).toBe(false);
});
test("a large queue is written whole, not truncated at SecureStore's 2 KB cap", async () => {
  const notes = "x".repeat(900);
  for (let n = 0; n < 5; n++) await queue().enqueue({ ...input, body: { notes } });
  const written = disk.get("offline_queue_v2.tenant.user-a")!;
  expect(written.length).toBeGreaterThan(2048);
  expect(JSON.parse(written)).toHaveLength(5);
});
