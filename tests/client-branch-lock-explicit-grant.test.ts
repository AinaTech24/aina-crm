/**
 * A branch head is locked to their branch's clients — unless the owner ticked
 * "View all clients" for them in Customize Access Permissions. A branch head's
 * role defaults give only "view assigned", so a ticked "view all" is a deliberate
 * step up and the lock must not undo it (Shah Financial, 2026-11-23: a team member
 * with Branch Head + Back Office and View all clients ticked saw almost no clients).
 */
import { describe, expect, it } from "vitest";
import { hasExplicitGrant, isBranchScoped, isClientBranchScoped, isLeadBranchScoped } from "@/lib/leads/access";
import { investorScopeSql } from "@/lib/investors/access";
import type { SessionUser } from "@/lib/auth/session";

const sess = (o: Partial<SessionUser>): SessionUser =>
  ({ userId: "u1", tenantId: "t1", email: "a@x.in", name: "A", roles: ["branch_head"], branchId: "b1", permissions: [], ...o }) as unknown as SessionUser;

describe("the branch lock on clients", () => {
  it("a plain branch head is locked to their branch", () => {
    expect(isClientBranchScoped(sess({}))).toBe(true);
    expect(isLeadBranchScoped(sess({}))).toBe(true);
  });

  it("an explicitly ticked View all clients lifts the client lock, and only that one", () => {
    const s = sess({ roles: ["branch_head", "back_office"], permissions: ["investor.view.all", "investor.edit.all"] });
    expect(isBranchScoped(s)).toBe(true); // the dashboards' lock is its own switch
    expect(isClientBranchScoped(s)).toBe(false);
    expect(isLeadBranchScoped(s)).toBe(true);
    expect(hasExplicitGrant(s, "investor.view.all")).toBe(true);
  });

  it("a customised list WITHOUT view-all keeps the lock (the defaults give a branch head only 'assigned')", () => {
    const s = sess({ permissions: ["investor.view.assigned", "investor.edit.assigned"] });
    expect(isClientBranchScoped(s)).toBe(true);
  });

  it("View all leads lifts the lead lock", () => {
    const s = sess({ permissions: ["lead.view.all", "investor.view.assigned"] });
    expect(isLeadBranchScoped(s)).toBe(false);
    expect(isClientBranchScoped(s)).toBe(true);
  });

  it("the owner, and a branch head with no branch, are never branch-locked", () => {
    expect(isClientBranchScoped(sess({ roles: ["owner"] }))).toBe(false);
    expect(isClientBranchScoped(sess({ branchId: null as unknown as string }))).toBe(false);
  });
});

describe("investorScopeSql for a customised branch head", () => {
  // A customised user never reads the firm switch, so no database is touched.
  const tx = { execute: async () => ({ rows: [] }) };
  const text = async (s: SessionUser) => JSON.stringify(await investorScopeSql(tx, s, "i"));

  it("View all clients ticked → the whole book, not the branch", async () => {
    const q = await text(sess({ roles: ["branch_head", "back_office"], permissions: ["investor.view.all", "investor.edit.all"] }));
    expect(q).not.toContain("branch_id");
    expect(q).not.toContain("rm_id");
  });

  it("view assigned only → still the branch", async () => {
    const q = await text(sess({ permissions: ["investor.view.assigned"] }));
    expect(q).toContain("i.branch_id");
  });
});
