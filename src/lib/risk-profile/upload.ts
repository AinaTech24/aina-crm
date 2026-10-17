/**
 * Recording a risk profile a client already holds — done elsewhere (another
 * distributor, a signed paper form) — by uploading its PDF with what it says:
 * the category, the score, when it was assessed and when it expires.
 *
 * It is evidence, not a questionnaire: the client is not re-asked anything and
 * no answers are invented. The response row is kept in the client's history
 * like any other (verification `client_physical`, basis `uploaded`), and when
 * it is the client's newest profile it becomes their current one — category,
 * score, signed date and the stated expiry (lib/risk-profile/expiry.ts).
 *
 * Plain functions over a transaction, so the API route stays thin and the rules
 * are tested directly (tests/risk-profile-upload.test.ts).
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Tx } from "@/db/client";
import { eventsOutbox, investors, riskProfileResponses } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { guardianMinorSql, guardianVerifiedForMf, GUARDIAN_PENDING_MESSAGE } from "@/lib/investors/guardian-verification";
import { suitabilityProfile } from "@/lib/risk-profile/own-assessment";
import { sql } from "drizzle-orm";

export const UPLOAD_CATEGORIES = ["conservative", "moderate", "aggressive", "very_aggressive"] as const;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-15").refine((v) => !Number.isNaN(Date.parse(v + "T00:00:00Z")), "Not a real date");

export const UploadFieldsSchema = z.object({
  investorId: z.string().uuid(),
  category: z.enum(UPLOAD_CATEGORIES),
  // Other distributors score on their own scales, so this firm's questionnaire range is not imposed.
  score: z.coerce.number().int("The score is a whole number").min(0).max(1000),
  assessedOn: isoDay,
  expiresOn: isoDay,
  assessedBy: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(1000).optional(),
});
export type UploadFields = z.infer<typeof UploadFieldsSchema>;

const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** Problems with the two dates, or null. `today` is the India date (YYYY-MM-DD). */
export function validateUploadDates(assessedOn: string, expiresOn: string, today: string): string | null {
  if (assessedOn > today) return "The profile cannot have been assessed in the future.";
  if (expiresOn <= assessedOn) return "Expire On must be after the date it was assessed.";
  if (expiresOn > addDays(assessedOn, 366 * 10)) return "Expire On is more than ten years after the assessment — check the date.";
  return null;
}

const refuse = (message: string, status: number) => Object.assign(new Error(message), { status });

export type CurrentRiskProfile = {
  category: string | null;
  score: number | null;
  signedAt: string | null;
  expiresOn: string | null;
  provisional: boolean;
};

export type UploadResult = {
  id: string;
  /** True when it became the client's current profile; false when a newer one already stands. */
  becameCurrent: boolean;
  /** True when its expiry has already passed. */
  alreadyExpired: boolean;
};

/**
 * Record the upload. The caller has already stored the PDF (`documentKey`) and
 * checked that the viewer may see this client.
 */
export async function recordUploadedRiskProfile(
  tx: Tx,
  args: {
    tenantId: string;
    userId: string;
    investor: { id: string; name: string; investorCategory?: string | null; guardianInvestorId?: string | null; riskProfileSignedAt?: Date | string | null; riskProfileVersion?: number | null };
    fields: UploadFields;
    documentKey: string;
    today: string;
    clientMeta?: Record<string, unknown>;
  },
): Promise<UploadResult> {
  const { tenantId, userId, investor, fields, documentKey, today } = args;

  // A minor's assessment belongs to the MINOR'S ACCOUNT (G-1, the owner's interim
  // policy): it is recorded here, on the minor, never on the guardian — and only
  // while the minor has a verified guardian (a valid linked client), through
  // whom it is given. A linked guardian is no reason to refuse.
  const isMinor = !!(await tx.execute(sql`
    SELECT ${guardianMinorSql("i")} AS m FROM investors i WHERE i.tenant_id = ${tenantId}::uuid AND i.id = ${investor.id}::uuid`)).rows[0]?.m;
  if (isMinor && !(await guardianVerifiedForMf(tx, tenantId, investor.id))) {
    throw refuse(`${GUARDIAN_PENDING_MESSAGE} A minor's risk profile can be recorded once the guardian is verified.`, 409);
  }
  const dateError = validateUploadDates(fields.assessedOn, fields.expiresOn, today);
  if (dateError) throw refuse(dateError, 400);

  const signedAt = new Date(`${fields.assessedOn}T12:00:00Z`);
  const id = uuid();
  const remarks = [fields.assessedBy ? `Assessed by ${fields.assessedBy}` : null, fields.remarks || null].filter(Boolean).join(" — ") || null;

  await tx.insert(riskProfileResponses).values({
    id,
    tenantId,
    investorId: investor.id,
    profileDate: fields.assessedOn,
    finalCategory: fields.category,
    totalScore: fields.score,
    responses: [],
    documentUrl: documentKey,
    signedAt,
    signedByName: investor.name,
    nextReviewAt: fields.expiresOn,
    rmRemarks: isMinor ? ["Assessment of the minor's own account", remarks].filter(Boolean).join(" — ") : remarks,
    verificationMethod: "client_physical",
    createdById: userId,
    provisional: false,
    basis: "uploaded",
  } as any);

  // Newest wins: an older profile uploaded late is kept in the history only.
  // A minor's "current" is the minor's own latest assessment — never the
  // guardian's signed date that migrations 0234 / 0236 copy onto the row.
  const ownSigned = isMinor ? (await suitabilityProfile(tx, tenantId, investor.id)).signedAt : null;
  const currentSignedRaw = isMinor ? ownSigned : investor.riskProfileSignedAt;
  const currentSigned = currentSignedRaw ? new Date(currentSignedRaw).getTime() : null;
  const becameCurrent = currentSigned == null || signedAt.getTime() >= currentSigned;
  if (becameCurrent) {
    await tx
      .update(investors)
      .set({
        riskProfile: fields.category,
        riskProfileScore: fields.score,
        riskProfileSignedAt: signedAt,
        riskProfileExpiresOn: fields.expiresOn,
        riskProfileExpiryFor: signedAt,
        riskProfileProvisional: false,
        riskProfileVersion: (investor.riskProfileVersion ?? 0) + 1,
        updatedAt: new Date(),
      } as any)
      .where(eq(investors.id, investor.id));
  }

  // "uploaded", not "completed": the client did not just answer a questionnaire,
  // so nothing that thanks a client for completing one should fire.
  await tx.insert(eventsOutbox).values({
    tenantId,
    kind: "risk_profile.uploaded",
    entityType: "investor",
    entityId: investor.id,
    after: { profileId: id, category: fields.category, score: fields.score, assessedOn: fields.assessedOn, expiresOn: fields.expiresOn, becameCurrent },
    meta: { userId } as any,
  } as any);

  await recordAudit(tx, {
    tenantId,
    actorUserId: userId,
    action: "risk_profile.upload",
    entityType: "risk_profile_response",
    entityId: id,
    after: { investorId: investor.id, category: fields.category, score: fields.score, assessedOn: fields.assessedOn, expiresOn: fields.expiresOn, becameCurrent,
             ...(isMinor ? { forMinorAccount: true, guardianInvestorId: investor.guardianInvestorId ?? null } : {}) } as any,
    ...(args.clientMeta ?? {}),
  } as any);

  return { id, becameCurrent, alreadyExpired: fields.expiresOn < today };
}
