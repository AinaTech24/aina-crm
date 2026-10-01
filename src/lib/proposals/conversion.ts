/**
 * Proposal conversion: of what we proposed, how much did clients accept, and
 * how much was actually invested — overall, by RM and by scheme.
 *
 * Pure, so it can be tested; the report page loads the rows. Every rupee is a
 * FIRST-YEAR value (a year of SIPs plus one-time money, lib/proposals/items
 * proposalValue), the basis the pipeline board and timeline use too.
 *
 * Only proposals that were SENT count — a draft was never put to a client —
 * and a superseded version is never loaded (its latest version stands for it).
 */

import { itemName, proposalValue } from "./items";

export type ConversionRow = {
  id: string;
  status: string;
  prepared_by: string | null;
  products: any[] | null;
  accepted_items: number[] | null;
  executed_amount: string | number | null;
  sent_at: string | Date | null;
  accepted_at: string | Date | null;
  executed_at: string | Date | null;
};

const ACCEPTED = new Set(["accepted", "partially_approved", "executed"]);

export type Bucket = {
  sent: number;
  accepted: number;
  executed: number;
  proposedValue: number;
  acceptedValue: number;
  executedValue: number;
};

const empty = (): Bucket => ({ sent: 0, accepted: 0, executed: 0, proposedValue: 0, acceptedValue: 0, executedValue: 0 });

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const days = (a: string | Date | null, b: string | Date | null) =>
  a && b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 864e5) : null;

export type Conversion = {
  total: Bucket;
  byRm: Array<{ rm: string } & Bucket>;
  bySchemes: Array<{ scheme: string; proposed: number; accepted: number }>;
  /** Median days sent → accepted, and accepted → first money in. */
  daysToAccept: number | null;
  daysToExecute: number | null;
};

export function summariseConversion(rows: ConversionRow[]): Conversion {
  const total = empty();
  const rms = new Map<string, Bucket>();
  const schemes = new Map<string, { proposed: number; accepted: number }>();
  const toAccept: number[] = [];
  const toExecute: number[] = [];

  for (const r of rows) {
    if (!r.sent_at) continue;
    const items = Array.isArray(r.products) ? r.products : [];
    const taken = Array.isArray(r.accepted_items) ? new Set(r.accepted_items) : null;
    const won = ACCEPTED.has(r.status);
    const proposed = proposalValue(items);
    const acceptedValue = won ? proposalValue(taken ? items.filter((_, i) => taken.has(i)) : items) : 0;
    const executedValue = Number(r.executed_amount ?? 0);

    const rm = rms.get(r.prepared_by ?? "—") ?? empty();
    for (const b of [total, rm]) {
      b.sent++;
      b.proposedValue += proposed;
      if (won) {
        b.accepted++;
        b.acceptedValue += acceptedValue;
      }
      if (r.status === "executed" || executedValue > 0) {
        b.executed++;
        b.executedValue += executedValue;
      }
    }
    rms.set(r.prepared_by ?? "—", rm);

    items.forEach((it, i) => {
      const name = itemName(it);
      const s = schemes.get(name) ?? { proposed: 0, accepted: 0 };
      s.proposed++;
      if (won && (!taken || taken.has(i))) s.accepted++;
      schemes.set(name, s);
    });

    const a = days(r.sent_at, r.accepted_at);
    if (won && a != null) toAccept.push(a);
    const e = days(r.accepted_at, r.executed_at);
    if (e != null) toExecute.push(e);
  }

  return {
    total,
    byRm: [...rms.entries()].map(([rm, b]) => ({ rm, ...b })).sort((x, y) => y.proposedValue - x.proposedValue),
    bySchemes: [...schemes.entries()]
      .map(([scheme, s]) => ({ scheme, ...s }))
      .sort((x, y) => y.proposed - x.proposed)
      .slice(0, 15),
    daysToAccept: median(toAccept),
    daysToExecute: median(toExecute),
  };
}
