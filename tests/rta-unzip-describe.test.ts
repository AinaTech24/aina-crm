import { describe, it, expect } from "vitest";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js";
import { describeZip, extractRtaFileFromZip } from "@/lib/rta/unzip";

async function zip(opts: Record<string, unknown>) {
  const w = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, ...opts } as any);
  await w.add("a.csv", new Uint8ArrayReader(new TextEncoder().encode("x|y\n1|2\n")));
  return w.close();
}

describe("describeZip — what a refused archive looks like", () => {
  it("names AES-256, AES-128, ZipCrypto and plain archives", async () => {
    expect(await describeZip(await zip({ password: "p", encryptionStrength: 3 }))).toMatch(/^AES-256 AE-\d, deflate, 1 file$/);
    expect(await describeZip(await zip({ password: "p", encryptionStrength: 1 }))).toMatch(/^AES-128 AE-\d, deflate, 1 file$/);
    expect(await describeZip(await zip({ password: "p", zipCrypto: true }))).toBe("ZipCrypto, 1 file");
    expect(await describeZip(await zip({}))).toBe("not encrypted, 1 file");
  });

  it("never throws on junk", async () => {
    expect(await describeZip(new Uint8Array([1, 2, 3]))).toMatch(/could not read/);
  });

  it("the right password opens every kind, a wrong one says so", async () => {
    for (const o of [{ encryptionStrength: 3 }, { encryptionStrength: 1 }, { zipCrypto: true }]) {
      const z = await zip({ password: "Pa ss#1", ...o });
      expect((await extractRtaFileFromZip(z, "Pa ss#1")).filename).toBe("a.csv");
      await expect(extractRtaFileFromZip(z, "nope")).rejects.toThrow(/password/i);
    }
  });
});
