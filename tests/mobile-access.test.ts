import { expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { mobileActivityScope } from "../src/lib/mobile/access";
import { canViewAllLeads, canEditAllLeads, leadScopeSql, loadEditableLead, loadViewableLead } from "../src/lib/leads/access";
const base = { userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222", email: "test@example.test", name: "Test", roles: ["rm"] };
const compile = (roles: string[], branchId?: string) => new PgDialect().sqlToQuery(mobileActivityScope({ ...base, roles, branchId }));
it("limits RMs to their own activities and branch heads to their branch", () => {
  expect(compile(["rm"]).params).toEqual([base.userId]);
  expect(compile(["branch_head"], base.tenantId).params).toEqual([base.tenantId]);
  expect(compile(["branch_head"]).sql).toBe("FALSE");
});
it("allows Owners and Operations firm access within the surrounding tenant transaction", () => {
  expect(compile(["owner"]).sql).toBe("TRUE");
  expect(compile(["ops"]).sql).toBe("TRUE");
});

it("keeps mobile RMs assigned-only even when granted broad lead capabilities", () => {
  const session = { ...base, mobile: true, permissions: ["lead.view.all", "lead.edit.all"] };
  expect(canViewAllLeads(session)).toBe(false);
  expect(canEditAllLeads(session)).toBe(false);
  expect(new PgDialect().sqlToQuery(leadScopeSql(session)).params).toEqual([base.userId]);
});

it("denies mobile branch-head list and detail access when no branch is assigned", async () => {
  const session = { ...base, mobile: true, roles: ["branch_head"] };
  expect(new PgDialect().sqlToQuery(leadScopeSql(session)).sql).toBe("FALSE");
  expect(await loadViewableLead({} as any, session, base.userId)).toBeNull();
  await expect(loadEditableLead({} as any, session, base.userId)).rejects.toMatchObject({ status: 403 });
});

it("allows a configured branch head to assign leads while retaining branch-scoped reads", () => {
  const session = { ...base, mobile: true, roles: ["branch_head"], branchId: base.tenantId };
  expect(canEditAllLeads(session)).toBe(true);
  expect(new PgDialect().sqlToQuery(leadScopeSql(session)).params).toEqual([base.tenantId]);
});
