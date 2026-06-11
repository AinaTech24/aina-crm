/**
 * S3 storage abstraction for the compliance vault and other document uploads.
 *
 * Uses presigned URLs so files never flow through our Next.js server
 * (which is a problem on Vercel's serverless functions due to body-size limits).
 * Browser PUTs directly to S3; we record the resulting key in compliance_documents.
 *
 * Region: ap-south-1 (Mumbai) — DPDP data localization requirement.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";

// Accept BOTH our own S3_* names and the standard AWS_* names. A very common
// reason "S3 is configured but files still land on local disk" is that the keys
// were exported under AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (the AWS CLI /
// SDK convention) while this code only looked at S3_*.
function accessKeyId(): string | undefined {
  return process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || undefined;
}
function secretAccessKey(): string | undefined {
  return process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || undefined;
}
function region(): string {
  return process.env.S3_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
}

export function isS3Configured(): boolean {
  return !!(accessKeyId() && secretAccessKey());
}

function client(): S3Client {
  const akid = accessKeyId();
  return new S3Client({
    region: region(),
    credentials: akid
      ? {
          accessKeyId: akid,
          secretAccessKey: secretAccessKey()!,
        }
      : undefined, // falls back to IAM role on EC2/ECS
  });
}

export function bucket(): string {
  return process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "mfd-platform-docs";
}

/**
 * Non-secret snapshot of the storage configuration, for the diagnostics
 * endpoint + upload-page badge. Never returns the secret key; the access key id
 * is masked to first-4…last-4 so it can be eyeballed against the AWS console.
 */
export function storageStatus(): {
  configured: boolean;
  driver: "s3" | "local";
  bucket: string;
  region: string;
  accessKeyIdMasked: string | null;
  source: "S3_*" | "AWS_*" | "none";
} {
  const akid = accessKeyId();
  const configured = isS3Configured();
  return {
    configured,
    driver: configured ? "s3" : "local",
    bucket: bucket(),
    region: region(),
    accessKeyIdMasked: akid && akid.length >= 8 ? `${akid.slice(0, 4)}…${akid.slice(-4)}` : akid ? "****" : null,
    source: process.env.S3_ACCESS_KEY_ID
      ? "S3_*"
      : process.env.AWS_ACCESS_KEY_ID
        ? "AWS_*"
        : "none",
  };
}

/** Returns a tenant-scoped key like "tenants/<tenantId>/compliance/<uuid>-filename.pdf". */
export function vaultKey(tenantId: string, kind: "compliance" | "kyc" | "marketing" | "general", filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const ts = Date.now();
  return `tenants/${tenantId}/${kind}/${ts}-${safe}`;
}

export async function presignedPutUrl(key: string, contentType: string, ttlSeconds = 600): Promise<string> {
  if (!isS3Configured()) {
    return `/api/upload-local/${key}`;
  }
  // NOTE: do NOT set ServerSideEncryption here. When it's part of the signed
  // PutObjectCommand, AWS adds `x-amz-server-side-encryption` to the request's
  // signed headers, which means the *browser* must replay that exact header on
  // its PUT — our client only sends Content-Type, so S3 rejects every upload
  // with 403 SignatureDoesNotMatch. Encryption at rest is still enforced by the
  // bucket's default encryption (SSE-S3/AES256 is on by default for all S3
  // buckets since Jan 2023), so objects remain encrypted without the header.
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn: ttlSeconds });
}

export async function presignedGetUrl(
  key: string,
  ttlSeconds = 600,
  filename?: string,
  inline = false
): Promise<string> {
  if (!isS3Configured()) {
    return `/api/upload-local/${key}`;
  }
  // `inline` lets the browser preview the file (PDF/image) in a tab; otherwise
  // it downloads as an attachment with the original name.
  const safeName = filename ? filename.replace(/["\\]/g, "") : undefined;
  const disposition = inline
    ? safeName
      ? `inline; filename="${safeName}"`
      : "inline"
    : safeName
      ? `attachment; filename="${safeName}"`
      : undefined;
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: disposition,
  });
  return getSignedUrl(client(), cmd, { expiresIn: ttlSeconds });
}

/** Read an object's raw bytes (S3 GetObject, or local disk in the fallback). */
export async function getObjectBytes(key: string): Promise<Buffer> {
  if (!isS3Configured()) {
    const filePath = path.join(process.cwd(), "node-local", "uploads", key);
    return fs.promises.readFile(filePath);
  }
  const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const stream = res.Body as AsyncIterable<Uint8Array> | undefined;
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  if (!isS3Configured()) {
    const filePath = path.join(process.cwd(), "node-local", "uploads", key);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath).catch(() => {});
    }
    return;
  }
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * Server-side PUT for small uploads (KYC docs from public forms, screenshots,
 * etc.). For large files use presignedPutUrl + browser direct upload.
 */
export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  if (!isS3Configured()) {
    const filePath = path.join(process.cwd(), "node-local", "uploads", key);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, body);
    return;
  }
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    })
  );
}
