/**
 * Saved "Get pricing" quotes (pricing_quotes, platform-level, migration 0265).
 *
 * Every request is saved. The browser gets the quote id plus a random claim
 * token (only its SHA-256 is stored), so the account-creation step can carry
 * the quote's AUM and users without anyone being able to claim another
 * person's quote by guessing an id. The price itself is always recomputed on
 * the server from the inputs; the stored figures are the record of what was
 * shown.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { quoteOffered, tierFor, type CycleKey, type CycleQuote, type PricingSettings } from "./aum-pricing";
import type { QuoteRequest } from "./quote-request";

export type StoredQuote = {
  /** The packages this firm may buy (`cyclesOffered`): commitment + yearly for a first purchase. */
  cycles: CycleQuote[];
  firstPurchase: boolean;
  commitmentMonths: number;
  tierKey: string;
  tierLabel: string;
  gstBp: number;
  perUserYearlyPaise: number;
};

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** IPs are kept only as a keyed hash — enough to spot abuse, not to identify anyone. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const key = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "aina";
  return crypto.createHmac("sha256", key).update(ip).digest("hex").slice(0, 32);
}

export function buildStoredQuote(req: { aumCrore: number; users: number }, s: PricingSettings, opts: { firstPurchase: boolean }): StoredQuote {
  const tier = tierFor(req.aumCrore, s);
  return {
    cycles: quoteOffered(req, opts.firstPurchase, s),
    firstPurchase: opts.firstPurchase && s.firstPurchaseCommitment,
    commitmentMonths: s.cycles.commitment.months,
    tierKey: tier.key,
    tierLabel: tier.label,
    gstBp: s.gstBp,
    perUserYearlyPaise: s.perUserYearlyPaise,
  };
}

/** Insert the quote. Run inside withSystem (pricing_quotes is platform-admin only under RLS). */
export async function saveQuote(
  tx: Tx,
  req: QuoteRequest,
  stored: StoredQuote,
  meta: { ip: string | null; userAgent: string | null; source?: "pricing" | "billing" }
): Promise<{ id: string; token: string }> {
  const token = crypto.randomBytes(24).toString("base64url");
  const r = await tx.execute(sql`
    INSERT INTO pricing_quotes (contact_name, firm_name, email, mobile, arn, aum_crore, users, quote,
                                claim_token_hash, ip_hash, user_agent, source)
    VALUES (${req.contactName}, ${req.firmName}, ${req.email}, ${req.mobile}, ${req.arn}, ${req.aumCrore},
            ${req.users}, ${JSON.stringify(stored)}::jsonb, ${hashToken(token)}, ${hashIp(meta.ip)},
            ${(meta.userAgent ?? "").slice(0, 300) || null}, ${meta.source ?? "pricing"})
    RETURNING id
  `);
  return { id: String((r.rows[0] as { id: string }).id), token };
}

export type ClaimedQuote = QuoteRequest & { id: string; convertedTenantId: string | null; mobileVerifiedAt: Date | null };

const sameHash = (a: string, b: unknown) => {
  const x = Buffer.from(a);
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * The quote, only when the token matches (constant-time) — the browser's claim
 * token, or the resume token from the follow-up email (`issueResumeToken`).
 */
export async function loadQuoteByToken(tx: Tx, quoteId: string, token: string): Promise<ClaimedQuote | null> {
  if (!/^[0-9a-f-]{36}$/i.test(quoteId) || !token) return null;
  const r = await tx.execute(sql`
    SELECT id, contact_name, firm_name, email, mobile, arn, aum_crore, users, claim_token_hash, resume_token_hash,
           converted_tenant_id, mobile_verified_at
      FROM pricing_quotes WHERE id = ${quoteId}::uuid LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const h = hashToken(token);
  // Both compared every time, so the time taken says nothing about which one matched.
  const claim = sameHash(h, row.claim_token_hash);
  const resume = row.resume_token_hash ? sameHash(h, row.resume_token_hash) : false;
  if (!claim && !resume) return null;
  return {
    id: String(row.id),
    contactName: String(row.contact_name),
    firmName: String(row.firm_name),
    email: String(row.email),
    mobile: String(row.mobile),
    arn: (row.arn as string | null) ?? null,
    aumCrore: Number(row.aum_crore),
    users: Number(row.users),
    convertedTenantId: (row.converted_tenant_id as string | null) ?? null,
    mobileVerifiedAt: row.mobile_verified_at ? new Date(String(row.mobile_verified_at)) : null,
  };
}

/** A fresh resume token for the follow-up email's link; only its hash is kept. */
export async function issueResumeToken(tx: Tx, quoteId: string): Promise<string> {
  const token = crypto.randomBytes(24).toString("base64url");
  await tx.execute(sql`UPDATE pricing_quotes SET resume_token_hash = ${hashToken(token)}, updated_at = now() WHERE id = ${quoteId}::uuid`);
  return token;
}

/** The resume link a quote's follow-up email carries. */
export function resumeLink(baseUrl: string, quoteId: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/pricing?quote=${encodeURIComponent(quoteId)}&t=${encodeURIComponent(token)}`;
}

export type ResumeForm = { aumCrore: string; users: string; contactName: string; firmName: string; email: string; mobile: string; arn: string };

export type ResumedQuote =
  | { kind: "converted" }
  | ({
      kind: "open";
      quoteId: string;
      token: string;
      onlineSignup: boolean;
      mobileVerified: boolean;
      /** What the details step showed, so "Edit details" works after a resume. */
      form: ResumeForm;
    } & StoredQuote);

/**
 * Pure: what GET /api/public/pricing/quote answers for a saved quote. The
 * packages are RE-PRICED from the saved AUM and users with the settings in
 * force NOW — a price shown last week is never honoured just because it was
 * shown, and nothing comes from the browser but the id and the token.
 */
export function resumeQuote(q: ClaimedQuote, token: string, s: PricingSettings): ResumedQuote {
  if (q.convertedTenantId) return { kind: "converted" };
  return {
    kind: "open",
    quoteId: q.id,
    token,
    onlineSignup: s.onlineSignup,
    mobileVerified: !!q.mobileVerifiedAt,
    form: {
      aumCrore: String(q.aumCrore),
      users: String(q.users),
      contactName: q.contactName,
      firmName: q.firmName,
      email: q.email,
      mobile: q.mobile.replace(/^\+91/, ""),
      arn: q.arn ?? "",
    },
    ...buildStoredQuote({ aumCrore: q.aumCrore, users: q.users }, s, { firstPurchase: true }),
  };
}

export async function markQuoteChosen(tx: Tx, quoteId: string, cycle: CycleKey, tenantId: string | null) {
  await tx.execute(sql`
    UPDATE pricing_quotes
       SET chosen_cycle = ${cycle}, chosen_at = now(),
           converted_tenant_id = COALESCE(${tenantId}::uuid, converted_tenant_id),
           converted_at = CASE WHEN ${tenantId}::uuid IS NOT NULL THEN COALESCE(converted_at, now()) ELSE converted_at END,
           updated_at = now()
     WHERE id = ${quoteId}::uuid
  `);
}

export async function markQuotePaid(tx: Tx, quoteId: string) {
  await tx.execute(sql`UPDATE pricing_quotes SET paid_at = COALESCE(paid_at, now()), updated_at = now() WHERE id = ${quoteId}::uuid`);
}
