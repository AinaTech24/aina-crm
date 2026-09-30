import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db/client", () => ({ withTenant: state.transaction }));
import { assertMobileRecordPath, assertMobileAssignee } from "../src/lib/mobile/record-access";
import { PgDialect } from "drizzle-orm/pg-core";
const session = { mobile: true, userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222", roles: ["branch_head"], email: "test@example.test", name: "Test" };
const path = `/api/tasks/${session.userId}/comments`;
beforeEach(() => {
  state.execute.mockReset(); state.transaction.mockReset();
  state.transaction.mockImplementation(async (_tenant, callback) => callback({ execute: state.execute }));
});
it("denies nested task access when the parent is outside the mobile scope", async () => {
  state.execute.mockResolvedValue({ rows: [] });
  await expect(assertMobileRecordPath(session, path)).rejects.toMatchObject({ status: 404 });
  const query = new PgDialect().sqlToQuery(state.execute.mock.calls[0][0]);
  expect(query.sql).toContain("AND FALSE");
  expect(query.params).toContain(session.tenantId);
});
it("scopes meeting detail access to the assigned user's branch", async () => {
  state.execute.mockResolvedValue({ rows: [{ id: session.userId }] });
  await assertMobileRecordPath({ ...session, branchId: session.tenantId }, `/api/review-meetings/${session.userId}`);
  const query = new PgDialect().sqlToQuery(state.execute.mock.calls[0][0]);
  expect(query.sql).toContain("review_meetings.rm_id IN");
  expect(query.sql).toContain("branch_id =");
});
it("does not change cookie sessions or collection endpoints", async () => {
  await assertMobileRecordPath({ ...session, mobile: false }, path);
  await assertMobileRecordPath(session, "/api/tasks");
  expect(state.transaction).not.toHaveBeenCalled();
});
it("applies the same boundary to percent-encoded UUIDs", async () => {
  state.execute.mockResolvedValue({ rows: [] });
  await expect(assertMobileRecordPath(session, path.replace("11111111", "%311111111"))).rejects.toMatchObject({ status: 404 });
  expect(state.execute).toHaveBeenCalled();
});
it("rejects an inactive or out-of-scope assignment before mutation", async () => {
  state.execute.mockResolvedValue({ rows: [] });
  await expect(assertMobileAssignee({ execute: state.execute } as any, session, session.userId)).rejects.toMatchObject({ status: 403 });
});
