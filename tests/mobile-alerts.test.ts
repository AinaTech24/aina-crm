import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ execute: vi.fn(), send: vi.fn(), log: [] as string[] }));
vi.mock("@/db/client", () => ({ withTenant: async (_id: string, fn: any) => {
  state.log.push("begin");
  const result = await fn({ execute: state.execute });
  state.log.push("commit");
  return result;
} }));
vi.mock("@/lib/push/expo", () => ({ sendPushToUsers: state.send }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn() }));
import { deliverMobileAlerts } from "../src/lib/notifications/mobile";
const tenant = "11111111-1111-4111-8111-111111111111";
const alert = { id: "22222222-2222-4222-8222-222222222222", user_id: "33333333-3333-4333-8333-333333333333", title: "Due task", body: null, link_url: "/dashboard/tasks" };
beforeEach(() => { state.execute.mockReset(); state.send.mockReset(); state.log.length = 0; });

it("commits the delivery claim before contacting the push service", async () => {
  state.execute.mockResolvedValueOnce({ rows: [alert] }).mockResolvedValue({ rows: [] });
  state.send.mockImplementation(async () => { state.log.push("send"); return { targeted: 1, sent: 1, disabled: 0 }; });
  expect(await deliverMobileAlerts(tenant)).toBe(1);
  expect(state.log).toEqual(["begin", "commit", "begin", "send", "commit"]);
  expect(state.send).toHaveBeenCalledWith(expect.anything(), tenant, [alert.user_id], expect.objectContaining({ data: { notificationId: alert.id, url: alert.link_url } }));
});

it("does not send when no pending alert has an eligible device", async () => {
  state.execute.mockResolvedValue({ rows: [] });
  expect(await deliverMobileAlerts(tenant)).toBe(0);
  expect(state.send).not.toHaveBeenCalled();
});

it("does not retry an uncertain send or prevent processing subsequent alerts", async () => {
  state.execute.mockResolvedValueOnce({ rows: [alert, { ...alert, id: tenant }] }).mockResolvedValue({ rows: [] });
  state.send.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({ targeted: 1, sent: 1, disabled: 0 });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await deliverMobileAlerts(tenant)).toBe(2);
  expect(state.send).toHaveBeenCalledTimes(2);
  error.mockRestore();
});
