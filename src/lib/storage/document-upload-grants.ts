import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

type Collection = { id: string; tenantId: string | null; subjectType: string; subjectId: string };
type Upload = { key: string; docKey: string; mime: string };

/** Persist exactly what this collection link may submit. No path-prefix guesses. */
export async function grantDocumentUpload(tx: Tx, token: Collection, upload: Upload) {
  await tx.execute(sql`
    INSERT INTO document_upload_grants
      (storage_key, tenant_id, token_id, subject_type, subject_id, doc_key, content_type, expires_at)
    VALUES (${upload.key}, ${token.tenantId}, ${token.id}, ${token.subjectType}, ${token.subjectId},
      ${upload.docKey}, ${upload.mime}, now() + interval '1 hour')
  `);
}

/** Claim before ANY object read/delete; rolled back together with document indexing. */
export async function claimDocumentUpload(tx: Tx, token: Collection, upload: Upload) {
  const result = await tx.execute(sql`
    UPDATE document_upload_grants SET consumed_at = now()
    WHERE storage_key = ${upload.key} AND tenant_id = ${token.tenantId} AND token_id = ${token.id}
      AND subject_type = ${token.subjectType} AND subject_id = ${token.subjectId}
      AND doc_key = ${upload.docKey} AND content_type = ${upload.mime}
      AND consumed_at IS NULL AND expires_at > now()
    RETURNING storage_key
  `);
  if (!result.rows.length) throw new Error("Upload does not belong to this collection link, or has expired. Upload the file again.");
}
