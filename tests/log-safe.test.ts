import { describe, expect, it } from "vitest";
import { addressRef, errorRef, fileRef, safeError, urlRef } from "@/lib/observability/log-safe";

describe("log-safe references never carry the value", () => {
  it("addressRef hashes an address stably and case-insensitively", () => {
    const a = addressRef("Client.Name@Example.com");
    expect(a).toMatch(/^addr#[0-9a-f]{8}$/);
    expect(a).toBe(addressRef(" client.name@example.com "));
    expect(a).not.toMatch(/client|example/i);
    expect(addressRef(null)).toBe("none");
    expect(addressRef("")).toBe("none");
  });

  it("fileRef drops a file name that could hold a PAN or a name, keeps the type", () => {
    const f = fileRef("ABCDE1234F_Ramesh_Kumar_statement.PDF");
    expect(f).toMatch(/^file#[0-9a-f]{8}\.pdf$/);
    expect(f).not.toMatch(/ABCDE1234F|Ramesh|Kumar/i);
    expect(fileRef("noextension")).toMatch(/^file#[0-9a-f]{8}$/);
    expect(fileRef(undefined)).toBe("file#none");
  });

  it("urlRef keeps the host only", () => {
    expect(urlRef("https://www.camsonline.com/dl?token=SECRET&email=a@b.com")).toBe("www.camsonline.com");
    expect(urlRef("not a url")).toBe("url#invalid");
  });

  it("errorRef / safeError keep the class and code, never a query's parameters", () => {
    const cause = Object.assign(new Error("duplicate key"), { code: "23505" });
    const e = Object.assign(new Error("Failed query: insert … params: ABCDE1234F,9876543210,client@x.com"), { cause });
    expect(errorRef(e)).toBe("Error 23505");
    expect(safeError(e).message).toBe("Error 23505");
    expect(safeError(e).message).not.toMatch(/ABCDE|9876|client/);
    expect(errorRef(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe("Error ECONNREFUSED");
    expect(errorRef(new TypeError("x"))).toBe("TypeError");
    expect(errorRef("plain string")).toBe("string");
  });
});
