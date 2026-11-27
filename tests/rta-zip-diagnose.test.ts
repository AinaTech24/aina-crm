/**
 * The diagnosis separates "wrong password" from "right password in an odd form" from
 * "not locked at all", from the archive's bytes alone.
 */
import { describe, expect, it } from "vitest";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { diagnoseZip, passwordForms } from "@/lib/rta/zip-diagnose";

async function make(password: string | undefined, strength = 3): Promise<Uint8Array> {
  const w = new ZipWriter(new BlobWriter("application/zip"), { password, encryptionStrength: strength, useWebWorkers: false } as never);
  await w.add("a.csv", new TextReader("x|y\n1|2\n"));
  return new Uint8Array(await (await w.close()).arrayBuffer());
}

// The AES password check is TWO bytes, so a wrong form passes it by chance about once in 65,536
// tries (the salt is random each time). With ~100 forms tried per assertion that failed a deploy on
// 27 Nov 2026 ("+ leading space" matched too). So: a positive case asks that the right form is
// AMONG the matches, and the "nothing matches" case takes a fresh archive if one matched by chance.
const forms = async (bytes: Uint8Array, candidates: string[]) =>
  (await diagnoseZip(bytes, candidates)).entries[0].matches.map((m) => m.form);

describe("diagnoseZip", () => {
  it("names the right password and its form, for AES-256 and AES-128", async () => {
    for (const s of [3, 1]) {
      const r = await diagnoseZip(await make("Abc@123", s), ["nope", "Abc@123"]);
      expect(r.entries[0].matches.map((m) => m.form)).toContain("as typed, UTF-8");
      expect(r.verdict).toMatch(/passes the archive's exact password check/);
    }
  });

  it("finds a password the archive wanted in UPPER case, or with a trailing space", async () => {
    expect(await forms(await make("ABC@123"), ["abc@123"])).toContain("UPPER case, UTF-8");
    expect(await forms(await make("Abc@123 "), ["Abc@123"])).toContain("+ trailing space, UTF-8");
  });

  it("says plainly when no usual form of any candidate is the password", async () => {
    const wrong = ["Wrong#1", "right#1 ", "Right#2"];
    let r = await diagnoseZip(await make("Right#1"), wrong);
    for (let again = 0; again < 3 && r.entries[0].matches.length; again++) r = await diagnoseZip(await make("Right#1"), wrong);
    expect(r.entries[0].matches).toEqual([]);
    expect(r.verdict).toMatch(/another password/);
  });

  it("says when an archive is not encrypted, and when the bytes are not a ZIP", async () => {
    expect((await diagnoseZip(await make(undefined), ["x"])).verdict).toMatch(/needs no password/);
    expect((await diagnoseZip(new TextEncoder().encode("Invalid request"), [])).verdict).toMatch(/Not a ZIP/);
  });

  it("never prints a password, only a length and a short hash", async () => {
    const r = await diagnoseZip(await make("Secret#9"), ["Secret#9"]);
    expect(JSON.stringify(r)).not.toContain("Secret#9");
    expect(r.entries[0].matches[0].candidate).toMatch(/^len 8, sha [0-9a-f]{6}$/);
  });

  it("offers Latin-1 and UTF-16 forms only for a non-ASCII password", () => {
    expect(passwordForms("plain").some((f) => /Latin-1|UTF-16/.test(f.label))).toBe(false);
    expect(passwordForms("Pässword").some((f) => /Latin-1/.test(f.label))).toBe(true);
  });
});
