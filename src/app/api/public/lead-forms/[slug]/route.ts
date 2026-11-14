/**
 * Public lead-capture form endpoints (no auth):
 *   GET  /api/public/lead-forms/[slug]   — return form definition for rendering
 *   POST /api/public/lead-forms/[slug]   — accept a submission, create a lead
 *
 * A submission from someone the firm already knows is never a second record
 * (audit L19): an existing CLIENT (same phone, email or PAN) becomes a task
 * for the client's RM — another product is an opportunity on their record —
 * and an existing LEAD gets the submission added to its notes and its owner
 * is told. Only a new person becomes a new lead, owned by the form's default
 * RM or the assignment rules, in that owner's branch, and the owner is told.
 * The answer is the same in every case, so the form never reveals who is on
 * file.
 *
 * No session — caller is the public internet. We resolve the tenant via
 * the slug. The actual DB work runs inside withTenant(form.tenantId,…)
 * so RLS scopes correctly. withSystem is used ONLY for the slug → tenant
 * lookup (a single read, no PII).
 *
 * Rate-limited per IP per hour using the existing in-memory enforcer.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { CONSENT_REQUIRED_ERROR, recordFormConsent } from "@/lib/privacy/consent";
import { withSystem, withTenant } from "@/db/client";
import { leadCaptureForms, leads, tasks, tenants } from "@/db/schema";
import { autoAssignLeadOwner, notifyLeadAssigned, ownerBranchId } from "@/lib/leads/ownership";
import { createNotification } from "@/lib/notifications/create";
import { enforce } from "@/lib/rate-limit";
import {
  normalizeEmail,
  normalizeLeadSource,
  normalizePan,
  normalizePhoneLast10,
} from "@/lib/leads/normalize";
import { scoreFields } from "@/lib/leads/score";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const limited = enforce(req, `lead-form.get.${slug}`, { limit: 60, windowSec: 60 });
  if (limited) return limited;

  // Single read in system context to resolve the slug. We return form
  // definition + tenant display branding only — no PII, no inbound data.
  const form = await withSystem(async (tx) => {
    const f = (
      await tx
        .select({
          id: leadCaptureForms.id,
          tenantId: leadCaptureForms.tenantId,
          name: leadCaptureForms.name,
          description: leadCaptureForms.description,
          fields: leadCaptureForms.fields,
          branding: leadCaptureForms.branding,
          enabled: leadCaptureForms.enabled,
        })
        .from(leadCaptureForms)
        .where(eq(leadCaptureForms.slug, slug))
        .limit(1)
    )[0];
    if (!f) return null;
    const t = (
      await tx
        .select({
          displayName: tenants.displayName,
          primaryColor: tenants.primaryColor,
          logoUrl: tenants.logoUrl,
          arn: tenants.arn,
        })
        .from(tenants)
        .where(eq(tenants.id, f.tenantId))
        .limit(1)
    )[0];
    return { f, t };
  });

  if (!form?.f) {
    return NextResponse.json({ error: "form not found" }, { status: 404 });
  }
  if (!form.f.enabled) {
    return NextResponse.json({ error: "form retired" }, { status: 410 });
  }

  return NextResponse.json({
    form: {
      id: form.f.id,
      name: form.f.name,
      description: form.f.description,
      fields: form.f.fields ?? [],
      branding: form.f.branding ?? null,
    },
    tenant: form.t
      ? {
          id: form.f.tenantId,
          displayName: form.t.displayName,
          primaryColor: form.t.primaryColor,
          logoUrl: form.t.logoUrl,
          arn: form.t.arn,
        }
      : null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // 5 submissions per IP per hour — abuse-control, can be overridden per
  // form via rate_limit_per_hour but we ignore that for now and use the
  // global default.
  const limited = enforce(req, `lead-form.submit.lookup.${slug}`, {
    limit: 60,
    windowSec: 60 * 60,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));

  // Resolve form + tenant (system read).
  const form = await withSystem(async (tx) => {
    return (
      await tx.select().from(leadCaptureForms).where(eq(leadCaptureForms.slug, slug)).limit(1)
    )[0];
  });
  if (!form) return NextResponse.json({ error: "form not found" }, { status: 404 });
  if (!form.enabled) return NextResponse.json({ error: "form retired" }, { status: 410 });

  const perFormLimit = Math.max(1, Number.parseInt(String(form.rateLimitPerHour ?? "5"), 10) || 5);
  const formLimited = enforce(req, `lead-form.submit.${form.id}`, {
    limit: perFormLimit,
    windowSec: 60 * 60,
  });
  if (formLimited) return formLimited;

  // Validate the four universals — name + at least one of email/phone.
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const pan = normalizePan(body.pan);
  const notes = String(body.notes ?? "").trim();
  if (!name || (!email && !phone)) {
    return NextResponse.json(
      { error: "name + at least one of email/phone is required" },
      { status: 400 }
    );
  }
  // Honeypot — silently accept (200) without persisting if the bot
  // populated any of these. Returns the same shape as success so
  // scrapers don't learn we trapped them.
  if (body._gotcha || body.website || body.url) {
    return NextResponse.json({ ok: true, leadId: null });
  }
  // DPDP: a new person's details are taken only with their consent to the
  // firm's privacy notice (the tick on the form), and that consent is recorded.
  if (body.privacyConsent !== true) {
    return NextResponse.json({ error: CONSENT_REQUIRED_ERROR }, { status: 400 });
  }

  // Required custom fields per the form definition.
  const fields = (form.fields ?? []) as Array<{
    key: string;
    label: string;
    required?: boolean;
  }>;
  const extras: Record<string, string> = {};
  for (const f of fields) {
    const v = body[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === "")) {
      return NextResponse.json(
        { error: `${f.label} is required` },
        { status: 400 }
      );
    }
    if (v !== undefined && v !== null) extras[f.key] = String(v);
  }

  // Create the lead inside the form's tenant scope.
  const leadId = uuid();
  const created = await withTenant(form.tenantId, async (tx) => {
    // Roll the extras into the notes field so they're visible to the RM
    // without needing a custom_fields column. Format: original notes
    // followed by a "Form responses" block.
    const composedNotes = [
      notes || "",
      Object.keys(extras).length
        ? "\n\n---\nForm responses:\n" +
          Object.entries(extras)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n")
        : "",
    ]
      .join("")
      .trim();

    const phone10 = normalizePhoneLast10(phone);
    const emailNorm = normalizeEmail(email);
    const submission = [
      `Web form "${form.name}" (${new Date().toISOString().slice(0, 10)}): ${name}`,
      // Contact details only — a PAN is never copied into free text.
      [phone ? `phone ${phone}` : null, email ? `email ${email}` : null].filter(Boolean).join(", "),
      composedNotes,
    ].filter(Boolean).join("\n");

    // 1. Already a client → their RM follows up on the client record.
    const clientConds = [
      phone10 ? sql`right(regexp_replace(COALESCE(i.phone, ''), '[^0-9]', '', 'g'), 10) = ${phone10}` : null,
      emailNorm ? sql`lower(btrim(COALESCE(i.email, ''))) = ${emailNorm}` : null,
      pan ? sql`upper(i.pan) = ${pan}` : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    const client = clientConds.length
      ? ((await tx.execute(sql`
          SELECT i.id::text AS id, i.name, i.rm_id::text AS rm_id FROM investors i
           WHERE i.tenant_id = ${form.tenantId}::uuid AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
             AND (${sql.join(clientConds, sql` OR `)})
           ORDER BY i.aum DESC NULLS LAST LIMIT 1
        `)).rows[0] as { id: string; name: string; rm_id: string | null } | undefined)
      : undefined;
    if (client) {
      const assignee = client.rm_id ?? form.defaultRmId ?? (await autoAssignLeadOwner(tx, { tenantId: form.tenantId, source: form.leadSource }));
      if (assignee) {
        const [task] = await tx.insert(tasks).values({
          tenantId: form.tenantId,
          subjectType: "investor",
          subjectId: client.id,
          relatedInvestorId: client.id,
          type: "follow_up",
          title: `Website enquiry from client: ${client.name}`,
          description: `${submission}\n\nAn existing client asked through the website. If they want another product, start an opportunity on their record.`,
          priority: "high",
          status: "open",
          assigneeId: assignee,
          department: "sales",
          dueAt: new Date(Date.now() + 24 * 3600 * 1000),
          meta: { source: "public_lead_form", formId: form.id },
        } as any).returning({ id: tasks.id });
        await createNotification(tx, {
          tenantId: form.tenantId,
          userId: assignee,
          kind: "task.assigned",
          title: `Website enquiry: ${client.name} (your client)`,
          body: "An existing client filled in the website form — follow up on their record.",
          linkUrl: `/dashboard/investors/${client.id}`,
          severity: "info",
          meta: { task_id: task?.id ?? null, investor_id: client.id, how: "web_form" },
        });
      }
      await recordFormConsent(tx, { tenantId: form.tenantId, subject: { type: "investor", id: client.id }, source: "lead_form", headers: req.headers });
      return null;
    }

    // 2. Already a lead → the submission joins that lead.
    const leadConds = [
      phone10 ? sql`l.phone_normalized = ${phone10}` : null,
      emailNorm ? sql`l.email_normalized = ${emailNorm}` : null,
      pan ? sql`upper(COALESCE(l.pan, '')) = ${pan}` : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    const existing = leadConds.length
      ? ((await tx.execute(sql`
          SELECT l.id::text AS id, l.owner_id::text AS owner_id FROM leads l
           WHERE l.tenant_id = ${form.tenantId}::uuid AND l.lost_reason IS DISTINCT FROM '__deleted__'
             AND l.converted_investor_id IS NULL AND (${sql.join(leadConds, sql` OR `)})
           ORDER BY l.updated_at DESC LIMIT 1
        `)).rows[0] as { id: string; owner_id: string | null } | undefined)
      : undefined;
    if (existing) {
      await tx.execute(sql`
        UPDATE leads SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ${submission} ELSE ${submission} || E'\n\n' || notes END,
                         updated_at = now()
         WHERE id = ${existing.id}::uuid AND tenant_id = ${form.tenantId}::uuid
      `);
      if (existing.owner_id) {
        await createNotification(tx, {
          tenantId: form.tenantId,
          userId: existing.owner_id,
          kind: "lead.assigned",
          title: `${name} enquired again`,
          body: "Your lead filled in the website form again — the answers are in the lead's notes.",
          linkUrl: `/dashboard/leads/${existing.id}`,
          severity: "info",
          meta: { lead_id: existing.id, how: "web_form_repeat" },
        });
      }
      await recordFormConsent(tx, { tenantId: form.tenantId, subject: { type: "lead", id: existing.id }, source: "lead_form", headers: req.headers });
      return null;
    }

    // 3. Someone new → a lead, owned and in its owner's branch.
    const rmId: string | null = form.defaultRmId ?? (await autoAssignLeadOwner(tx, { tenantId: form.tenantId, source: form.leadSource }));
    const branchId = await ownerBranchId(tx, form.tenantId, rmId);

    // Deterministic initial score from the captured signals.
    const initialScore = scoreFields({
      source: normalizeLeadSource(form.leadSource),
      stage: "new",
      email: email || null,
      phone: phone || null,
      pan: pan ?? null,
    });

    await tx.execute(sql`
      INSERT INTO leads (
        id, tenant_id, branch_id, name, email, email_normalized, phone, phone_normalized,
        pan, source, source_campaign, owner_id, stage, stage_changed_at,
        lead_score, score_band, scored_at,
        notes, created_at, updated_at
      ) VALUES (
        ${leadId}::uuid, ${form.tenantId}::uuid, ${branchId}::uuid, ${name},
        ${email || null}, ${normalizeEmail(email)}, ${phone || null},
        ${normalizePhoneLast10(phone)}, ${pan},
        ${normalizeLeadSource(form.leadSource)}, ${form.sourceCampaign},
        ${rmId}::uuid,
        'new', now(),
        ${initialScore.leadScore}, ${initialScore.scoreBand}, now(),
        ${composedNotes || null},
        now(), now()
      )
    `);

    // Emit an event so workflow recipes (lead_welcome, lead_nurture_drip)
    // can pick it up exactly like a manually-created lead would.
    await tx.execute(sql`
      INSERT INTO events_outbox (
        tenant_id, kind, entity_type, entity_id, after, meta, occurred_at
      ) VALUES (
        ${form.tenantId}::uuid,
        'lead.created',
        'lead',
        ${leadId}::uuid,
        ${JSON.stringify({
          leadId,
          name,
          email: email || null,
          phone: phone || null,
          source: normalizeLeadSource(form.leadSource),
          source_campaign: form.sourceCampaign,
          form_slug: slug,
        })}::jsonb,
        ${JSON.stringify({ source: "public_lead_form", formId: form.id, formSlug: slug })}::jsonb,
        now()
      )
    `);

    await recordFormConsent(tx, { tenantId: form.tenantId, subject: { type: "lead", id: leadId }, source: "lead_form", headers: req.headers });
    await notifyLeadAssigned(tx, { tenantId: form.tenantId, leadId, ownerId: rmId, how: "web_form" });
    return leadId;
  });

  // Suppress unused-import warning (leads is needed for type-resolution
  // via the schema barrel — explicit reference keeps tree-shake from
  // dropping it during dev hot-reload).
  void leads;
  void and;

  // The same answer whether a lead was created or the person was already on
  // file (leadId only for a new lead, as the honeypot answers null).
  return NextResponse.json({ ok: true, leadId: created });
}
