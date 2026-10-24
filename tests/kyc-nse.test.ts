import { describe, expect, it } from "vitest";
import { webcrypto } from "crypto";
import {
  aesUtilDecrypt,
  aesUtilEncrypt,
  NSE_PBKDF2_ITERATIONS,
  nseAuthorization,
  nseEncryptedPassword,
} from "@/lib/kyc/nse-auth";
import { kraLabel, kycVerdict, nseDate } from "@/lib/kyc/nse-status";
import { parseKycAnswer } from "@/lib/kyc/nse-client";

const RND = { salt: "9a1c74744b944d9bd34e7de3a964fb19", iv: "90e9c0485bc76e864e5aae05a34d356f", nonce: "34533412321" };
const CREDS = { loginUserId: "ARN12345", apiSecret: "S3cret-Value", licenseKey: "LICENSE-KEY-123" };

describe("NSE MF Invest authentication", () => {
  it("encrypts with PBKDF2 + AES-128-CBC, the same as an independent WebCrypto implementation", async () => {
    const ours = aesUtilEncrypt(RND.salt, RND.iv, CREDS.licenseKey, `${CREDS.apiSecret}|${RND.nonce}`);
    const subtle = webcrypto.subtle;
    const base = await subtle.importKey("raw", new TextEncoder().encode(CREDS.licenseKey), "PBKDF2", false, ["deriveKey"]);
    const key = await subtle.deriveKey(
      { name: "PBKDF2", salt: Buffer.from(RND.salt, "hex"), iterations: NSE_PBKDF2_ITERATIONS, hash: "SHA-1" },
      base,
      { name: "AES-CBC", length: 128 },
      false,
      ["encrypt"]
    );
    const ct = await subtle.encrypt({ name: "AES-CBC", iv: Buffer.from(RND.iv, "hex") }, key, new TextEncoder().encode(`${CREDS.apiSecret}|${RND.nonce}`));
    expect(ours).toBe(Buffer.from(ct).toString("base64"));
  });

  it("builds base64(iv::salt::ciphertext) and the ciphertext opens to secret|nonce", () => {
    const pwd = nseEncryptedPassword(CREDS, RND);
    const [iv, salt, enc] = Buffer.from(pwd, "base64").toString("utf8").split("::");
    expect(iv).toBe(RND.iv);
    expect(salt).toBe(RND.salt);
    expect(aesUtilDecrypt(salt, iv, CREDS.licenseKey, enc)).toBe(`${CREDS.apiSecret}|${RND.nonce}`);
  });

  it("sends BASIC base64(user:encryptedPassword)", () => {
    const h = nseAuthorization(CREDS, RND);
    expect(h.startsWith("BASIC ")).toBe(true);
    const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
    expect(decoded).toBe(`${CREDS.loginUserId}:${nseEncryptedPassword(CREDS, RND)}`);
  });

  it("uses fresh random values on every call", () => {
    expect(nseAuthorization(CREDS)).not.toBe(nseAuthorization(CREDS));
  });
});

describe("KRA remark → CRM KYC status (NSE protocol p.192)", () => {
  const cases: Array<[string, string, string | null]> = [
    ["S", "UNDER_PROCESS", "pending"],
    ["S", "KYC REGISTERED", "registered"],
    ["F", "ON HOLD", "hold"],
    ["F", "KYC REJECTED", "rejected"],
    ["F", "NOT AVAILABLE", "pending"],
    ["F", "Deactivate", "re_kyc_required"],
    ["S", "KYC Validated", "verified"],
    ["F", "KYC REGISTERED - Incomplete KYC (Existing / OLD Record)", "re_kyc_required"],
    ["F", "UNDER_PROCESS - Incomplete KYC (Existing / OLD Record)", "re_kyc_required"],
    ["F", "ON HOLD - Incomplete KYC (Existing / OLD Record)", "re_kyc_required"],
    ["F", "CVL MF KYC", "re_kyc_required"],
  ];
  for (const [flag, remark, status] of cases) {
    it(`${remark} → ${status}`, () => {
      expect(kycVerdict(flag, remark)).toEqual({ kind: "status", status });
    });
  }

  it("service down is not an answer", () => {
    expect(kycVerdict("F", "KYC_CHECK_SERVICE_DOWN")).toEqual({ kind: "service_down" });
  });

  it("an unknown or blank remark never changes a status", () => {
    expect(kycVerdict("S", "SOMETHING NEW")).toEqual({ kind: "unknown" });
    expect(kycVerdict("S", "")).toEqual({ kind: "unknown" });
  });
});

describe("parsing NSE's answer", () => {
  const sample = {
    pan: "CLZPK9115L",
    name: "BABUBHAI",
    status_date: "02-07-2015 17:38:02",
    kyc_status: "S",
    kyc_status_remark: "KYC REGISTERED",
    kra_name: "camskra",
  };

  it("reads the documented shape, a data wrapper and an array", () => {
    for (const body of [sample, { data: sample }, [sample]]) {
      expect(parseKycAnswer(body)).toMatchObject({ pan: "CLZPK9115L", flag: "S", remark: "KYC REGISTERED", kraName: "camskra" });
    }
  });

  it("an error body is not an answer", () => {
    expect(parseKycAnswer({ status: "403 FORBIDDEN", message: "Invalid authorization header" })).toBeNull();
    expect(parseKycAnswer(null)).toBeNull();
  });

  it("KRA names and dates", () => {
    expect(kraLabel("cvlkra")).toBe("CVL KRA");
    expect(kraLabel("karvykra")).toBe("KFintech KRA");
    expect(kraLabel("")).toBeNull();
    expect(nseDate("02-07-2015 17:38:02")).toBe("2015-07-02");
    expect(nseDate("31-02-2015")).toBeNull();
    expect(nseDate(null)).toBeNull();
  });
});
