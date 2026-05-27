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

function client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? "ap-south-1",
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        }
      : undefined, // falls back to IAM role on EC2/ECS
  });
}

export function bucket(): string {
  return process.env.S3_BUCKET ?? "mfd-platform-docs";
}

/** Returns a tenant-scoped key like "tenants/<tenantId>/compliance/<uuid>-filename.pdf". */
export function vaultKey(tenantId: string, kind: "compliance" | "kyc" | "marketing" | "general", filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const ts = Date.now();
  return `tenants/${tenantId}/${kind}/${ts}-${safe}`;
}

export async function presignedPutUrl(key: string, contentType: string, ttlSeconds = 600): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
  });
  return getSignedUrl(client(), cmd, { expiresIn: ttlSeconds });
}

export async function presignedGetUrl(key: string, ttlSeconds = 600, filename?: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: filename ? `attachment; filename="${filename}"` : undefined,
  });
  return getSignedUrl(client(), cmd, { expiresIn: ttlSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * Server-side PUT for small uploads (KYC docs from public forms, screenshots,
 * etc.). For large files use presignedPutUrl + browser direct upload.
 */
export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  // If S3 isn't configured (local dev), no-op. The compliance_documents row
  // still gets created with the key — manual re-upload can happen later.
  if (!process.env.S3_BUCKET && !process.env.S3_ACCESS_KEY_ID) return;
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
