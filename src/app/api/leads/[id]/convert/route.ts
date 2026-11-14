import { handleApiError, isUniqueViolation } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/convert
 * Body: { pan?, segmentTag?, investorCategory?, rmId?, notes?, confirmWon?, confirmNotDuplicate? }
 *
 * Converts a WON lead into a client:
 *   0. Gates: the caller may create clients (investor.edit.*), the journey is
 *      at Won Lead or already in onboarding — or `confirmWon` (the Leads
 *      board's drop on Won, which the person confirmed) marks it Won first.
 *   1. Looks for the client already on file — by PAN, then mobile / email —
 *      and answers 409 `existing_client` instead of a second record (the
 *      same visibility rule as check-duplicate: a client outside the
 *      caller's book is reported only as existing). A mobile / email match
 *      can be overridden with `confirmNotDuplicate` (families share them); a
 *      PAN match cannot.
 *   2. Creates the client from everything the lead holds (PAN defaults to the
 *      lead's, pincode, alternate contacts, occupation, photo, referrer, the
 *      lead type as client type) under the client-type rules.
 *   3. Stamps the lead converted, carries its records over, cancels its
 *      follow-up / call-back tasks (lib/leads/open-tasks.ts) and starts the
 *      product's onboarding (insurance → Needs Analysis, else Request
 *      Documents) — forward-only, so a journey already further on stays.
 *   4. Emits 'lead.converted' + 'investor.created'.
 *
 * Returns { investorId, warnings[] } so the UI can redirect and say what did
 * not carry over.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense, assertInvestorQuota } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { autoAdvance } from "@/lib/blueprints/auto-advance";
import { transitionTo } from "@/lib/blueprints/engine";
import { isClientPhaseStage } from "@/lib/blueprints/journey-rules";
import { loadEditableLead } from "@/lib/leads/access";
import { normalizeLeadStage, normalizePan } from "@/lib/leads/normalize";
import { closeLeadTasks } from "@/lib/leads/open-tasks";
import { mapKycFieldsToInvestorUpdate } from "@/lib/onboarding/kyc-fields";
import {
  CLIENT_TYPE_KEYS,
  cleanTypeDetails,
  defaultTaxStatus,
  singleHoldingOnly,
  type ClientType,
} from "@/lib/investors/client-types";
import { can, requireAny } from "@/lib/auth/rbac";
import { investorScopeSql } from "@/lib/investors/access";
import { existingClientForPan } from "@/lib/investors/client-return";
import {
  leads,
  investors,
  users,
  eventsOutbox,
  riskProfileResponses,
  proposals,
  complianceDocuments,
  communications,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  // PAN is OPTIONAL — it's often captured after KYC docs are received. If
  // provided it must be a valid PAN; blank/omitted converts the lead PAN-less
  // (the owner fills it in later from the client master).
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F")
    .optional()
    .or(z.literal("")),
  segmentTag: z.enum(["HNI", "Affluent", "Retail", "NRI", "Corporate"]).optional(),
  investorCategory: z.enum(CLIENT_TYPE_KEYS).optional(),
  rmId: z.string().uuid().optional(),
  notes: z.string().optional(),
  /** The person confirmed winning the lead as they convert it (the Leads
   *  board's drop on Won). Without it the journey must already be Won. */
  confirmWon: z.boolean().optional(),
  /** A mobile / email match was looked at and is someone else (families
   *  share them). Never overrides a PAN match. */
  confirmNotDuplicate: z.boolean().optional(),
});

/** The lead's type, as the client type it becomes. */
const LEAD_TYPE_TO_CLIENT: Record<string, ClientType> = {
  individual: "individual", hni: "individual", nri: "nri", huf: "huf", corporate: "company", minor: "minor",
};
const LEAD_TYPE_TO_SEGMENT: Record<string, "HNI" | "NRI" | "Corporate"> = { hni: "HNI", nri: "NRI", corporate: "Corporate" };

type ExistingMatch = {
  id: string | null;
  name: string | null;
  state: "trash" | "exited" | "active";
  matchedOn: Array<"pan" | "phone" | "email">;
  outsideBook?: true;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  try {
    const session = await requireSession();
    // Converting creates a client: the same capability as Add client.
    requireAny(session.roles, ["investor.edit.all", "investor.edit.assigned"], session.permissions);
    const canAssignAnyRm = can(session.roles, "investor.edit.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    // Converting a lead creates a client — count it against the plan cap.
    await assertInvestorQuota(session.tenantId, session.roles, 1);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;

    const investorId = uuid();

    const result = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, leadId);
      if (lead.convertedInvestorId) {
        // Idempotent — return the existing investor
        return { investorId: lead.convertedInvestorId, alreadyConverted: true };
      }
      // ── Stage gate: only a Won lead (or one already in onboarding) ──
      const cur = (await tx.execute(sql`
        SELECT current_stage_key FROM lead_blueprint_instances
         WHERE lead_id = ${leadId}::uuid AND tenant_id = ${session.tenantId}::uuid LIMIT 1
      `)).rows[0] as { current_stage_key?: string } | undefined;
      const currentKey = cur?.current_stage_key ?? normalizeLeadStage(lead.stage);
      const ready = currentKey === "won_lead" || isClientPhaseStage(currentKey);
      if (!ready) {
        if (!body.confirmWon) return { notWon: true as const, stage: currentKey };
        const won = await transitionTo(tx, session.tenantId, leadId, "won_lead", {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          systemBypass: true,
          remarks: "Marked Won while converting to a client (Leads board).",
          ...clientMeta,
        });
        if (!won.ok) return { notWon: true as const, stage: currentKey, reason: won.reason };
      }

      // RM — the Add client rule: someone who may assign any RM picks one
      // (default: the lead's owner); everyone else converts into their own book.
      if (body.rmId && canAssignAnyRm) {
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, body.rmId), eq(users.tenantId, session.tenantId)))
          .limit(1);
        if (!u) return { badRm: true as const };
      }
      const rmId = canAssignAnyRm ? (body.rmId ?? lead.ownerId ?? session.userId) : session.userId;

      // Client type: what was chosen, else the lead's type; the client-type
      // rules decide holding, tax status and type details (client-types.ts).
      const leadType = (lead as any).leadType as string | null;
      const category: ClientType = body.investorCategory ?? (leadType ? LEAD_TYPE_TO_CLIENT[leadType] : undefined) ?? "individual";
      const segmentTag = body.segmentTag ?? (leadType ? LEAD_TYPE_TO_SEGMENT[leadType] : undefined) ?? "Retail";

      // PAN: the one typed, else the lead's own. A minor is filed the way Add
      // client files one (MINOR:<own PAN>).
      const typed = body.pan && body.pan.trim() ? normalizePan(body.pan) : null;
      const plainPan = typed ?? normalizePan(lead.pan);
      const pan = plainPan ? (category === "minor" ? `MINOR:${plainPan}` : plainPan) : null;

      // ── The client may already be on file ──
      const existing = await findExistingClient(tx, session, {
        pans: plainPan ? [plainPan, `MINOR:${plainPan}`] : [],
        phone: lead.phone,
        email: lead.email,
      });
      if (existing && (existing.matchedOn.includes("pan") || !body.confirmNotDuplicate)) {
        return { existingClient: existing };
      }

      // Create investor
      const inserted = await tx
        .insert(investors)
        .values({
          id: investorId,
          tenantId: session.tenantId,
          branchId: lead.branchId ?? session.branchId,
          name: lead.name,
          pan,
          email: lead.email,
          phone: lead.phone,
          whatsappPhone: lead.phone,
          alternatePhone: (lead as any).altPhone ?? null,
          avatarUrl: (lead as any).avatarUrl ?? null,
          occupation: ((lead as any).profile?.occupation as string | undefined)?.trim() || null,
          address: lead.city || lead.pincode
            ? ({ ...(lead.city ? { city: lead.city } : {}), ...(lead.pincode ? { pincode: lead.pincode } : {}), country: "India" } as any)
            : null,
          segmentTag,
          investorCategory: category,
          isMinor: category === "minor",
          modeOfHolding: singleHoldingOnly(category) ? "single" : undefined,
          taxStatus: defaultTaxStatus(category) || null,
          typeDetails: cleanTypeDetails(category, {}),
          // Carry the referral forward — this is the referee's own profile
          // now: the name the lead recorded, else the referring client's.
          referralClientName: lead.referredByName ?? (await referrerName(tx, (lead as any).referredByInvestorId)),
          rmId,
          status: "active",
          onboardedAt: new Date(),
          notes: body.notes ?? lead.notes ?? null,
          kycStatus: "pending",
        } as any)
        .returning();

      // Stamp lead
      await tx
        .update(leads)
        .set({
          stage: "converted",
          stageChangedAt: new Date(),
          ...(plainPan && plainPan !== lead.pan ? { pan: plainPan } : {}),
          convertedInvestorId: investorId,
          convertedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(leads.id, leadId));

      const warnings: string[] = [];

      // ─── DATA CARRYOVER ──────────────────────────────────────────────
      // Per the spec: no data should be lost on conversion. We re-point
      // every related record from the lead onto the new investor.
      //
      // CRITICAL: the whole carryover runs inside a SAVEPOINT (nested tx) so
      // a DB-level error in any single step — a column/table mismatch, a
      // constraint, a statement timeout — rolls back ONLY the carryover, not
      // the parent transaction. Without this isolation, a thrown SQL error
      // here would abort the entire Postgres tx, the investor INSERT would
      // never commit, and the API would return a bare "internal" 500 with no
      // client created. The client being created is far more important than a
      // perfect carryover; a partial-carryover failure is logged, not fatal.
      try {
        await tx.transaction(async (sp) => {
          // 1. Risk profile responses — the lead's responses used `lead_id` in
          //    `investor_id` polymorphically (see /api/public/risk-profile/submit).
          //    Repoint to the actual investor so investor.riskProfile lines up.
          const carriedRpr = await sp.execute(sql`
            UPDATE risk_profile_responses
               SET investor_id = ${investorId}::uuid,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND investor_id = ${leadId}::uuid
            RETURNING id, final_category, total_score, signed_at
          `);
          const latestRisk = (carriedRpr.rows as any[])[0];
          if (latestRisk) {
            // signed_at comes back as a string from raw sp.execute (Postgres
            // formatted timestamp). Drizzle's update on a timestamp column
            // calls value.toISOString() — so we MUST hand it a real Date.
            const signedAt = latestRisk.signed_at ? new Date(latestRisk.signed_at) : null;
            await sp
              .update(investors)
              .set({
                riskProfile: latestRisk.final_category as any,
                riskProfileScore: Number(latestRisk.total_score),
                riskProfileSignedAt: signedAt,
                updatedAt: new Date(),
              } as any)
              .where(eq(investors.id, investorId));
          }

          // 2. Proposals — re-point lead-bound proposals to carry the investor
          await sp
            .update(proposals)
            .set({ investorId, recipientType: "investor" as any, updatedAt: new Date() } as any)
            .where(eq(proposals.leadId, leadId));

          // 3. Compliance documents (KYC uploads) — were saved with
          //    related_entity_type='lead' + related_entity_id=leadId. Move them.
          await sp.execute(sql`
            UPDATE compliance_documents
               SET related_entity_type = 'investor',
                   related_entity_id = ${investorId}::uuid,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND related_entity_type = 'lead'
               AND related_entity_id = ${leadId}::uuid
          `);

          // 4. Communications — set investor_id on lead-bound rows so the
          //    investor's timeline picks them up.
          await sp
            .update(communications)
            .set({ investorId, updatedAt: new Date() } as any)
            .where(eq(communications.leadId, leadId));

          // 5. Meetings (review_meetings) — repoint lead → investor.
          await sp.execute(sql`
            UPDATE review_meetings
               SET investor_id = ${investorId}::uuid,
                   lead_id = NULL,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND lead_id = ${leadId}::uuid
          `);

          // 6. Open share_tokens (proposal approval, doc collection, risk
          //    profile) pointing at the lead → repoint so links keep working.
          await sp.execute(sql`
            UPDATE share_tokens
               SET subject_type = 'investor',
                   subject_id = ${investorId}::uuid,
                   updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid
               AND subject_type = 'lead'
               AND subject_id = ${leadId}::uuid
               AND used_at IS NULL
          `);

          // 7. The lead's other open tasks are about the client now.
          await sp.execute(sql`
            UPDATE tasks SET related_investor_id = ${investorId}::uuid, updated_at = now()
             WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
               AND status NOT IN ('completed', 'cancelled') AND related_investor_id IS NULL
               AND (related_lead_id = ${leadId}::uuid OR (subject_type = 'lead' AND subject_id = ${leadId}::uuid))
          `);

          // 8. KYC data the client filled via the public onboarding link while
          //    still a lead → apply it to the new investor's client master.
          const kyc = (lead as any).kycData as Record<string, string> | null;
          if (kyc && Object.keys(kyc).length > 0) {
            const base = inserted[0] as any;
            const upd = mapKycFieldsToInvestorUpdate(kyc, {
              pan: base?.pan,
              email: base?.email,
              phone: base?.phone,
              whatsappPhone: base?.whatsappPhone,
              address: base?.address,
              bankAccounts: base?.bankAccounts,
              nominees: base?.nominees,
            });
            await sp
              .update(investors)
              .set({ ...upd, kycData: kyc, updatedAt: new Date() } as any)
              .where(eq(investors.id, investorId));
          }
        });
      } catch (carryErr) {
        console.warn(
          `[lead.convert] carryover failed for lead ${leadId} → investor ${investorId} (client still created):`,
          (carryErr as Error)?.message
        );
        warnings.push(
          "Some of the lead's records (risk profile, proposals, documents, messages, meetings, links or KYC details) could not be moved to the client. Check the client record and attach anything missing."
        );
      }

      // The lead's follow-up / call-back reminders were for a LEAD — cancel them.
      const closed = await closeLeadTasks(tx, session.tenantId, leadId, {
        status: "cancelled",
        reason: "Lead converted to a client — follow-up no longer needed.",
      });

      // Outbox events — let subscribed workflows kick in.
      // `inserted[0]` contains Date objects from Drizzle's returning(); we
      // round-trip through JSON.stringify so the JSONB column gets plain
      // ISO-string dates instead of native Date instances (which trip
      // Drizzle's value formatter inside jsonb: "value.toISOString is not
      // a function" on the next downstream consumer).
      const investorSnapshot = JSON.parse(JSON.stringify(inserted[0] ?? {}));
      await tx.insert(eventsOutbox).values([
        {
          tenantId: session.tenantId,
          kind: "lead.converted",
          entityType: "lead",
          entityId: leadId,
          after: { investorId } as any,
          meta: { userId: session.userId } as any,
        },
        {
          tenantId: session.tenantId,
          kind: "investor.created",
          entityType: "investor",
          entityId: investorId,
          after: investorSnapshot as any,
          meta: { userId: session.userId, source: "lead_conversion", leadId } as any,
        },
      ] as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "lead.convert",
        entityType: "lead",
        entityId: leadId,
        after: { investorId, leadName: lead.name, rmId, category, followUpsCancelled: closed.closed },
        ...clientMeta,
      });

      // Automatic tasks are disabled by firm preference. Keep referral context
      // in the conversion result; the RM may create a follow-up explicitly.
      const referralFollowUp = lead.referredByInvestorId
        ? { status: "disabled" as const, reason: "Automatic task creation is disabled", investorId: lead.referredByInvestorId }
        : null;
      // Start the product's onboarding (insurance → Needs Analysis, else
      // Request Documents). Automatic, so forward-only: a journey already at
      // Documents Pending (documents asked for before conversion) or further
      // stays where it is, and no second step task is created.
      const journey = await autoAdvance(tx, session.tenantId, leadId, "client.converted", {
        remarks: "Lead converted to client — entering onboarding phase.",
      });

      return { investorId, alreadyConverted: false, referralFollowUp, warnings, journey: journey.toStage };
    });

    if ("notWon" in result) {
      return NextResponse.json(
        {
          error: "Only a Won lead can be converted. Mark the lead Won first (or drop it on Won on the Leads board).",
          code: "not_won",
          stage: result.stage,
        },
        { status: 409 }
      );
    }
    if ("existingClient" in result) {
      const ex = result.existingClient!;
      const byPan = ex.matchedOn.includes("pan");
      return NextResponse.json(
        {
          error: byPan
            ? ex.state === "trash"
              ? "A client with this PAN is in the Trash. Restore them instead of creating a second record."
              : ex.state === "exited"
                ? "A client with this PAN is already in the CRM, marked as exited. Reactivate them instead."
                : "A client with this PAN already exists. Open that record, or start an opportunity on it for the new product."
            : `A client with the same ${ex.matchedOn.join(" and ")} already exists. Open that record or start an opportunity on it — or convert anyway if this is a different person.`,
          code: "existing_client",
          existing: ex,
          canOverride: !byPan,
        },
        { status: 409 }
      );
    }
    if ("badRm" in result) {
      return NextResponse.json({ error: "selected RM is not a user in this firm" }, { status: 400 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (isUniqueViolation(err, "investors_tenant_pan_unique")) {
      return NextResponse.json(
        { error: "An investor with this PAN already exists — use the existing record." },
        { status: 409 }
      );
    }
    return handleApiError(err);
  }
}


/** The referring client's name, when the lead recorded who referred them. */
async function referrerName(tx: any, investorId: string | null | undefined): Promise<string | null> {
  if (!investorId) return null;
  const r = await tx.execute(sql`SELECT name FROM investors WHERE id = ${investorId}::uuid LIMIT 1`);
  return ((r.rows[0] as { name?: string } | undefined)?.name ?? null) || null;
}

/**
 * A live client this lead already is — by PAN (merges followed, Trash and
 * exited included: lib/investors/client-return.ts), else by mobile / email.
 * A client outside the caller's book is reported only as existing (no id,
 * no name), as check-duplicate does.
 */
async function findExistingClient(
  tx: any,
  session: Awaited<ReturnType<typeof requireSession>>,
  q: { pans: string[]; phone: string | null; email: string | null },
): Promise<ExistingMatch | null> {
  for (const p of q.pans) {
    const visible = await investorScopeSql(tx, session, "i2").catch(() => sql`FALSE`);
    const hit = await existingClientForPan(tx, session.tenantId, p, visible);
    if (hit) {
      return hit.id
        ? { id: hit.id, name: hit.name, state: hit.state, matchedOn: ["pan"] }
        : { id: null, name: null, state: hit.state, matchedOn: ["pan"], outsideBook: true };
    }
  }
  const last10 = String(q.phone ?? "").replace(/\D/g, "").slice(-10);
  const email = String(q.email ?? "").trim().toLowerCase();
  const conds: any[] = [];
  if (last10.length === 10) conds.push(sql`right(regexp_replace(COALESCE(i.phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}`);
  if (email) conds.push(sql`lower(btrim(COALESCE(i.email, ''))) = ${email}`);
  if (!conds.length) return null;
  const visible = await investorScopeSql(tx, session, "i").catch(() => sql`FALSE`);
  const row = (await tx.execute(sql`
    SELECT i.id::text AS id, i.name, i.phone, i.email, (${visible}) AS visible
      FROM investors i
     WHERE i.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
       AND COALESCE(i.status, 'active') NOT IN ('closed', 'exited')
       AND (${sql.join(conds, sql` OR `)})
     ORDER BY i.aum DESC NULLS LAST
     LIMIT 1
  `)).rows[0] as { id: string; name: string; phone: string | null; email: string | null; visible: boolean } | undefined;
  if (!row) return null;
  const matchedOn: ExistingMatch["matchedOn"] = [];
  if (last10.length === 10 && String(row.phone ?? "").replace(/\D/g, "").slice(-10) === last10) matchedOn.push("phone");
  if (email && String(row.email ?? "").trim().toLowerCase() === email) matchedOn.push("email");
  return row.visible
    ? { id: row.id, name: row.name, state: "active", matchedOn }
    : { id: null, name: null, state: "active", matchedOn, outsideBook: true };
}
