import { afterEach, describe, expect, it, vi } from "vitest";

// isS3Configured reads process.env on every call, so each case sets its own env.
const KEYS = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET", "AWS_S3_BUCKET"];

async function load(env: Record<string, string>) {
  for (const k of KEYS) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/lib/storage/s3");
}

describe("S3 configuration: static keys or the EC2 instance role", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the instance role when a bucket is named and no static key is set", async () => {
    const s3 = await load({ S3_BUCKET: "bucket" });
    expect(s3.isS3Configured()).toBe(true);
    expect(s3.storageStatus().source).toBe("instance-role");
  });

  it("still accepts a full static key pair", async () => {
    const s3 = await load({ S3_BUCKET: "bucket", S3_ACCESS_KEY_ID: "AKIAEXAMPLE0000", S3_SECRET_ACCESS_KEY: "secret" });
    expect(s3.isS3Configured()).toBe(true);
    expect(s3.storageStatus().source).toBe("S3_*");
  });

  it("treats half a key pair as not configured", async () => {
    const s3 = await load({ S3_BUCKET: "bucket", S3_ACCESS_KEY_ID: "AKIAEXAMPLE0000" });
    expect(s3.isS3Configured()).toBe(false);
  });

  it("is not configured with no bucket and no keys (local development)", async () => {
    const s3 = await load({});
    expect(s3.isS3Configured()).toBe(false);
    expect(s3.storageStatus().source).toBe("none");
  });
});
