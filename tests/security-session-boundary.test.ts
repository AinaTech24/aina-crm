import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const context = vi.hoisted(() => ({ headers: new Headers(), token: "", revoked: false }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ headers: async () => context.headers,
  cookies: async () => ({ get: () => context.token ? { value: context.token } : undefined }) }));
vi.mock("@/lib/auth/revocation", () => ({ isSessionRevoked: async () => context.revoked, isDeviceSessionRevoked: async () => context.revoked, isSessionOrDeviceRevoked: async () => context.revoked }));
import { getSession } from "@/lib/auth/session";
import { signSession, verifySession } from "@/lib/auth/jwt";
import { middleware } from "@/middleware";
const user = { userId: "user-a", tenantId: "tenant-a", roles: ["owner"], email: "a@example.com", name: "A", sid: "device-a" };
beforeEach(() => { process.env.NEXTAUTH_SECRET = "test-secret-with-enough-entropy-for-tests"; context.headers = new Headers(); context.token = ""; context.revoked = false; });
describe("signed Node session boundary", () => {
  it("rejects a forged identity header on public auth endpoints", async () => {
    context.headers.set("x-mfd-session", JSON.stringify(user));
    expect(await getSession()).toBeNull();
  });
  it("verifies Bearer credentials and rejects revoked sessions", async () => {
    context.headers.set("authorization", `Bearer ${await signSession(user)}`);
    expect((await getSession())?.userId).toBe(user.userId);
    context.revoked = true;
    expect(await getSession()).toBeNull();
  });
  it("rejects tokens without device identity", async () => {
    expect(await verifySession(await signSession({ ...user, sid: undefined }))).toBeNull();
  });
  it("strips caller identity/path headers even for public routes", async () => {
    const res = await middleware(new NextRequest("https://crm.example/api/auth/2fa/setup", {
      headers: { "x-mfd-session": JSON.stringify(user), "x-pathname": "/super-admin" },
    }));
    expect(res.headers.get("x-middleware-request-x-mfd-session")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/api/auth/2fa/setup");
  });
});
