/**
 * A ZipCrypto archive whose header check byte is not the one zip.js expects is
 * still opened by the right password (and only by it): the CRC-32 decides.
 */
import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractRtaFileFromZip } from "@/lib/rta/unzip";
import { crc32 } from "@/lib/rta/zipcrypto";

const T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const cb = (crc: number, b: number) => ((T[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0);

function encrypt(plain: Uint8Array, password: string, header: Uint8Array): Uint8Array {
  let k0 = 305419896, k1 = 591751049, k2 = 878082192;
  const upd = (b: number) => { k0 = cb(k0, b); k1 = (k1 + (k0 & 0xff)) >>> 0; k1 = (Math.imul(k1, 134775813) + 1) >>> 0; k2 = cb(k2, k1 >>> 24); };
  const sb = () => { const t = (k2 | 2) & 0xffff; return ((t * (t ^ 1)) >>> 8) & 0xff; };
  for (const ch of password) upd(ch.charCodeAt(0) & 0xff);
  const all = new Uint8Array([...header, ...plain]);
  const out = new Uint8Array(all.length);
  for (let i = 0; i < all.length; i++) { const c = all[i] ^ sb(); upd(all[i]); out[i] = c; }
  return out;
}

/** A one-file ZIP, ZipCrypto, whose 12-byte header ends in `checkByte`. */
function makeZip(name: string, content: string, password: string, checkByte: number, deflate: boolean): Uint8Array {
  const plain = new TextEncoder().encode(content);
  const crc = crc32(plain);
  const body = deflate ? new Uint8Array(deflateRawSync(plain)) : plain;
  const header = new Uint8Array(12).fill(7); header[11] = checkByte;
  const data = encrypt(body, password, header);
  const nm = new TextEncoder().encode(name);
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const method = deflate ? 8 : 0;
  const local = [...u32(0x04034b50), ...u16(20), ...u16(1), ...u16(method), ...u16(0x6000), ...u16(0x5a21), ...u32(crc), ...u32(data.length), ...u32(plain.length), ...u16(nm.length), ...u16(0), ...nm, ...data];
  const central = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(1), ...u16(method), ...u16(0x6000), ...u16(0x5a21), ...u32(crc), ...u32(data.length), ...u32(plain.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...nm];
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return new Uint8Array([...local, ...central, ...eocd]);
}

const TEXT = "a|b\n1|2\n".repeat(50);

describe("ZipCrypto with a check byte zip.js does not expect", () => {
  for (const deflate of [false, true]) {
    const label = deflate ? "deflated" : "stored";
    it(`${label}: opens with the right password whatever the check byte`, async () => {
      // crc>>>24 is what zip.js expects; 0x00 / 0xff are not.
      for (const byte of [(crc32(new TextEncoder().encode(TEXT)) >>> 24) & 0xff, 0x00, 0xff, 0x60]) {
        const zip = makeZip("WBR2.txt", TEXT, "Abc@123", byte, deflate);
        const r = await extractRtaFileFromZip(zip, "Abc@123");
        expect(Buffer.from(r.data).toString()).toBe(TEXT);
      }
    });
    it(`${label}: a wrong password still opens nothing`, async () => {
      const zip = makeZip("WBR2.txt", TEXT, "Abc@123", 0x00, deflate);
      await expect(extractRtaFileFromZip(zip, "Abc@124")).rejects.toThrow(/password/i);
    });
  }

  it("a wrong password that slips past the 1-byte check is still a password problem, never 'invalid block type'", async () => {
    // Varying the header's check byte makes the byte a wrong password decrypts to take every value
    // in turn, so exactly one of these 256 archives gets past zip.js's own check by chance.
    for (let byte = 0; byte < 256; byte++) {
      const zip = makeZip("WBR2.txt", TEXT, "Abc@123", byte, true);
      await expect(extractRtaFileFromZip(zip, "Abc@124")).rejects.toThrow(/password/i);
    }
  });
});
