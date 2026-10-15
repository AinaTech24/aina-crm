/**
 * NSE MF Invest (NMF II) API authentication — pure, no I/O.
 *
 * NSE's "Common Authentication For All APIs" (Non-NEAT Front End protocol
 * v1.9.6, pp. 5–6):
 *
 *   plain_text         = "<API Secret>|<random number>"
 *   salt, iv           = random 32-hex-character values
 *   aes_encrypted_val  = AES128(salt, iv, <API Member License KEY>, plain_text)
 *   Encrypted Password = base64(iv::salt::aes_encrypted_val)
 *   Authorization      = "BASIC " + base64(<Login User ID>:<Encrypted Password>)
 *   memberId header    = the member code
 *
 * AES128(salt, iv, passphrase, text) is the widely used "AesUtil" scheme:
 * the AES key is PBKDF2(passphrase, hex(salt)), 128 bits, and the text is
 * AES-128-CBC with PKCS#7 padding under hex(iv), base64-encoded. The spec does
 * not print the PBKDF2 iteration count or hash; AesUtil's are 1000 and
 * HMAC-SHA1. They are the two constants below — if NSE answers 403 with a
 * correct ID, secret, key and a whitelisted IP, these are what to check.
 */

import crypto from "crypto";

export const NSE_PBKDF2_ITERATIONS = 1000;
export const NSE_PBKDF2_DIGEST = "sha1";
const KEY_BYTES = 16; // AES-128

export type NseAuthInput = {
  loginUserId: string;
  apiSecret: string;
  licenseKey: string;
};

/** Random values are injectable so the output can be tested byte for byte. */
export type NseRandom = { salt: string; iv: string; nonce: string };

export function randomNse(): NseRandom {
  return {
    salt: crypto.randomBytes(16).toString("hex"),
    iv: crypto.randomBytes(16).toString("hex"),
    // NSE's example uses an 11-digit number.
    nonce: String(crypto.randomInt(10_000_000_000, 99_999_999_999)),
  };
}

/** AesUtil.encrypt(salt, iv, passphrase, plainText) → base64 ciphertext. */
export function aesUtilEncrypt(saltHex: string, ivHex: string, passphrase: string, plainText: string): string {
  const key = crypto.pbkdf2Sync(passphrase, Buffer.from(saltHex, "hex"), NSE_PBKDF2_ITERATIONS, KEY_BYTES, NSE_PBKDF2_DIGEST);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.from(ivHex, "hex"));
  return Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]).toString("base64");
}

/** The inverse — used only by the tests to prove the round trip. */
export function aesUtilDecrypt(saltHex: string, ivHex: string, passphrase: string, cipherB64: string): string {
  const key = crypto.pbkdf2Sync(passphrase, Buffer.from(saltHex, "hex"), NSE_PBKDF2_ITERATIONS, KEY_BYTES, NSE_PBKDF2_DIGEST);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.from(ivHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]).toString("utf8");
}

export function nseEncryptedPassword(input: NseAuthInput, rnd: NseRandom = randomNse()): string {
  const plain = `${input.apiSecret}|${rnd.nonce}`;
  const enc = aesUtilEncrypt(rnd.salt, rnd.iv, input.licenseKey, plain);
  return Buffer.from(`${rnd.iv}::${rnd.salt}::${enc}`, "utf8").toString("base64");
}

/** The Authorization header value. A fresh nonce, salt and iv every call. */
export function nseAuthorization(input: NseAuthInput, rnd: NseRandom = randomNse()): string {
  const pwd = nseEncryptedPassword(input, rnd);
  return `BASIC ${Buffer.from(`${input.loginUserId}:${pwd}`, "utf8").toString("base64")}`;
}
