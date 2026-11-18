/**
 * Aina Admin → Legal documents: versions of the Terms and the NDA. A new
 * version starts as a draft (copied from the current one), may be edited, and
 * is then published — after which the database freezes it (migration 0266).
 * Publishing a new version makes every firm that accepted an earlier one
 * accept it at its next sign-in. Platform-admin only (withSystem).
 */

import { sql } from "drizzle-orm";
import { withSystem } from "@/db/client";
import type { LegalKind } from "./documents";

export type AdminLegalDoc = {
  id: string;
  kind: LegalKind;
  version: number;
  title: string;
  body: string;
  status: "draft" | "published";
  reviewNote: string | null;
  bodySha256: string | null;
  publishedAt: string | null;
  createdAt: string;
  acceptances: number;
};

export async function listLegalDocs(): Promise<AdminLegalDoc[]> {
  return withSystem(async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT d.id, d.kind, d.version, d.title, d.body, d.status, d.review_note, d.body_sha256, d.published_at, d.created_at,
             (SELECT count(*)::int FROM legal_acceptances a WHERE a.document_id = d.id) AS acceptances
        FROM legal_documents d ORDER BY d.kind, d.version DESC
    `)).rows as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      version: Number(r.version),
      title: r.title,
      body: r.body,
      status: r.status,
      reviewNote: r.review_note,
      bodySha256: r.body_sha256,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      acceptances: Number(r.acceptances),
    }));
  });
}

export async function createDraft(kind: LegalKind, adminId: string): Promise<string> {
  return withSystem(async (tx) => {
    const draft = (await tx.execute(sql`SELECT id FROM legal_documents WHERE kind = ${kind} AND status = 'draft' LIMIT 1`)).rows[0] as { id: string } | undefined;
    if (draft) return draft.id;
    const cur = (await tx.execute(sql`SELECT title, body, review_note, version FROM legal_documents WHERE kind = ${kind} ORDER BY version DESC LIMIT 1`)).rows[0] as
      | { title: string; body: string; review_note: string | null; version: number }
      | undefined;
    const r = (await tx.execute(sql`
      INSERT INTO legal_documents (kind, version, title, body, status, review_note, created_by)
      VALUES (${kind}, ${(cur?.version ?? 0) + 1}, ${cur?.title ?? (kind === "nda" ? "Mutual Non-Disclosure Agreement" : "Terms of Service")},
              ${cur?.body ?? ""}, 'draft', ${cur?.review_note ?? null}, ${adminId}::uuid)
      RETURNING id
    `)).rows[0] as { id: string };
    return r.id;
  });
}

export async function updateDraft(id: string, patch: { title: string; body: string; reviewNote: string | null }): Promise<void> {
  await withSystem(async (tx) => {
    const r = await tx.execute(sql`
      UPDATE legal_documents SET title = ${patch.title}, body = ${patch.body}, review_note = ${patch.reviewNote}
       WHERE id = ${id}::uuid AND status = 'draft' RETURNING id
    `);
    if (!r.rows.length) throw Object.assign(new Error("Only a draft can be edited — published versions are frozen."), { status: 409 });
  });
}

export async function publishDraft(id: string, adminId: string): Promise<void> {
  await withSystem(async (tx) => {
    const d = (await tx.execute(sql`SELECT body FROM legal_documents WHERE id = ${id}::uuid AND status = 'draft'`)).rows[0] as { body: string } | undefined;
    if (!d) throw Object.assign(new Error("Only a draft can be published."), { status: 409 });
    if (d.body.trim().length < 50) throw Object.assign(new Error("The text is too short to publish."), { status: 400 });
    await tx.execute(sql`UPDATE legal_documents SET status = 'published', published_by = ${adminId}::uuid, published_at = now() WHERE id = ${id}::uuid`);
  });
}

export async function deleteDraft(id: string): Promise<void> {
  await withSystem(async (tx) => {
    await tx.execute(sql`DELETE FROM legal_documents WHERE id = ${id}::uuid AND status = 'draft'`);
  });
}
