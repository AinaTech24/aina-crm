/**
 * ZipCrypto ("standard" ZIP encryption) read without zip.js's password check.
 *
 * zip.js decides a ZipCrypto password is wrong from ONE byte of the 12-byte
 * encryption header, and it insists that byte is the CRC's high byte (or, when the
 * entry uses a data descriptor, the high byte of the DOS time). ZIP writers do not
 * agree on that byte — some write the CRC byte even with a data descriptor, some
 * the time byte without one — so an archive made by such a writer is refused with
 * "Invalid password" whatever password is given, and the file is filed as
 * "rejected: another password" although the password is right.
 *
 * This reads the entry's raw bytes, decrypts them itself ignoring that byte, and
 * accepts the result only when the decompressed data's CRC-32 equals the one the
 * archive recorded: a wrong password cannot pass that (1 in 2^32), so the check
 * byte was never needed.
 */
import { inflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Keys {
  k0 = 305419896;
  k1 = 591751049;
  k2 = 878082192;
  private crcByte(crc: number, b: number): number {
    return (CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  update(b: number): void {
    this.k0 = this.crcByte(this.k0, b);
    this.k1 = (this.k1 + (this.k0 & 0xff)) >>> 0;
    this.k1 = (Math.imul(this.k1, 134775813) + 1) >>> 0;
    this.k2 = this.crcByte(this.k2, this.k1 >>> 24);
  }
  streamByte(): number {
    const t = (this.k2 | 2) & 0xffff;
    return ((t * (t ^ 1)) >>> 8) & 0xff;
  }
}

function initKeys(password: string): Keys {
  const k = new Keys();
  // One byte per character, as the format defines it (zip.js and most Windows tools).
  for (let i = 0; i < password.length; i++) k.update(password.charCodeAt(i) & 0xff);
  return k;
}

/** Decrypt a ZipCrypto entry (12-byte header + data) and drop the header. No check byte. */
export function zipCryptoDecrypt(raw: Uint8Array, password: string): Uint8Array {
  const k = initKeys(password);
  const out = new Uint8Array(Math.max(0, raw.length - 12));
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i] ^ k.streamByte();
    k.update(p);
    if (i >= 12) out[i - 12] = p;
  }
  return out;
}

/**
 * The entry's data if `password` opens it, else null. `raw` is the entry's
 * encrypted bytes as stored; `method` its ZIP compression method; `crc` and
 * `size` what the archive recorded for the unpacked data.
 */
export function zipCryptoOpen(raw: Uint8Array, password: string, method: number, crc: number, size: number): Uint8Array | null {
  const plain = zipCryptoDecrypt(raw, password);
  let data: Uint8Array;
  try {
    if (method === 0) data = plain;
    else if (method === 8) data = inflateRawSync(plain);
    else return null;
  } catch {
    return null; // not valid deflate data: wrong password
  }
  if (size && data.length !== size) return null;
  return crc32(data) === crc >>> 0 ? data : null;
}
