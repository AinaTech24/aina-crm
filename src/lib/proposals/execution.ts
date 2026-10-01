/**
 * Did the client actually invest what they accepted?
 *
 * Accepted proposals are matched to the purchases that follow in the RTA feed,
 * so "Executed" is a fact rather than a status someone remembered to set, and
 * "₹ proposed vs ₹ invested" becomes a number for the first time.
 *
 * Rules, kept deliberately plain so an RM can check one by hand:
 *  - Only ACCEPTED lines count (a partly accepted proposal's untaken lines are
 *    not expected to be executed).
 *  - Only new money: SIP and lumpsum mutual-fund lines, matched to successful
 *    inflow transactions of type purchase / sip / lumpsum. SWP and STP move
 *    money already invested; insurance and PMS are not in the RTA feed.
 *  - The window is acceptance (less a day's grace — clients often invest the
 *    same day the RM records it) through one year, the same first-year basis
 *    every proposal value in the CRM uses.
 *  - A purchase counts toward at most one line.
 *
 * Scheme names are compared by their significant words, tolerating the
 * registrar's spelling ("NIPPON INDIA SMALL CAP FUND-GROWTH PLAN") against the
 * proposal's ("Nippon India Small Cap Fund - Growth") and abbreviations
 * ("ICICI Pru" / "ICICI Prudential"). Codes are not used: the RTA feed carries
 * the registrar's product codes, which do not match AMFI's (see
 * lib/finance/scheme-match.ts).
 */

import { sql } from "drizzle-orm";
import { normSchemeName } from "@/lib/finance/scheme-match";
import { itemMonthly, itemOneTime, recommendationType } from "./items";
import { createNotification } from "@/lib/notifications/create";

type Tx = any;

/** Words that don't distinguish one scheme from another. */
const NOISE = new Set([
  "fund", "plan", "option", "opt", "growth", "regular", "direct", "reg", "dir", "gr", "idcw",
  "dividend", "div", "payout", "reinvestment", "the", "of", "and", "scheme", "mutual", "mf",
]);

function significant(name: string | null | undefined): string[] {
  return normSchemeName(name).split(" ").filter((w) => w && !NOISE.has(w));
}

const tokenEq = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

/** Same scheme? Every significant word of the shorter name appears in the other. */
export function schemeMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = significant(a), y = significant(b);
  if (x.length < 2 || y.length < 2) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.some((v) => tokenEq(w, v)));
}

export type ExecutionLine = { index: number; schemeName: string; proposed: number; invested: number; transactionIds: string[] };

/** First-year proposed money for one accepted line. */
function lineProposed(item: any): number {
  return (itemOneTime(item) ?? 0) + (itemMonthly(item) ?? 0) * 12;
}

type Txn = { id: string; scheme_name: string | null; amount: string | number; order_date: string };

/** Pure: assign each purchase to at most one accepted line. */
export function matchLines(products: any[], acceptedItems: number[] | null, txns: Txn[]): ExecutionLine[] {
  const accepted = acceptedItems ?? products.map((_, i) => i);
  const lines: ExecutionLine[] = [];
  const used = new Set<string>();
  for (const i of accepted) {
    const it = products[i];
    if (it?.kind !== "mf") continue;
    const rt = recommendationType(it);
    if (rt !== "sip" && rt !== "lumpsum") continue;
    const line: ExecutionLine = { index: i, schemeName: String(it.schemeName ?? ""), proposed: lineProposed(it), invested: 0, transactionIds: [] };
    for (const t of txns) {
      if (used.has(t.id) || !schemeMatches(it.schemeName, t.scheme_name)) continue;
      used.add(t.id);
      line.invested += Number(t.amount ?? 0);
      line.transactionIds.push(t.id);
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Match every recently accepted proposal in one firm. Idempotent: re-running
 * recomputes the same figures. Returns counts for the nightly report.
 */
export async function matchProposalExecutions(tx: Tx, tenantId: string): Promise<{ checked: number; executed: number; newlyExecuted: number }> {
  const proposals = (
    await tx.execute(sql`
      SELECT p.id, p.proposal_number, p.recipient_name, p.status, p.products, p.accepted_items,
             p.accepted_at, p.executed_at, p.prepared_by_user_id,
             COALESCE(p.investor_id, l.converted_investor_id) AS investor_id
        FROM proposals p
        LEFT JOIN leads l ON l.id = p.lead_id
       WHERE p.tenant_id = ${tenantId}::uuid
         AND p.status IN ('accepted', 'partially_approved', 'executed')
         AND p.accepted_at IS NOT NULL
         AND p.accepted_at > now() - interval '400 days'
    `)
  ).rows as Array<{
    id: string; proposal_number: string; recipient_name: string; status: string; products: any[];
    accepted_items: number[] | null; accepted_at: string; executed_at: string | null;
    prepared_by_user_id: string | null; investor_id: string | null;
  }>;

  let executed = 0, newlyExecuted = 0;
  for (const p of proposals) {
    // A lead not yet converted has no folios, so nothing can have landed.
    if (!p.investor_id) continue;
    const txns = (
      await tx.execute(sql`
        SELECT id, scheme_name, amount, order_date::text AS order_date
          FROM transactions
         WHERE tenant_id = ${tenantId}::uuid
           AND investor_id = ${p.investor_id}::uuid
           AND direction = 'inflow'
           AND type IN ('purchase', 'sip', 'lumpsum')
           AND status IN ('processed', 'successful')
           AND order_date >= (${p.accepted_at}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date - 1
           AND order_date <= (${p.accepted_at}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date + 365
         ORDER BY order_date, id
      `)
    ).rows as Txn[];

    const lines = matchLines(Array.isArray(p.products) ? p.products : [], p.accepted_items, txns);
    const invested = lines.reduce((s, l) => s + l.invested, 0);
    if (invested <= 0) continue;

    const firstTxn = txns.find((t) => lines.some((l) => l.transactionIds.includes(t.id)));
    await tx.execute(sql`
      UPDATE proposals
         SET status = 'executed',
             executed_amount = ${Math.round(invested * 100) / 100},
             executed_at = COALESCE(executed_at, ${firstTxn?.order_date ?? null}::date),
             execution = ${JSON.stringify({ matchedAt: new Date().toISOString(), lines })}::jsonb,
             updated_at = now()
       WHERE id = ${p.id}::uuid
    `);
    executed++;

    if (!p.executed_at) {
      newlyExecuted++;
      if (p.prepared_by_user_id) {
        await createNotification(tx, {
          tenantId,
          userId: p.prepared_by_user_id,
          kind: "proposal.executed",
          title: `${String(p.recipient_name ?? "").split(" ")[0] || "Your client"} has invested — ${p.proposal_number} is executed`,
          body: `₹${Math.round(invested).toLocaleString("en-IN")} landed against the accepted recommendations.`,
          linkUrl: `/dashboard/proposals/${p.id}`,
          severity: "success",
          meta: { proposalId: p.id },
        });
      }
    }
  }
  return { checked: proposals.length, executed, newlyExecuted };
}
