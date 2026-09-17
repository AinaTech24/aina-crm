import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicAddress, resolveHttpDestination, safeWorkflowHttp } from "@/lib/workflow/safe-http";

afterEach(() => vi.unstubAllEnvs());
describe("workflow HTTP destination boundary", () => {
  it.each(["127.0.0.1", "10.4.2.1", "169.254.169.254", "100.100.100.200", "192.168.1.1", "198.18.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::", "2001:db8::1"])('rejects nonpublic %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("allows global IPv4/IPv6 addresses", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("checks every DNS answer, including a private second answer", async () => {
    await expect(resolveHttpDestination(new URL("https://example.com"), async () => [
      { address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 },
    ])).rejects.toThrow(/Private/);
  });
  it("pins the validated address and rechecks DNS on same-origin redirects", async () => {
    const resolve = vi.fn().mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const send = vi.fn().mockResolvedValue({ status: 302, body: "", location: "/second" });
    await expect(safeWorkflowHttp("https://example.com", { method: "GET", headers: {} }, { resolve, send })).rejects.toThrow(/Private/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({ address: "93.184.216.34", family: 4 });
  });
  it("never forwards secrets to a redirect on another origin", async () => {
    const send = vi.fn().mockResolvedValue({ status: 307, body: "", location: "http://169.254.169.254/latest" });
    await expect(safeWorkflowHttp("https://example.com", { method: "POST", headers: { authorization: "secret" }, body: "private" }, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }], send,
    })).rejects.toThrow(/Cross-origin/);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("requires exact operator-approved private origins and still rejects metadata", async () => {
    vi.stubEnv("WORKFLOW_HTTP_ALLOWED_PRIVATE_ORIGINS", "https://internal.example:8443,http://169.254.169.254");
    expect(await resolveHttpDestination(new URL("https://internal.example:8443/a"), async () => [{ address: "10.0.0.8", family: 4 }])).toEqual({ address: "10.0.0.8", family: 4 });
    await expect(resolveHttpDestination(new URL("http://169.254.169.254"), vi.fn())).rejects.toThrow();
    await expect(resolveHttpDestination(new URL("https://internal.example:8444"), vi.fn())).rejects.toThrow();
  });
  it.each(["file:///etc/passwd", "http://user:pass@example.com", "http://2130706433", "http://[::ffff:127.0.0.1]"])("rejects bypass URL %s", async url => {
    const send = vi.fn();
    await expect(safeWorkflowHttp(url, { method: "GET", headers: {} }, { send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("bounds DNS wait and rejects Host overrides", async () => {
    await expect(safeWorkflowHttp("https://example.com", { method: "GET", headers: {}, timeoutMs: 5 }, {
      resolve: () => new Promise(() => {}),
    })).rejects.toThrow(/timed out/);
    await expect(safeWorkflowHttp("https://example.com", { method: "GET", headers: { Host: "localhost" } })).rejects.toThrow(/header/);
  });
});
