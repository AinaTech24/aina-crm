import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), tenant: vi.fn(), execute: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/db/client", () => ({ withTenant: mocks.tenant }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.audit }));
vi.mock("@/lib/api/error-handler", () => ({ handleApiError: (e: any) => new Response(null, { status: e.status ?? 500 }) }));
vi.mock("@/app/api/business-entries/route", () => ({ POST: vi.fn() }));
vi.mock("@/app/api/insurance/route", () => ({ POST: vi.fn() }));
import { POST as saveTargets } from "@/app/api/mobile/targets/route";
import { GET as history } from "@/app/api/mobile/business/route";
import { GET as home } from "@/app/api/dashboard/home/route";
import { GET as day } from "@/app/api/dashboard/my-day/route";
const id = "11111111-1111-4111-8111-111111111111", branch = "22222222-2222-4222-8222-222222222222";
const scope = { period: "2026-09", scopeType: "user", scopeId: id };
const request = (body: unknown) => new Request("https://crm.test/api/mobile/targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const queries = () => mocks.execute.mock.calls.map(([q]) => new PgDialect().sqlToQuery(q));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ tenantId: id, userId: id, branchId: branch, roles: ["owner"], mobile: true });
  mocks.tenant.mockImplementation(async (_id, fn) => fn({ execute: mocks.execute }));
  mocks.execute.mockResolvedValue({ rows: [{ id, name: "RM", v: 0 }] });
});
describe("monthly target batches", () => {
  it("saves every metric and its audit within one tenant transaction", async () => {
    const response = await saveTargets(request({ ...scope, metrics: [{ metric: "sip", target: 5000 }, { metric: "new_meetings", target: 3 }] }));
    expect(response.status).toBe(200);
    expect(mocks.tenant).toHaveBeenCalledTimes(1);
    expect(queries().filter(q => q.sql.includes("INSERT INTO kra_targets"))).toHaveLength(2);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ metric: "sip", target: 5000 }, { metric: "new_meetings", target: 1.5 }],
    [{ metric: "sip", target: 5000 }, { metric: "sip", target: 6 }],
    [{ metric: "unknown", target: 0 }],
  ])("rejects invalid batches before any write", async (...metrics) => {
    expect((await saveTargets(request({ ...scope, metrics }))).status).toBe(400);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it("propagates a later write failure out of the transaction without auditing success", async () => {
    let inserts = 0;
    mocks.execute.mockImplementation(async q => {
      if (new PgDialect().sqlToQuery(q).sql.includes("INSERT INTO kra_targets") && ++inserts === 2) throw new Error("Database unavailable");
      return { rows: [{ id, name: "RM" }] };
    });
    expect((await saveTargets(request({ ...scope, metrics: [{ metric: "sip", target: 5000 }, { metric: "new_meetings", target: 3 }] }))).status).toBe(500);
    expect(mocks.tenant).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("keeps the previous APK's single-target request working", async () => {
    expect((await saveTargets(request({ ...scope, metric: "new_meetings", target: 4 }))).status).toBe(200);
  });
  it("denies an RM even with an otherwise valid batch", async () => {
    mocks.session.mockResolvedValue({ tenantId: id, userId: id, roles: ["rm"], mobile: true });
    expect((await saveTargets(request({ ...scope, metrics: [{ metric: "sip", target: 5000 }] }))).status).toBe(403);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
});
describe("scoped history and home", () => {
  it("parameterizes history search, retains branch scope and fetches one extra pagination row", async () => {
    mocks.session.mockResolvedValue({ tenantId: id, userId: id, branchId: branch, roles: ["branch_head"], mobile: true });
    mocks.execute.mockResolvedValueOnce({ rows: Array.from({ length: 51 }, (_, i) => ({ id: String(i) })) }).mockResolvedValueOnce({ rows: [] });
    const response = await history(new Request("https://crm.test/api/mobile/business?q=O%27Neil&page=2"));
    const body = await response.json();
    expect(body.entries).toHaveLength(50); expect(body.hasMore).toBe(true);
    const query = queries()[0]; expect(query.sql).not.toContain("O'Neil"); expect(query.params).toContain("%O'Neil%");
    expect(query.params).toContain(branch); expect(query.params).toContain(100); expect(query.params).toContain(51);
  });
  it("rejects invalid paging and dates", async () => {
    expect((await history(new Request("https://crm.test/api/mobile/business?page=-1"))).status).toBe(400);
    expect((await history(new Request("https://crm.test/api/mobile/business?from=2026-02-30"))).status).toBe(400);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
  it("keeps Branch Head home and agenda scoped to the branch", async () => {
    mocks.session.mockResolvedValue({ tenantId: id, userId: id, branchId: branch, roles: ["branch_head"], mobile: true });
    expect((await (await home()).json()).scope).toBe("branch");
    expect(queries().every(q => q.params.includes(branch))).toBe(true);
    mocks.execute.mockClear();
    expect((await (await day(new NextRequest("https://crm.test/api/dashboard/my-day?date=2026-09-30"))).json()).scope).toBe("branch");
    expect(queries().every(q => q.params.includes(branch))).toBe(true);
  });
});
