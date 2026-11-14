/**
 * Client activity — what clients themselves did lately, newest first. Only
 * actions the CLIENT took, each read from where the CRM already records it:
 *
 *   proposal_viewed / _accepted / _declined / _changes
 *                    proposals.viewed_at, accepted_at, rejected_at,
 *                    change_requested_at (a client's own proposal)
 *   risk_profile     risk_profile_responses signed by the client
 *                    (verification_method client_otp / client_link)
 *   message_read     an outbound email or WhatsApp the client opened (read_at)
 *   link_clicked     a link the client clicked in a message (clicked_at)
 *   message_in       a message the client sent us (direction inbound)
 *   request          a service request the client raised through a form
 *   feedback         a rating the client gave on a request (csat_at)
 *   documents / fact_find / portfolio
 *                    a share link the client used (share_tokens.used_at):
 *                    document upload, fact-find, portfolio view
 *
 * Clients follow the client (rm_id / branch_id, clientRecordWhere) — a client
 * who has since left still did what they did. Every source names tenant_id so
 * the tenant index is used under RLS, and each is narrowed to the viewer's
 * clients and cut to `limit` before the union, so a busy message log never
 * drags the whole set along and an RM's card is never filled by other books.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientRecordWhere, type MetricScope, type MetricPeriod } from "./scope";

export type ClientActivityKind =
  | "proposal_viewed" | "proposal_accepted" | "proposal_declined" | "proposal_changes"
  | "risk_profile" | "message_read" | "link_clicked" | "message_in"
  | "request" | "feedback" | "documents" | "fact_find" | "portfolio";

export type ClientActivityItem = {
  kind: ClientActivityKind;
  at: string;
  investorId: string;
  investorName: string;
  /** Proposal title, message template name or request type — what it was about. */
  detail: string | null;
  /** The message channel (email, whatsapp, sms…) for a message event. */
  channel: string | null;
  /** The record it happened on, when it has a page of its own (a proposal). */
  refId: string | null;
};

export async function getClientActivity(
  tx: Tx,
  scope: MetricScope,
  period: MetricPeriod,
  limit = 8,
): Promise<ClientActivityItem[]> {
  const t = scope.tenantId;
  // India-date bounds, as a timestamp range the indexes can use.
  const from = sql`(${period.from}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
  const to = sql`((${period.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
  const within = (c: string) => sql`${sql.raw(c)} >= ${from} AND ${sql.raw(c)} < ${to}`;
  // The viewer's clients, applied inside every source before its cut.
  const mine = (c: string) => sql`${sql.raw(c)} IN (SELECT i.id FROM investors i WHERE ${clientRecordWhere(scope, "i")})`;
  const n = Math.max(1, Math.min(50, limit));

  const rows = (await tx.execute(sql`
    WITH ev AS (
      (SELECT 'proposal_viewed' AS kind, p.viewed_at AS at, p.investor_id, p.title AS detail, p.id AS ref_id, NULL AS channel
         FROM proposals p WHERE p.tenant_id = ${t}::uuid AND p.investor_id IS NOT NULL AND ${mine("p.investor_id")} AND ${within("p.viewed_at")}
        ORDER BY p.viewed_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'proposal_accepted', p.accepted_at, p.investor_id, p.title, p.id, NULL
         FROM proposals p WHERE p.tenant_id = ${t}::uuid AND p.investor_id IS NOT NULL AND ${mine("p.investor_id")} AND ${within("p.accepted_at")}
        ORDER BY p.accepted_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'proposal_declined', p.rejected_at, p.investor_id, p.title, p.id, NULL
         FROM proposals p WHERE p.tenant_id = ${t}::uuid AND p.investor_id IS NOT NULL AND ${mine("p.investor_id")} AND ${within("p.rejected_at")}
        ORDER BY p.rejected_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'proposal_changes', p.change_requested_at, p.investor_id, p.title, p.id, NULL
         FROM proposals p WHERE p.tenant_id = ${t}::uuid AND p.investor_id IS NOT NULL AND ${mine("p.investor_id")} AND ${within("p.change_requested_at")}
        ORDER BY p.change_requested_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'risk_profile', r.signed_at, r.investor_id, NULL, NULL, NULL
         FROM risk_profile_responses r
        WHERE r.tenant_id = ${t}::uuid AND r.verification_method IN ('client_otp', 'client_link')
          AND NOT r.provisional AND ${mine("r.investor_id")} AND ${within("r.signed_at")}
        ORDER BY r.signed_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'message_read', c.read_at, c.investor_id, tp.name, NULL, c.channel
         FROM communications c
         LEFT JOIN template_versions tv ON tv.id = c.template_version_id
         LEFT JOIN templates tp ON tp.id = tv.template_id
        WHERE c.tenant_id = ${t}::uuid AND c.direction = 'outbound' AND c.channel IN ('email', 'whatsapp')
          AND c.investor_id IS NOT NULL AND ${mine("c.investor_id")} AND ${within("c.read_at")}
        ORDER BY c.read_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'link_clicked', c.clicked_at, c.investor_id, tp.name, NULL, c.channel
         FROM communications c
         LEFT JOIN template_versions tv ON tv.id = c.template_version_id
         LEFT JOIN templates tp ON tp.id = tv.template_id
        WHERE c.tenant_id = ${t}::uuid AND c.direction = 'outbound'
          AND c.investor_id IS NOT NULL AND ${mine("c.investor_id")} AND ${within("c.clicked_at")}
        ORDER BY c.clicked_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'message_in', c.created_at, c.investor_id, NULL, NULL, c.channel
         FROM communications c
        WHERE c.tenant_id = ${t}::uuid AND c.direction = 'inbound'
          AND c.investor_id IS NOT NULL AND ${mine("c.investor_id")} AND ${within("c.created_at")}
        ORDER BY c.created_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'request', s.created_at, s.investor_id, s.type, NULL, NULL
         FROM service_requests s
        WHERE s.tenant_id = ${t}::uuid AND s.channel = 'form'
          AND s.investor_id IS NOT NULL AND ${mine("s.investor_id")} AND ${within("s.created_at")}
        ORDER BY s.created_at DESC LIMIT ${n})
      UNION ALL
      (SELECT 'feedback', s.csat_at, s.investor_id, s.type, NULL, NULL
         FROM service_requests s
        WHERE s.tenant_id = ${t}::uuid AND s.investor_id IS NOT NULL AND ${mine("s.investor_id")} AND ${within("s.csat_at")}
        ORDER BY s.csat_at DESC LIMIT ${n})
      UNION ALL
      (SELECT CASE st.kind WHEN 'document_collection' THEN 'documents'
                           WHEN 'financial_discovery' THEN 'fact_find'
                           ELSE 'portfolio' END,
              st.used_at, st.subject_id, NULL, NULL, NULL
         FROM share_tokens st
        WHERE st.tenant_id = ${t}::uuid AND st.subject_type = 'investor'
          AND st.kind IN ('document_collection', 'financial_discovery', 'portfolio_view')
          AND ${mine("st.subject_id")} AND ${within("st.used_at")}
        ORDER BY st.used_at DESC LIMIT ${n})
    )
    SELECT ev.kind, ev.at, ev.investor_id, i.name AS investor_name, ev.detail, ev.ref_id, ev.channel
      FROM ev
      JOIN investors i ON i.id = ev.investor_id
     WHERE ${clientRecordWhere(scope, "i")}
     ORDER BY ev.at DESC
     LIMIT ${n}
  `)).rows as Array<{ kind: ClientActivityKind; at: string | Date; investor_id: string; investor_name: string; detail: string | null; ref_id: string | null; channel: string | null }>;

  return rows.map((r) => ({
    kind: r.kind,
    at: new Date(r.at).toISOString(),
    investorId: r.investor_id,
    investorName: r.investor_name,
    detail: r.detail,
    refId: r.ref_id,
    channel: r.channel,
  }));
}
