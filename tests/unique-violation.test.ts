import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/observability/capture", () => ({ captureError: () => {} }));

import { handleApiError, isUniqueViolation } from "@/lib/api/error-handler";

// What Drizzle actually throws: its own message is the SQL, the reason is on .cause.
function drizzleDup(constraint: string) {
  const cause = Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
    detail: "Key (tenant_id, pan)=(…) already exists.",
  });
  return Object.assign(new Error('Failed query: insert into "investors" (…) values (…)'), { cause });
}

describe("isUniqueViolation", () => {
  it("sees the constraint on a wrapped Drizzle error", () => {
    expect(isUniqueViolation(drizzleDup("investors_tenant_pan_unique"), "investors_tenant_pan_unique")).toBe(true);
  });
  it("does not match a different constraint", () => {
    expect(isUniqueViolation(drizzleDup("sops_tenant_key_unique"), "investors_tenant_pan_unique")).toBe(false);
  });
  it("matches any unique violation when no constraint is named", () => {
    expect(isUniqueViolation(drizzleDup("x_unique"))).toBe(true);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
  it("reads a bare driver error too", () => {
    expect(isUniqueViolation({ code: "23505", constraint: "branches_tenant_code_unique" }, "branches_tenant_code_unique")).toBe(true);
  });
});

describe("handleApiError", () => {
  it("answers 409, not a masked 500, for an unanticipated duplicate", async () => {
    const res = await handleApiError(drizzleDup("anything_unique"));
    expect(res.status).toBe(409);
  });
  it("still masks a genuine internal error as 500", async () => {
    const res = await handleApiError(new Error("connection reset"));
    expect(res.status).toBe(500);
  });
});
