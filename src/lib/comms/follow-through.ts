/**
 * Follow-through on client-action emails. SERVER-ONLY.
 *
 * Some emails only matter if the client DOES something: confirm a risk profile,
 * redo one after a suitability warning, leave a rating. Until now the CRM could
 * tell you a message was delivered and even opened, but never whether it worked
 * — the action lands in a different module and nothing joined the two. So an
 * MFD sending a suitability note to forty clients had no way to see the eight
 * who ignored it.
 *
 * This walks each send through four stages:
 *
 *   sent → opened (mail client) → link opened (they tapped the button) → acted
 *
 * "Link opened" is the interesting one: the pipeline already mints a personal
 * share token per recipient and records `used_at` the moment it is visited, but
 * nothing displayed it. A client who opened the form and abandoned it is the
 * best person to phone — they were interested and got stuck. Where no token was
 * minted we fall back to the provider's click ping (communications.clicked_at).
 *
 * "Acted" is deliberately evidence-based, never inferred from a click: a real
 * risk-profile response the CLIENT signed (or a filed feedback ticket) dated
 * after the send. So the column cannot flatter the firm.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/** Emails that ask the client to do something, and how "done" is proved. */
export const ACTION_TEMPLATES = {
  risk_profile_assigned: {
    label: "Suggested risk profile",
    action: "Confirmed their profile",
    tokenKind: "risk_profile",
    evidence: "risk_profile",
  },
  risk_profile_request: {
    label: "Risk profile request",
    action: "Completed the questionnaire",
    tokenKind: "risk_profile",
    evidence: "risk_profile",
  },
  suitability_review: {
    label: "Suitability note",
    action: "Re-profiled",
    tokenKind: "risk_profile",
    evidence: "risk_profile",
  },
  feedback_nps: {
    label: "Feedback request",
    action: "Left feedback",
    tokenKind: "feedback",
    evidence: "feedback",
  },
} as const;

export type ActionTemplateKey = keyof typeof ACTION_TEMPLATES;
export const ACTION_TEMPLATE_KEYS = Object.keys(ACTION_TEMPLATES) as ActionTemplateKey[];

export type Stage = "acted" | "link_opened" | "opened" | "delivered" | "sent" | "failed" | "skipped";

export type FollowThroughRow = {
  communicationId: string;
  templateKey: ActionTemplateKey;
  investorId: string | null;
  name: string;
  email: string | null;
  rmName: string | null;
  sentAt: string | null;
  status: string;
  openedAt: string | null;
  /** When the client actually opened their personal link. */
  linkOpenedAt: string | null;
  /** Whether a link was minted at all (a template send without one can't be tracked past "opened"). */
  hasLink: boolean;
  actedAt: string | null;
  stage: Stage;
};

export type FollowThroughSummary = {
  sent: number;
  opened: number;
  linkOpened: number;
  acted: number;
  /** Opened the link but never finished — the best call list. */
  stalled: number;
  /** Not opened at all, and it has been a while. */
  silent: number;
};

function stageOf(r: {
  status: string;
  openedAt: string | null;
  linkOpenedAt: string | null;
  actedAt: string | null;
}): Stage {
  if (r.actedAt) return "acted";
  if (r.linkOpenedAt) return "link_opened";
  if (r.openedAt || r.status === "read" || r.status === "replied") return "opened";
  if (r.status.startsWith("skipped")) return "skipped";
  if (r.status === "failed" || r.status === "bounced") return "failed";
  if (r.status === "delivered") return "delivered";
  return "sent";
}

/**
 * One row per send of a client-action email, newest first.
 *
 * The token match is by (subject, kind) minted within a few minutes of the
 * send — dispatch() mints it inline while rendering the body, so the two are
 * always seconds apart. A window rather than a foreign key because the
 * pipeline does not (yet) record which token a given message carried.
 */
export async function loadFollowThrough(
  tx: Tx,
  opts: { tenantId: string; templateKey?: ActionTemplateKey; stage?: Stage; rmId?: string; limit?: number }
): Promise<{ rows: FollowThroughRow[]; summary: FollowThroughSummary }> {
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 1000);
  const keys = opts.templateKey ? [opts.templateKey] : ACTION_TEMPLATE_KEYS;
  const keyList = sql.join(keys.map((k) => sql`${k}`), sql`, `);
  const rmScope = opts.rmId ? sql` AND i.rm_id = ${opts.rmId}::uuid` : sql``;

  const res = await tx.execute(sql`
    SELECT c.id, c.template_key, c.investor_id, c.status,
           COALESCE(c.sent_at, c.created_at) AS sent_at,
           COALESCE(c.read_at, c.replied_at)  AS opened_at,
           i.name, i.email, u.name AS rm_name,
           -- Prefer OUR record (they landed on the form) over the ESP's click
           -- ping, but fall back to it when no token was minted for the send.
           COALESCE(tok.used_at, c.clicked_at) AS link_opened_at,
           (tok.id IS NOT NULL OR c.clicked_at IS NOT NULL) AS has_link,
           act.acted_at
      FROM communications c
      JOIN investors i ON i.id = c.investor_id
                      AND i.deleted_at IS NULL AND i.merged_into_id IS NULL${rmScope}
      LEFT JOIN users u ON u.id = i.rm_id
      -- The personal link minted for THIS send (dispatch mints it inline).
      LEFT JOIN LATERAL (
        SELECT s.id, s.used_at
          FROM share_tokens s
         WHERE s.tenant_id = c.tenant_id
           AND s.subject_id = c.investor_id
           AND s.created_at BETWEEN COALESCE(c.sent_at, c.created_at) - interval '2 minutes'
                                AND COALESCE(c.sent_at, c.created_at) + interval '5 minutes'
         ORDER BY s.created_at ASC
         LIMIT 1
      ) tok ON TRUE
      -- Evidence the client actually did the thing, dated after the send.
      LEFT JOIN LATERAL (
        SELECT CASE
                 WHEN c.template_key = 'feedback_nps' THEN (
                   SELECT MIN(sr.created_at) FROM service_requests sr
                    WHERE sr.tenant_id = c.tenant_id AND sr.investor_id = c.investor_id
                      AND sr.type = 'feedback'
                      AND sr.created_at > COALESCE(c.sent_at, c.created_at))
                 ELSE (
                   SELECT MIN(r.signed_at) FROM risk_profile_responses r
                    WHERE r.tenant_id = c.tenant_id AND r.investor_id = c.investor_id
                      AND r.verification_method IN ('client_link', 'client_otp')
                      AND r.signed_at > COALESCE(c.sent_at, c.created_at))
               END AS acted_at
      ) act ON TRUE
     WHERE c.tenant_id = ${opts.tenantId}::uuid
       AND c.template_key IN (${keyList})
       AND c.investor_id IS NOT NULL
     ORDER BY COALESCE(c.sent_at, c.created_at) DESC
     LIMIT ${limit}
  `);

  const all: FollowThroughRow[] = (res.rows as any[]).map((r) => {
    const base = {
      communicationId: String(r.id),
      templateKey: r.template_key as ActionTemplateKey,
      investorId: r.investor_id ? String(r.investor_id) : null,
      name: r.name ?? "—",
      email: r.email ?? null,
      rmName: r.rm_name ?? null,
      sentAt: r.sent_at ? String(r.sent_at) : null,
      status: String(r.status ?? ""),
      openedAt: r.opened_at ? String(r.opened_at) : null,
      linkOpenedAt: r.link_opened_at ? String(r.link_opened_at) : null,
      hasLink: !!r.has_link,
      actedAt: r.acted_at ? String(r.acted_at) : null,
    };
    return { ...base, stage: stageOf(base) };
  });

  const summary: FollowThroughSummary = {
    sent: all.length,
    opened: all.filter((r) => r.openedAt || r.linkOpenedAt || r.actedAt).length,
    linkOpened: all.filter((r) => r.linkOpenedAt || r.actedAt).length,
    acted: all.filter((r) => r.actedAt).length,
    stalled: all.filter((r) => r.linkOpenedAt && !r.actedAt).length,
    silent: all.filter((r) => r.stage === "sent" || r.stage === "delivered").length,
  };

  const rows = opts.stage ? all.filter((r) => r.stage === opts.stage) : all;
  return { rows, summary };
}
