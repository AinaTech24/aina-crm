import { describe, expect, it } from "vitest";
import { can, rolesWithoutSharedBook, SHARED_BOOK_MARKER } from "@/lib/auth/rbac";
import { sharedBookCandidate } from "@/lib/auth/shared-book";
import type { SessionUser } from "@/lib/auth/jwt";

const s = (roles: string[], permissions: string[] = []): SessionUser => ({
  userId: "u", tenantId: "t", roles, permissions, email: "x@y.z", name: "X",
});

describe("shared client book on every screen", () => {
  it("the marker reads as View all clients, and only that", () => {
    const roles = ["rm", SHARED_BOOK_MARKER];
    expect(can(["rm"], "investor.view.all")).toBe(false);
    expect(can(roles, "investor.view.all")).toBe(true);
    expect(can(roles, "lead.view.all")).toBe(can(["rm"], "lead.view.all"));
    expect(can(roles, "investor.edit.all" as any)).toBe(can(["rm"], "investor.edit.all" as any));
  });
  it("a customised user's ticks stay exact", () => {
    expect(can(["rm", SHARED_BOOK_MARKER], "investor.view.all", ["investor.view.assigned"])).toBe(false);
  });
  it("goes to role-default client viewers only", () => {
    expect(sharedBookCandidate(s(["rm"]))).toBe(true);
    expect(sharedBookCandidate(s(["branch_head"]))).toBe(true);
    expect(sharedBookCandidate(s(["owner"]))).toBe(false);
    expect(sharedBookCandidate(s(["ops"]))).toBe(false);
    expect(sharedBookCandidate(s(["marketing"]))).toBe(false);
    expect(sharedBookCandidate(s(["rm"], ["investor.view.assigned"]))).toBe(false);
    expect(sharedBookCandidate(s(["rm", SHARED_BOOK_MARKER]))).toBe(false);
  });
  it("write checks use the real roles", () => {
    expect(rolesWithoutSharedBook(["rm", SHARED_BOOK_MARKER])).toEqual(["rm"]);
  });
});
