/**
 * A ZIP password that opened a manual upload must also open the automatic files.
 *
 * Found 2026-11-17: the upload dialog sent the password exactly as typed while
 * Settings, the key button and "Remember this password" trimmed it, so a password
 * with leading / trailing whitespace worked once by hand and was then saved
 * without it — every mailback file was refused for ever. Archives here are built
 * with zip.js itself, as the registrars' are (AES and ZipCrypto).
 */
import { describe, expect, it } from "vitest";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { cleanTypedPassword, passwordVariants } from "@/lib/rta/password-variants";

async function makeZip(password: string, zipCrypto = false): Promise<Uint8Array> {
  const w = new ZipWriter(new BlobWriter("application/zip"), { password, zipCrypto, useWebWorkers: false });
  await w.add("data.txt", new TextReader("a|b\n1|2\n"));
  const blob = await w.close();
  return new Uint8Array(await blob.arrayBuffer());
}

/** What the worker does: every variant of every candidate, first that opens wins. */
async function openWith(buf: Uint8Array, candidates: string[]): Promise<string | null> {
  for (const base of candidates) {
    for (const v of passwordVariants(base)) {
      try {
        const r = await extractRtaFileFromZip(buf, v);
        if (Buffer.from(r.data).toString().includes("a|b")) return v;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

describe("passwordVariants", () => {
  it("tries the exact text first, then the trimmed one", () => {
    expect(passwordVariants("abc ")[0]).toBe("abc ");
    expect(passwordVariants("abc ")).toContain("abc");
    expect(passwordVariants("abc")[0]).toBe("abc");
  });

  it("puts back a space the old trimming code removed", () => {
    expect(passwordVariants("abc")).toEqual(expect.arrayContaining(["abc", "abc ", " abc"]));
  });

  it("adds the UTF-8 byte form of a non-ASCII password", () => {
    expect(passwordVariants("Pässword1")).toContain(Buffer.from("Pässword1", "utf8").toString("latin1"));
    expect(passwordVariants("plain").every((v) => /^[\x20-\x7e]+$/.test(v))).toBe(true);
  });

  it("only strips line breaks when cleaning typed text", () => {
    expect(cleanTypedPassword(" ab c \r\n")).toBe(" ab c ");
  });
});

describe("opening archives", () => {
  it("a password that ends in a space opens with the saved (trimmed) form", async () => {
    const zip = await makeZip("Secret#1 ");
    expect(await openWith(zip, ["Secret#1"])).toBe("Secret#1 ");
  });

  it("a password that begins with a space opens with the saved (trimmed) form", async () => {
    const zip = await makeZip(" Secret#1");
    expect(await openWith(zip, ["Secret#1"])).toBe(" Secret#1");
  });

  it("the exact saved text opens it at once, as before", async () => {
    const zip = await makeZip("Plain@123");
    expect(await openWith(zip, ["Plain@123"])).toBe("Plain@123");
  });

  it("ZipCrypto written by a UTF-8 tool opens with a non-ASCII password", async () => {
    const utf8Bytes = Buffer.from("Pässword1", "utf8").toString("latin1");
    const zip = await makeZip(utf8Bytes, true);
    expect(await openWith(zip, ["Pässword1"])).toBe(utf8Bytes);
  });

  it("a wrong password still opens nothing", async () => {
    const zip = await makeZip("Right#1");
    expect(await openWith(zip, ["Wrong#1", "right#1"])).toBeNull();
  });
});
