const mockDisk = new Map<string, string>();
const mockRead = jest.fn(), mockContacts = jest.fn(), mockEnqueue = jest.fn(), mockFlush = jest.fn();
let mockEnabled = true;
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return new Proxy(actual, { get(target, key) {
    if (key === "Platform") return { ...actual.Platform, OS: "android" };
    if (key === "PermissionsAndroid") return { PERMISSIONS: { READ_CALL_LOG: "calls" }, check: jest.fn(async () => true) };
    return Reflect.get(target, key);
  } });
});
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { callLogEnabled: true } } } }));
jest.mock("../../../../modules/aina-call-log", () => ({ __esModule: true, default: { readCalls: (...args: unknown[]) => mockRead(...args) } }));
jest.mock("../../../api/client", () => ({ api: { get: (...args: unknown[]) => mockContacts(...args) } }));
jest.mock("../../../api/queryClient", () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock("../../../lib/storage", () => ({ storageGet: async (key: string) => mockDisk.get(key) ?? null, storageSet: async (key: string, value: string) => { mockDisk.set(key, value); } }));
jest.mock("../../../lib/bulkStorage", () => ({ bulkGet: async (key: string) => mockDisk.get(key) ?? null, bulkSet: async (key: string, value: string) => { mockDisk.set(key, value); } }));
jest.mock("../../../state/prefs", () => ({ usePrefs: { getState: () => ({ autoLogCalls: mockEnabled }) } }));
jest.mock("../../../lib/offlineQueue", () => ({ useOfflineQueue: { getState: () => ({ enqueue: mockEnqueue, flush: mockFlush, items: [] }) } }));
import { setAccountScope } from "../../../lib/accountScope";
import { syncSimCalls, useCallSyncStatus } from "../simCallSync";
const owner = "tenant.user", now = 1800000000000;
const call = { id: "1", date: now - 120000, duration: 65, type: 2, number: "9876543210" };
const contact = { id: "client-a", phone: "+919876543210", name: "Client", subjectType: "investor" };
beforeEach(() => {
  jest.clearAllMocks(); mockDisk.clear(); mockEnabled = true;
  jest.spyOn(Date, "now").mockReturnValue(now);
  setAccountScope(null); setAccountScope(owner);
  mockDisk.set(`sim_since.${owner}`, String(now - 3600000));
  mockDisk.set(`sim_opted_in.${owner}`, String(now - 3600000)); mockDisk.set("sim_device_id", "device");
  mockContacts.mockResolvedValue({ contacts: [contact] }); mockEnqueue.mockResolvedValue({}); mockFlush.mockResolvedValue(new Map());
  mockRead.mockImplementation(async (since: number, until: number) => call.date >= since && call.date < until ? [call] : []);
});
afterEach(() => jest.restoreAllMocks());
test("imports a call written late after the cursor moved past its start, only once", async () => {
  mockRead.mockResolvedValueOnce([]);
  await syncSimCalls();
  expect(Number(mockDisk.get(`sim_since.${owner}`))).toBeGreaterThan(call.date);
  await syncSimCalls(); await syncSimCalls();
  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  expect(mockEnqueue.mock.calls[0][0]).toMatchObject({ requestId: "sim_device_1_1799999880000", body: { durationSec: 65, direction: "outbound", status: "answered" } });
});
test("does not advance the cursor or mark imported when durable enqueue fails", async () => {
  mockEnqueue.mockRejectedValueOnce(new Error("Queue full"));
  await expect(syncSimCalls()).rejects.toThrow("Queue full");
  expect(mockDisk.get(`sim_since.${owner}`)).toBe(String(now - 3600000));
  expect(mockDisk.get(`sim_import_v2.${owner}`)).toBeUndefined();
  await syncSimCalls(); expect(mockEnqueue).toHaveBeenCalledTimes(2);
  expect(mockEnqueue.mock.calls[0][0].requestId).toBe(mockEnqueue.mock.calls[1][0].requestId);
});
test("an account switch during contact lookup cannot enqueue the previous user's calls", async () => {
  mockContacts.mockImplementationOnce(async () => { setAccountScope("tenant.other"); return { contacts: [contact] }; });
  await syncSimCalls(); expect(mockEnqueue).not.toHaveBeenCalled();
  expect(useCallSyncStatus.getState().checkedAt).toBeNull();
});
test("switching logging off during native read stops uploads and clears busy state", async () => {
  mockRead.mockImplementationOnce(async () => { mockEnabled = false; return [call]; });
  await syncSimCalls(); expect(mockEnqueue).not.toHaveBeenCalled(); expect(useCallSyncStatus.getState().busy).toBe(false);
});
test("new CRM contacts can match a previously unknown call inside the recheck window", async () => {
  mockContacts.mockResolvedValueOnce({ contacts: [] });
  await syncSimCalls(); expect(mockEnqueue).not.toHaveBeenCalled();
  jest.spyOn(Date, "now").mockReturnValue(now + 61_000);
  await syncSimCalls(); expect(mockEnqueue).toHaveBeenCalledTimes(1);
});
test("upgrade migration pins its conservative consent boundary before the cursor advances", async () => {
  mockDisk.delete(`sim_opted_in.${owner}`);
  await syncSimCalls(); expect(mockDisk.get(`sim_opted_in.${owner}`)).toBe(String(now - 3600000));
  await syncSimCalls(); expect(mockRead.mock.calls[1][0]).toBe(now - 3600000);
});
