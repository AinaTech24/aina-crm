/**
 * The firm's public feedback form — /feedback/<token>.
 *
 * One link per firm (tenants.feedback_form_token, migration 0229) for its
 * website and email signature. Unlike a client's personal survey link
 * (/f/<token>, one use, one client) anyone may use it, any number of times.
 *
 * A response is filed exactly as a personal survey's is — a CLOSED `feedback`
 * service request carrying csat_rating (the NPS answer) and every answer — so
 * it counts towards the Client Feedback page's NPS with nothing else to change.
 *
 * Rules worth knowing before changing this:
 *   - The public side only ever sees the firm's display branding.
 *   - A response is LINKED to a client only when the email or mobile typed
 *     matches exactly one live client; then it goes to that client's RM.
 *     Otherwise it goes to the owner. Nothing is ever sent back to the address
 *     typed, so the form cannot make the firm write to a third party.
 *   - A detractor (NPS 0–6) is raised to high priority and its handler is
 *     notified, so an unhappy client hears back.
 */

import { randomBytes } from "node:crypto";
import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/db/client";
import { eventsOutbox, serviceRequests, tenants } from "@/db/schema";
import { createNotification } from "@/lib/notifications/create";
import { FEEDBACK_QUESTIONS, NPS_QUESTION_KEY, type FeedbackAnswer } from "@/lib/support/feedback-questions";

/** 18 random bytes → 24 URL-safe characters. */
export function newFeedbackFormToken(): string {
  return randomBytes(18).toString("base64url");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type PublicFeedbackFormInfo = {
  tenantId: string;
  firmName: string;
  logoUrl: string | null;
  arn: string | null;
  enabled: boolean;
};

/** The link's firm, or null. A system read: the token is the only credential. */
export async function resolveFeedbackForm(token: string): Promise<PublicFeedbackFormInfo | null> {
  if (!TOKEN_RE.test(token)) return null;
  return withSystem(async (tx) => {
    const [t] = await tx
      .select({
        id: tenants.id,
        displayName: tenants.displayName,
        logoUrl: tenants.logoUrl,
        arn: tenants.arn,
        enabled: tenants.feedbackFormEnabled,
        deletedAt: tenants.deletedAt,
      })
      .from(tenants)
      .where(eq(tenants.feedbackFormToken, token))
      .limit(1);
    if (!t || t.deletedAt) return null;
    return { tenantId: t.id, firmName: t.displayName, logoUrl: t.logoUrl, arn: t.arn, enabled: t.enabled };
  });
}

/** The firm's link, made the first time anyone asks for it. */
export async function ensureFeedbackFormLink(tx: Tx, tenantId: string): Promise<{ token: string; enabled: boolean }> {
  // Only fills an empty token, so two people opening the page at once end up
  // with the same link rather than one silently replacing the other's.
  await tx.execute(sql`
    UPDATE tenants SET feedback_form_token = ${newFeedbackFormToken()}
    WHERE id = ${tenantId}::uuid AND feedback_form_token IS NULL
  `);
  const [t] = await tx
    .select({ token: tenants.feedbackFormToken, enabled: tenants.feedbackFormEnabled })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t?.token) throw new Error("feedback form link could not be created");
  return { token: t.token, enabled: t.enabled };
}

/** A new link; the old one stops working at once. */
export async function replaceFeedbackFormToken(tx: Tx, tenantId: string): Promise<void> {
  await tx
    .update(tenants)
    .set({ feedbackFormToken: newFeedbackFormToken(), updatedAt: new Date() } as any)
    .where(eq(tenants.id, tenantId));
}

export async function setFeedbackFormEnabled(tx: Tx, tenantId: string, enabled: boolean): Promise<void> {
  await tx
    .update(tenants)
    .set({ feedbackFormEnabled: enabled, updatedAt: new Date() } as any)
    .where(eq(tenants.id, tenantId));
}

export type WebFeedback = {
  name: string;
  email: string | null;
  phone: string | null;
  answers: FeedbackAnswer[];
  comment: string;
};

type Parsed = { kind: "ok"; value: WebFeedback } | { kind: "invalid"; error: string } | { kind: "trap" };

/** Read a submission. `website` is a honeypot: a person never fills it. */
export function parseWebFeedback(body: unknown): Parsed {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (String(b.website ?? "").trim()) return { kind: "trap" };
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!name) return { kind: "invalid", error: "Please tell us your name." };
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { kind: "invalid", error: "That email address doesn't look right." };
  const phoneRaw = String(b.phone ?? "").trim().slice(0, 30);
  const phone = phoneRaw || null;
  if (phone && phone.replace(/\D/g, "").length < 10) return { kind: "invalid", error: "Please give a 10-digit mobile number." };

  const raw = Array.isArray(b.answers) ? b.answers : [];
  const byKey = new Map<string, number>();
  for (const a of raw as Array<Record<string, unknown>>) {
    const score = Number(a?.score);
    if (typeof a?.key === "string" && Number.isInteger(score) && score >= 0 && score <= 10) byKey.set(a.key, score);
  }
  // Every question, worded as the firm's questionnaire words it — never as the browser sent it.
  if (FEEDBACK_QUESTIONS.some((q) => !byKey.has(q.key))) return { kind: "invalid", error: "Please answer every question." };
  const answers = FEEDBACK_QUESTIONS.map((q) => ({ key: q.key, label: q.label, score: byKey.get(q.key)! }));
  const comment = String(b.comment ?? "").trim().slice(0, 2000);
  return { kind: "ok", value: { name, email, phone, answers, comment } };
}

/** The ONE live client whose email or mobile is the one typed — none, or more than one, is no match. */
async function matchClient(tx: Tx, tenantId: string, s: WebFeedback): Promise<{ id: string; rmId: string | null } | null> {
  const last10 = s.phone ? s.phone.replace(/\D/g, "").slice(-10) : null;
  if (!s.email && !last10) return null;
  const r = await tx.execute(sql`
    SELECT id, rm_id FROM investors
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND merged_into_id IS NULL
      AND (
        (${s.email}::text IS NOT NULL AND lower(trim(email)) = ${s.email}::text)
        OR (${last10}::text IS NOT NULL
            AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${last10}::text)
      )
    LIMIT 2
  `);
  if (r.rows.length !== 1) return null;
  const row = r.rows[0] as { id: string; rm_id: string | null };
  return { id: row.id, rmId: row.rm_id };
}

async function firmOwner(tx: Tx, tenantId: string): Promise<string | null> {
  const r = await tx.execute(sql`
    SELECT id FROM users
    WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active' AND 'owner' = ANY(roles)
    ORDER BY created_at ASC LIMIT 1
  `);
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}

/** File one website / email-signature response as a closed feedback request. */
export async function submitWebFeedback(tx: Tx, tenantId: string, s: WebFeedback): Promise<{ id: string; rating: number }> {
  const rating = s.answers.find((a) => a.key === NPS_QUESTION_KEY)?.score ?? 0;
  const client = await matchClient(tx, tenantId, s);
  const handler = client?.rmId ?? (await firmOwner(tx, tenantId));

  const seq = await tx.execute(sql`
    SELECT COUNT(*)::int + 1 AS n FROM service_requests
    WHERE tenant_id = ${tenantId}::uuid AND created_at >= date_trunc('year', now())
  `);
  const ticketNo = `SR-${new Date().getFullYear()}-${String(Number((seq.rows[0] as any)?.n ?? 1)).padStart(5, "0")}`;
  const id = uuid();
  const now = new Date();
  const contact = [
    "— Sent through the feedback link on the firm's website / email —",
    `Name: ${s.name}`,
    ...(s.phone ? [`Mobile: ${s.phone}`] : []),
    ...(s.email ? [`Email: ${s.email}`] : []),
  ];

  await tx.insert(serviceRequests).values({
    id,
    tenantId,
    ticketNo,
    investorId: client?.id ?? null,
    type: "feedback",
    channel: "form",
    subject: `Feedback from ${s.name} (NPS: ${rating})`.slice(0, 300),
    description: [
      s.comment || s.answers.map((a) => `${a.label}: ${a.score}/10`).join("\n"),
      "",
      ...contact,
    ].join("\n"),
    status: "closed",
    priority: rating <= 6 ? "high" : "normal",
    assignedToUserId: handler,
    csatRating: rating,
    csatComment: s.comment || null,
    csatResponses: s.answers,
    csatAt: now,
    timeline: [{ at: now.toISOString(), by: s.name, event: "Feedback submitted", note: "Through the firm's public feedback link." }],
  } as any);

  await tx.insert(eventsOutbox).values({
    tenantId,
    kind: "feedback.submitted",
    entityType: client ? "investor" : "service_request",
    entityId: client?.id ?? id,
    after: { rating, answers: s.answers, comment: s.comment, signature: s.name, serviceRequestId: id } as any,
    meta: { source: "public_feedback_form" } as any,
  } as any);

  if (handler && rating <= 6) {
    await createNotification(tx, {
      tenantId,
      userId: handler,
      kind: "feedback.detractor",
      title: "Unhappy feedback from your website link",
      body: `${s.name} rated ${rating}/10`,
      linkUrl: `/dashboard/service-requests/${id}`,
      severity: "warning",
    });
  }
  return { id, rating };
}
