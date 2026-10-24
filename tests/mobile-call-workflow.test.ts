import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ session: vi.fn(), tenant: vi.fn(), execute: vi.fn(), audit: vi.fn(), update: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/db/client", () => ({ withTenant: mocks.tenant }));
vi.mock("@/lib/activities/scope", () => ({ activityScopeSql: async () => (await import("drizzle-orm")).sql`TRUE` }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit, clientMetaFromHeaders: () => ({}) }));
vi.mock("@/lib/metrics/health", () => ({ getClientHealth: vi.fn() }));
vi.mock("@/lib/api/idempotent-mutation", () => ({ withIdempotentMutation: async (_session: unknown, _req: unknown, _body: unknown, fn: (tx: unknown) => unknown) => mocks.tenant("tenant", fn) }));
vi.mock("@/lib/api/error-handler", () => ({ handleApiError: (e: { status?: number; message: string }) => Response.json({ error: e.message }, { status: e.status || 500 }) }));
import { GET as list } from "@/app/api/activities/route";
import { PATCH as patch } from "@/app/api/activities/[id]/route";
const id = "11111111-1111-4111-8111-111111111111", tenantId = "22222222-2222-4222-8222-222222222222";
let before: { id: string; ownerUserId: string; notes: string | null } | undefined;
beforeEach(() => {
  vi.clearAllMocks(); before = { id, ownerUserId: id, notes: "Existing staff note" };
  mocks.session.mockResolvedValue({ tenantId, userId: id, roles: ["rm"], mobile: true });
  mocks.execute.mockResolvedValue({ rows: [{ id }] });
  mocks.lock.mockImplementation(async () => before ? [before] : []);
  const selection = { from: () => selection, where: () => selection, limit: () => selection, for: mocks.lock };
  const mutation = { set: () => mutation, where: () => mutation, returning: async () => [{ id }] };
  mocks.update.mockReturnValue(mutation);
  mocks.tenant.mockImplementation(async (_id, fn) => fn({ execute: mocks.execute, select: () => selection, update: mocks.update }));
});
const save = (body: unknown) => patch(new NextRequest(`https://crm.test/api/activities/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
describe("call filters", () => {
  it("retains tenant/RM scope and parameterizes incoming/outcome/notes filters", async () => {
    expect((await list(new NextRequest("https://crm.test/api/activities?kind=call&direction=inbound&status=no_answer&needsNotes=1"))).status).toBe(200);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toContain(tenantId); expect(query.params).toContain(id);
    expect(query.params).toContain("inbound"); expect(query.params).toContain("no_answer");
    expect(query.sql).toContain("btrim(COALESCE(a.notes");
    expect(query.sql).not.toContain("= 'inbound'");
  });
  it("rejects invalid direction filters before issuing a query", async () => {
    expect((await list(new NextRequest("https://crm.test/api/activities?direction=bad"))).status).toBe(400);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
});
describe("reviewed summary save", () => {
  it("rejects a stale notes snapshot under a row lock without writing", async () => {
    expect((await save({ notes: "Summary", expectedNotes: "Older note" })).status).toBe(409);
    expect(mocks.lock).toHaveBeenCalledWith("update"); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("saves a matching snapshot and preserves legacy edits without a snapshot", async () => {
    expect((await save({ notes: "Summary", expectedNotes: "Existing staff note" })).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect((await save({ notes: "Legacy edit" })).status).toBe(200);
  });
  it("denies editing another employee's call before writing", async () => {
    before = { id, ownerUserId: tenantId, notes: "Existing staff note" };
    expect((await save({ notes: "Summary", expectedNotes: "Existing staff note" })).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
