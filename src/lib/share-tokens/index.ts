/**
 * Share-token helpers.
 *
 * createShareToken — RM-side: generates plaintext + persists the hash.
 *   Returns { token, url } once. The plaintext is never stored.
 *
 * resolveShareToken — public-form-side: hashes the URL token and looks it up
 *   in the system (cross-tenant) context. Validates not expired, not used,
 *   not revoked.
 *
 * markShareTokenUsed — public-form-side: stamps used_at + stores the result
 *   payload (form submission JSON).
 */

import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { shareTokens } from "@/db/schema";

export type ShareTokenKind = "risk_profile" | "document_collection" | "proposal_approval" | "onboarding_progress";
export type ShareTokenSubjectType = "lead" | "investor" | "proposal";

export interface CreateShareTokenInput {
  tenantId: string;
  kind: ShareTokenKind;
  subjectType: ShareTokenSubjectType;
  subjectId: string;
  payload?: Record<string, unknown>;
  expiresInDays?: number;
  createdBy?: string;
}

export interface CreateShareTokenResult {
  id: string;
  token: string;
  url: string;
  expiresAt: Date;
}

/** Per-kind URL path prefix on the public form site. */
const KIND_TO_PATH: Record<ShareTokenKind, string> = {
  risk_profile: "/r",
  document_collection: "/d",
  proposal_approval: "/p",
  onboarding_progress: "/onboarding",
};

export async function createShareToken(input: CreateShareTokenInput): Promise<CreateShareTokenResult> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 7) * 24 * 60 * 60 * 1000);

  const row = await withTenant(input.tenantId, async (tx) => {
    const [inserted] = await tx
      .insert(shareTokens)
      .values({
        tenantId: input.tenantId,
        kind: input.kind,
        tokenHash,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: input.payload ?? null,
        expiresAt,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return inserted;
  });

  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    id: row.id,
    token,
    url: `${base}${KIND_TO_PATH[input.kind]}/${token}`,
    expiresAt,
  };
}

/**
 * Resolve a public-form token. Runs in withSystem (cross-tenant) because the
 * client clicking the link is unauthenticated. Returns the underlying row +
 * validates that it's usable; throws on any issue.
 */
export async function resolveShareToken(token: string): Promise<{
  id: string;
  tenantId: string;
  kind: ShareTokenKind;
  subjectType: ShareTokenSubjectType;
  subjectId: string;
  payload: Record<string, unknown> | null;
  expiresAt: Date;
}> {
  if (!token || token.length < 16) throw new Error("Invalid token");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const row = await withSystem(async (tx) => {
    const [r] = await tx.select().from(shareTokens).where(eq(shareTokens.tokenHash, tokenHash)).limit(1);
    return r;
  });
  if (!row) throw new Error("Token not found");
  if (row.revokedAt) throw new Error("This link was revoked");
  if (row.usedAt && row.kind !== "onboarding_progress") throw new Error("This link has already been used");
  if (new Date(row.expiresAt as any) < new Date()) throw new Error("This link has expired");
  return {
    id: row.id,
    tenantId: row.tenantId!,
    kind: row.kind as ShareTokenKind,
    subjectType: row.subjectType as ShareTokenSubjectType,
    subjectId: row.subjectId,
    payload: (row.payload as any) ?? null,
    expiresAt: row.expiresAt as any,
  };
}

/** Stamp the token used + store the form submission result. */
export async function markShareTokenUsed(opts: {
  id: string;
  result: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await withSystem(async (tx) => {
    await tx
      .update(shareTokens)
      .set({
        usedAt: new Date(),
        result: opts.result as any,
        lastSeenIp: opts.ipAddress ?? null,
        lastSeenUserAgent: opts.userAgent ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(shareTokens.id, opts.id), isNull(shareTokens.usedAt)));
  });
}

/** Look up active (unused, unexpired) tokens for a subject — for the lead
 *  detail page to show "1 share link pending". */
export async function listActiveTokens(tenantId: string, subjectType: ShareTokenSubjectType, subjectId: string) {
  return withTenant(tenantId, async (tx) => {
    return tx
      .select()
      .from(shareTokens)
      .where(
        and(
          eq(shareTokens.subjectType, subjectType),
          eq(shareTokens.subjectId, subjectId),
          isNull(shareTokens.usedAt),
          isNull(shareTokens.revokedAt)
        )
      );
  });
}
