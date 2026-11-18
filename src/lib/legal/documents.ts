/**
 * Versioned legal documents (Terms of Service, NDA) and the onboarding gate
 * (owner's addition C, 2026-11-18). Migration 0266.
 *
 *  - The CURRENT version of a kind is its highest published version. A
 *    published version never changes (trigger); platform admins publish a new
 *    version as a new row (Aina Admin → Legal documents).
 *  - A firm that bought online is in SETUP until it finishes the wizard
 *    (tenants.onboarding_required && onboarded_at IS NULL): every page but
 *    Billing, Support and sign-out sends it to /onboarding/setup.
 *  - A firm that has accepted some version of a document must accept a NEWER
 *    published version at its next sign-in (RE-ACCEPT, same gate). Firms that
 *    never went through the wizard (created before it existed, or by Aina)
 *    are not stopped by a document they were never asked to accept.
 */

import crypto from "node:crypto";
import { cache } from "react";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withTenant } from "@/db/client";

export type LegalKind = "terms" | "nda";
export const LEGAL_KINDS: readonly LegalKind[] = ["terms", "nda"] as const;
export const LEGAL_KIND_LABEL: Record<LegalKind, string> = { terms: "Terms of Service", nda: "Non-Disclosure Agreement" };

export type CurrentDoc = { id: string; kind: LegalKind; version: number; title: string; body: string; bodySha256: string; reviewNote: string | null; publishedAt: string };

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** Pure: which kinds the firm still has to accept. */
export function pendingLegalKinds(
  current: Array<{ kind: LegalKind; id: string }>,
  accepted: Array<{ kind: LegalKind; documentId: string }>,
  inSetup: boolean
): LegalKind[] {
  const out: LegalKind[] = [];
  for (const doc of current) {
    const mine = accepted.filter((a) => a.kind === doc.kind);
    const hasCurrent = mine.some((a) => a.documentId === doc.id);
    if (hasCurrent) continue;
    if (inSetup || mine.length > 0) out.push(doc.kind);
  }
  return out.sort((a, b) => LEGAL_KINDS.indexOf(a) - LEGAL_KINDS.indexOf(b));
}

export async function currentDocuments(tx: Tx): Promise<CurrentDoc[]> {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT ON (kind) id, kind, version, title, body, body_sha256, review_note, published_at
      FROM legal_documents WHERE status = 'published'
     ORDER BY kind, version DESC
  `)).rows as Array<{ id: string; kind: LegalKind; version: number; title: string; body: string; body_sha256: string; review_note: string | null; published_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    version: Number(r.version),
    title: r.title,
    body: r.body,
    bodySha256: r.body_sha256,
    reviewNote: r.review_note,
    publishedAt: new Date(r.published_at).toISOString(),
  }));
}

export async function firmAcceptances(tx: Tx, tenantId: string) {
  return (await tx.execute(sql`
    SELECT id, kind, version, document_id, signer_name, designation, email, accepted_at, otp_verified
      FROM legal_acceptances WHERE tenant_id = ${tenantId}::uuid ORDER BY accepted_at
  `)).rows as Array<{ id: string; kind: LegalKind; version: number; document_id: string; signer_name: string; designation: string | null; email: string; accepted_at: string; otp_verified: boolean }>;
}

export type OnboardingGate = {
  /** setup = the wizard; reaccept = only new legal versions; null = nothing to do. */
  mode: "setup" | "reaccept" | null;
  pending: LegalKind[];
  onboardedAt: string | null;
};

async function loadGate(tenantId: string): Promise<OnboardingGate> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const t = (await tx.execute(sql`SELECT onboarding_required, onboarded_at FROM tenants WHERE id = ${tenantId}::uuid`)).rows[0] as
        | { onboarding_required: boolean; onboarded_at: string | null }
        | undefined;
      if (!t) return { mode: null, pending: [], onboardedAt: null };
      const inSetup = !!t.onboarding_required && !t.onboarded_at;
      const current = await currentDocuments(tx);
      const accepted = (await firmAcceptances(tx, tenantId)).map((a) => ({ kind: a.kind, documentId: a.document_id }));
      const pending = pendingLegalKinds(current, accepted, inSetup);
      return {
        mode: inSetup ? "setup" : pending.length ? "reaccept" : null,
        pending,
        onboardedAt: t.onboarded_at ? new Date(t.onboarded_at).toISOString() : null,
      };
    });
  } catch (err) {
    // The gate must never take the app down (e.g. before migration 0266).
    console.error("[onboarding-gate] could not read:", (err as Error)?.message);
    return { mode: null, pending: [], onboardedAt: null };
  }
}

/** Per-request memoised (the layout and the wizard page both ask). */
export const onboardingGate = cache(loadGate);

/** Paths a firm in setup may still open. */
export function isPathAllowedDuringSetup(pathname: string): boolean {
  return (
    pathname === "/dashboard/billing" ||
    pathname.startsWith("/dashboard/billing/") ||
    pathname === "/dashboard/support" ||
    pathname.startsWith("/dashboard/support/")
  );
}

/** Body text → blocks for display: "## " headings, "- " bullets, paragraphs. */
export type LegalBlock = { type: "h"; text: string } | { type: "p"; text: string } | { type: "li"; items: string[] };
export function legalBlocks(body: string): LegalBlock[] {
  const out: LegalBlock[] = [];
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) out.push({ type: "h", text: line.slice(3) });
    else if (line.startsWith("- ")) {
      const last = out[out.length - 1];
      if (last?.type === "li") last.items.push(line.slice(2));
      else out.push({ type: "li", items: [line.slice(2)] });
    } else out.push({ type: "p", text: line });
  }
  return out;
}
