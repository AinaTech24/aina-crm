/**
 * Load the client's uploaded signature / signed risk-profile form so the PDF
 * report can print it above the client's signature line.
 *
 * `risk_profile_responses.document_url` holds the storage key returned by
 * /api/compliance/upload-url (S3 vault key, or a `/api/upload-local/<key>` URL
 * from the no-S3 era). Only PNG / JPEG can be embedded by pdf-lib — a scanned
 * PDF stays on file and the report simply notes "Signed form uploaded".
 *
 * Never throws: a missing or unreadable file must not break the report.
 */

import { getLocalUploadBytes, getObjectBytes } from "@/lib/storage/s3";
import { sniffMime } from "@/lib/storage/file-sniff";

const LOCAL_PREFIX = "/api/upload-local/";

export type SignatureImage = { bytes: Uint8Array; mime: string };

export async function loadSignatureImage(keyOrUrl: string | null | undefined): Promise<SignatureImage | null> {
  if (!keyOrUrl) return null;
  try {
    const raw = String(keyOrUrl).trim();
    const bytes = raw.startsWith(LOCAL_PREFIX)
      ? await getLocalUploadBytes(decodeURIComponent(raw.slice(LOCAL_PREFIX.length)))
      : await getObjectBytes(raw);
    if (!bytes?.length) return null;
    const mime = sniffMime(bytes);
    if (mime !== "image/png" && mime !== "image/jpeg") return null;
    return { bytes: new Uint8Array(bytes), mime };
  } catch {
    return null;
  }
}
