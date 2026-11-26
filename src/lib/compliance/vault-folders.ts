/**
 * The Documents vault's queries — every folder and every document the viewer may see, a page at a
 * time (the page once loaded only the 100 newest documents, so an older client's folder vanished).
 *
 * Scope is ./document-access.ts, applied to both queries; nothing here widens it. A search finds a
 * folder by its client (name, email, phone) — which then shows all its documents — or by a
 * document's name or description, which shows the matching documents.
 */

import { and, desc, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { complianceDocuments } from "@/db/schema";
import { vaultScopeFragment } from "@/lib/compliance/document-access";
import {
  DOCS_PER_PAGE,
  FIRM_FOLDER,
  FOLDERS_PER_PAGE,
  containsPattern,
  type VaultDoc,
  type VaultFilter,
  type VaultFolder,
} from "@/lib/compliance/vault-view";

/** Current documents of this firm, within the viewer's scope, matching the filter. */
async function matching(tx: Tx, session: SessionUser, f: VaultFilter): Promise<SQL> {
  const tenant = session.tenantId;
  const like = containsPattern(f.q);
  const search = f.q
    ? sql`(
        name ILIKE ${like}
        OR description ILIKE ${like}
        OR (related_entity_type = 'investor' AND EXISTS (
          SELECT 1 FROM investors c
           WHERE c.tenant_id = ${tenant}::uuid AND c.id = related_entity_id
             AND (c.name ILIKE ${like} OR c.email ILIKE ${like} OR c.phone ILIKE ${like})
        ))
      )`
    : sql`TRUE`;
  return sql`tenant_id = ${tenant}::uuid
    AND superseded_by_id IS NULL
    AND ${await vaultScopeFragment(tx, session)}
    AND ${f.category ? sql`category = ${f.category}` : sql`TRUE`}
    AND ${search}`;
}

export async function loadVaultFolders(
  tx: Tx,
  session: SessionUser,
  filter: VaultFilter,
  page: number,
): Promise<{ folders: VaultFolder[]; total: number; page: number }> {
  const where = await matching(tx, session, filter);
  const read = async (p: number) =>
    (await tx.execute(sql`
      WITH docs AS (
        SELECT id, created_at, expires_on,
               CASE WHEN related_entity_type = 'investor' THEN related_entity_id END AS client_id
          FROM compliance_documents
         WHERE ${where}
      ), folders AS (
        SELECT client_id,
               COUNT(*)::int AS docs,
               COUNT(*) FILTER (WHERE expires_on < current_date)::int AS expired,
               COUNT(*) FILTER (WHERE expires_on >= current_date AND expires_on <= current_date + 30)::int AS expiring,
               array_agg(id::text ORDER BY created_at DESC, id) AS ids
          FROM docs
         GROUP BY client_id
      )
      SELECT f.client_id, f.docs, f.expired, f.expiring, f.ids,
             i.name AS client_name, i.email AS client_email, i.phone AS client_phone, i.avatar_url,
             COUNT(*) OVER ()::int AS total_folders
        FROM folders f
        LEFT JOIN investors i ON i.id = f.client_id AND i.tenant_id = ${session.tenantId}::uuid
       ORDER BY (f.client_id IS NULL), lower(i.name) NULLS LAST, f.client_id
       LIMIT ${FOLDERS_PER_PAGE} OFFSET ${(p - 1) * FOLDERS_PER_PAGE}
    `)).rows as Array<{
      client_id: string | null; docs: number; expired: number; expiring: number; ids: string[];
      client_name: string | null; client_email: string | null; client_phone: string | null; avatar_url: string | null;
      total_folders: number;
    }>;

  // A page past the end (documents deleted, or an old link) starts again from the first.
  let current = page;
  let rows = await read(current);
  if (!rows.length && current > 1) {
    current = 1;
    rows = await read(current);
  }

  return {
    total: Number(rows[0]?.total_folders ?? 0),
    page: current,
    folders: rows.map((r) => ({
      key: r.client_id ?? FIRM_FOLDER,
      clientId: r.client_id,
      clientName: r.client_id ? r.client_name ?? "Client" : "Firm & unassigned documents",
      clientEmail: r.client_email,
      clientPhone: r.client_phone,
      clientAvatar: r.client_id && r.avatar_url ? `/api/investors/${r.client_id}/avatar` : null,
      count: Number(r.docs),
      ids: r.ids ?? [],
      expired: Number(r.expired),
      expiring: Number(r.expiring),
    })),
  };
}

/** One page of one folder's documents, newest first. `folder` is a client id or FIRM_FOLDER. */
export async function loadFolderDocs(
  tx: Tx,
  session: SessionUser,
  folder: string,
  filter: VaultFilter,
  page: number,
): Promise<{ docs: VaultDoc[]; total: number; page: number }> {
  const inFolder =
    folder === FIRM_FOLDER
      ? sql`(related_entity_type IS DISTINCT FROM 'investor' OR related_entity_id IS NULL)`
      : sql`(related_entity_type = 'investor' AND related_entity_id = ${folder}::uuid)`;
  const where = and(await matching(tx, session, filter), inFolder)!;

  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(complianceDocuments).where(where);
  const total = Number(count?.n ?? 0);
  const current = Math.min(page, Math.max(1, Math.ceil(total / DOCS_PER_PAGE)));

  const rows = await tx
    .select()
    .from(complianceDocuments)
    .where(where)
    .orderBy(desc(complianceDocuments.createdAt), complianceDocuments.id)
    .limit(DOCS_PER_PAGE)
    .offset((current - 1) * DOCS_PER_PAGE);

  return {
    total,
    page: current,
    docs: rows.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      description: d.description,
      mimeType: d.mimeType,
      expiresOn: d.expiresOn ? String(d.expiresOn) : null,
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    })),
  };
}
