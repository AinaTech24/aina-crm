/**
 * The Opportunities module (/dashboard/opportunities) — every opportunity the
 * viewer can see, for the board, the list and the headline figures.
 *
 * One read: client_opportunities joined to the client (access follows the
 * client — investorScopeSql), the owner, the journey's blueprint instance
 * (current stage, when it was entered, delayed) and the next follow-up — the
 * opportunity's earliest open task (journey.ts, "Follow-ups ARE tasks").
 *
 * The board's columns group the journey's stages: the five people steps each
 * get a column, the product branch (KYC → UCC → mandate → transaction, the
 * insurer's proposal form → underwriting → issue, "executed") is one
 * "Processing" column, then "Later" — open ones the client has put off
 * (lib/opportunities/later.ts), whatever step they stood at — then Won and Lost.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { investorScopeSql } from "@/lib/investors/access";
import { textList } from "@/lib/metrics";
import { OPPORTUNITY_PRODUCTS, productLabel, type OpportunityPipeline } from "./products";
import { stageName } from "./stages";

export const BOARD_COLUMNS = [
  { key: "identified", label: "Need identified", stages: ["identified"] },
  { key: "discussion", label: "Discussion", stages: ["discussion"] },
  { key: "suitability", label: "Suitability", stages: ["suitability"] },
  { key: "proposal", label: "Proposal shared", stages: ["proposal"] },
  { key: "accepted", label: "Client accepted", stages: ["accepted"] },
  {
    key: "processing", label: "Processing",
    stages: ["mf_kyc", "mf_ucc", "mf_mandate", "mf_transaction", "txn_review", "ins_proposal_form", "ins_underwriting", "ins_issued", "gen_executed"],
  },
  // Not a journey step: an open opportunity the client asked to revisit later.
  { key: "later", label: "Later", stages: [] },
  { key: "won", label: "Won", stages: ["won"] },
  { key: "lost", label: "Lost", stages: ["lost"] },
] as const;
export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]["key"];
const OPEN_COLUMNS = BOARD_COLUMNS.filter((c) => c.key !== "won" && c.key !== "lost");

export function columnOf(stageKey: string | null): BoardColumnKey {
  return BOARD_COLUMNS.find((c) => (c.stages as readonly string[]).includes(stageKey ?? ""))?.key ?? "identified";
}

export type BoardRow = {
  id: string;
  investorId: string;
  investorName: string;
  product: string;
  productLabel: string;
  pipeline: OpportunityPipeline;
  status: "open" | "won" | "lost";
  expectedValue: number | null;
  investmentMode: "sip" | "lumpsum" | null;
  ownerId: string | null;
  ownerName: string | null;
  stageKey: string;
  stageName: string;
  column: BoardColumnKey;
  stageEnteredAt: string | null;
  delayed: boolean;
  followUpAt: string | null;
  createdAt: string;
  closedAt: string | null;
  lostReason: string | null;
  /** Parked: when the client said they would go ahead, and their words. */
  later: { revisitOn: string; reason: string | null } | null;
};

export type BoardFilters = {
  q?: string;
  stage?: string[];
  product?: string[];
  owner?: string[];
  /** open (default) · won · lost · all */
  status?: string;
  /** overdue · today · week · none */
  fu?: string;
  mine?: boolean;
  createdFrom?: string;
  createdTo?: string;
};

export type BoardKpis = {
  open: number;
  openValue: number;
  overdue: number;
  dueToday: number;
  noFollowUp: number;
  wonThisMonth: number;
  wonValueThisMonth: number;
  /** Parked ("Later"), and how many of them are due back in the next 30 days. */
  later: number;
  laterValue: number;
  laterNext30: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TODAY = sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const fuDay = sql`(fu.due AT TIME ZONE 'Asia/Kolkata')::date`;

/** The read every view shares; `where` narrows it, access always applies. */
async function baseQuery(tx: any, session: SessionUser, where: SQL[], limit: number) {
  const scope = await investorScopeSql(tx, session, "i");
  return tx.execute(sql`
    WITH fu AS (
      SELECT meta ->> 'opportunityId' AS oid, min(due_at) AS due
        FROM tasks
       WHERE tenant_id = ${session.tenantId}::uuid AND meta ? 'opportunityId'
         AND status IN ('open', 'in_progress', 'blocked') AND due_at IS NOT NULL
       GROUP BY 1
    )
    SELECT o.id, o.investor_id, i.name AS investor_name, o.product, o.pipeline, o.status,
           o.expected_value, o.investment_mode, o.owner_id, u.name AS owner_name,
           COALESCE(bi.current_stage_key, 'identified') AS stage_key, bi.stage_entered_at,
           COALESCE(bi.is_delayed, false) AS delayed, fu.due AS follow_up_at,
           o.created_at, COALESCE(o.won_at, o.lost_at) AS closed_at, o.lost_reason,
           o.parked_at, o.revisit_on::text AS revisit_on, o.parked_reason
      FROM client_opportunities o
      JOIN investors i ON i.id = o.investor_id AND i.tenant_id = o.tenant_id
      LEFT JOIN users u ON u.id = o.owner_id
      LEFT JOIN blueprint_instances bi
        ON bi.tenant_id = o.tenant_id AND bi.subject_type = 'opportunity' AND bi.subject_id = o.id
      LEFT JOIN fu ON fu.oid = o.id::text
     WHERE o.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL AND ${scope}
       ${where.length ? sql`AND ${sql.join(where, sql` AND `)}` : sql``}
     ORDER BY CASE WHEN o.status = 'open' THEN 0 ELSE 1 END,
              fu.due ASC NULLS LAST, o.created_at DESC
     LIMIT ${limit}
  `);
}

function filterSql(f: BoardFilters, userId: string): SQL[] {
  const w: SQL[] = [];
  const status = f.status && ["open", "won", "lost", "all"].includes(f.status) ? f.status : "open";
  if (status !== "all") w.push(sql`o.status = ${status}`);
  if (f.q?.trim()) w.push(sql`i.name ILIKE ${`%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  const stages = (f.stage ?? []).flatMap((k) => BOARD_COLUMNS.find((c) => c.key === k)?.stages ?? []);
  const wantLater = (f.stage ?? []).includes("later");
  if (stages.length || wantLater) {
    // A parked opportunity sits in "Later", not in the step it stood at.
    const parts: SQL[] = [];
    if (stages.length) parts.push(sql`(o.parked_at IS NULL AND COALESCE(bi.current_stage_key, 'identified') IN (${textList([...stages])}))`);
    if (wantLater) parts.push(sql`(o.status = 'open' AND o.parked_at IS NOT NULL)`);
    w.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  const products = (f.product ?? []).filter((p) => OPPORTUNITY_PRODUCTS.some((x) => x.key === p));
  if (products.length) w.push(sql`o.product IN (${textList(products)})`);
  const owners = (f.owner ?? []).map((o) => (o === "me" ? userId : o)).filter((o) => UUID.test(o));
  if (owners.length) w.push(sql`(o.owner_id::text IN (${textList(owners)}) OR o.co_owner_id::text IN (${textList(owners)}))`);
  if (f.mine) w.push(sql`(o.owner_id = ${userId}::uuid OR o.co_owner_id = ${userId}::uuid)`);
  if (f.fu === "overdue") w.push(sql`o.status = 'open' AND fu.due IS NOT NULL AND ${fuDay} < ${TODAY}`);
  if (f.fu === "today") w.push(sql`o.status = 'open' AND ${fuDay} = ${TODAY}`);
  if (f.fu === "week") w.push(sql`o.status = 'open' AND ${fuDay} BETWEEN ${TODAY} AND ${TODAY} + 6`);
  if (f.fu === "none") w.push(sql`o.status = 'open' AND fu.due IS NULL`);
  const day = sql`(o.created_at AT TIME ZONE 'Asia/Kolkata')::date`;
  if (f.createdFrom && ISO.test(f.createdFrom)) w.push(sql`${day} >= ${f.createdFrom}::date`);
  if (f.createdTo && ISO.test(f.createdTo)) w.push(sql`${day} <= ${f.createdTo}::date`);
  return w;
}

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);

function toRow(r: any): BoardRow {
  return {
    id: r.id,
    investorId: r.investor_id,
    investorName: r.investor_name,
    product: r.product,
    productLabel: productLabel(r.product),
    pipeline: r.pipeline,
    status: r.status,
    expectedValue: r.expected_value == null ? null : Number(r.expected_value),
    investmentMode: r.investment_mode ?? null,
    ownerId: r.owner_id ?? null,
    ownerName: r.owner_name ? String(r.owner_name).replace(/\s*\([^)]*\)\s*$/, "") : null,
    stageKey: r.stage_key,
    stageName: stageName(r.stage_key),
    column: r.status === "open" && r.parked_at ? "later" : columnOf(r.stage_key),
    stageEnteredAt: iso(r.stage_entered_at),
    delayed: !!r.delayed,
    followUpAt: r.status === "open" ? iso(r.follow_up_at) : null,
    createdAt: iso(r.created_at)!,
    closedAt: iso(r.closed_at),
    lostReason: r.lost_reason ?? null,
    later: r.status === "open" && r.parked_at && r.revisit_on ? { revisitOn: r.revisit_on, reason: r.parked_reason ?? null } : null,
  };
}

/** The rows the filters select (at most 500). */
export async function loadBoardRows(tx: any, session: SessionUser, f: BoardFilters): Promise<BoardRow[]> {
  const res = await baseQuery(tx, session, filterSql(f, session.userId), 500);
  return (res.rows as any[]).map(toRow);
}

/**
 * The headline figures, over the viewer's whole book of opportunities (the
 * page's filters do not change them — they say where the work is).
 */
export async function loadBoardKpis(tx: any, session: SessionUser): Promise<BoardKpis> {
  const scope = await investorScopeSql(tx, session, "i");
  const r = (await tx.execute(sql`
    WITH fu AS (
      SELECT meta ->> 'opportunityId' AS oid, min(due_at) AS due
        FROM tasks
       WHERE tenant_id = ${session.tenantId}::uuid AND meta ? 'opportunityId'
         AND status IN ('open', 'in_progress', 'blocked') AND due_at IS NOT NULL
       GROUP BY 1
    ), mine AS (
      SELECT o.*, fu.due FROM client_opportunities o
        JOIN investors i ON i.id = o.investor_id AND i.tenant_id = o.tenant_id
        LEFT JOIN fu ON fu.oid = o.id::text
       WHERE o.tenant_id = ${session.tenantId}::uuid AND i.deleted_at IS NULL AND ${scope}
    )
    SELECT
      count(*) FILTER (WHERE status = 'open')::int AS open,
      COALESCE(sum(expected_value) FILTER (WHERE status = 'open'), 0)::float8 AS open_value,
      count(*) FILTER (WHERE status = 'open' AND due IS NOT NULL AND (due AT TIME ZONE 'Asia/Kolkata')::date < ${TODAY})::int AS overdue,
      count(*) FILTER (WHERE status = 'open' AND (due AT TIME ZONE 'Asia/Kolkata')::date = ${TODAY})::int AS due_today,
      count(*) FILTER (WHERE status = 'open' AND due IS NULL)::int AS no_follow_up,
      count(*) FILTER (WHERE status = 'won' AND date_trunc('month', won_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'))::int AS won_month,
      COALESCE(sum(expected_value) FILTER (WHERE status = 'won' AND date_trunc('month', won_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')), 0)::float8 AS won_value_month,
      count(*) FILTER (WHERE status = 'open' AND parked_at IS NOT NULL)::int AS later,
      COALESCE(sum(expected_value) FILTER (WHERE status = 'open' AND parked_at IS NOT NULL), 0)::float8 AS later_value,
      count(*) FILTER (WHERE status = 'open' AND parked_at IS NOT NULL AND revisit_on <= ${TODAY} + 30)::int AS later_30
    FROM mine
  `)).rows[0] as any;
  return {
    open: r?.open ?? 0,
    openValue: Number(r?.open_value ?? 0),
    overdue: r?.overdue ?? 0,
    dueToday: r?.due_today ?? 0,
    noFollowUp: r?.no_follow_up ?? 0,
    wonThisMonth: r?.won_month ?? 0,
    wonValueThisMonth: Number(r?.won_value_month ?? 0),
    later: r?.later ?? 0,
    laterValue: Number(r?.later_value ?? 0),
    laterNext30: r?.later_30 ?? 0,
  };
}

/** The columns a board shows: the open ones, plus Won / Lost when closed rows are in view. */
export function boardColumns(status: string | undefined) {
  if (status === "won") return BOARD_COLUMNS.filter((c) => c.key === "won");
  if (status === "lost") return BOARD_COLUMNS.filter((c) => c.key === "lost");
  if (status === "all") return [...BOARD_COLUMNS];
  return [...OPEN_COLUMNS];
}
