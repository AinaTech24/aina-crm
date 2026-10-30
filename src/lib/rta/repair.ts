/**
 * The rules scripts/repair-rta-transactions.ts applies to transactions stored
 * before the 29 Oct 2026 import fixes — pure, so they are tested on their own
 * (tests/rta-repair.test.ts). The import itself applies the same rules to new
 * rows (lib/rta/process.ts); this is the one-off for the rows already there.
 */
import { folioKey } from "./process";

/** A folio row, as the repair reads it. */
export type FolioRef = { id: string; folioNumber: string; amcCode: string; investorId: string | null };

/**
 * The folio a transaction belongs to, from its OWN folio number. Its folio
 * link was rewritten by another AMC's transaction that shared its number
 * (the old import key); the row's folio number, client and AMC are still its
 * own. Same rule as the import: one candidate → it; several → the row's AMC,
 * then the row's client; still unclear → null (left alone and reported).
 */
export function chooseFolioFor(
  row: { folioNumber: string; amcCode: string; investorId: string | null },
  candidates: FolioRef[],
): string | null {
  const mine = candidates.filter((c) => folioKey(c.folioNumber) === folioKey(row.folioNumber));
  if (!mine.length) return null;
  if (mine.length === 1) return mine[0].id;
  const amc = row.amcCode.trim().toUpperCase();
  const byAmc = amc ? mine.filter((c) => c.amcCode.trim().toUpperCase() === amc) : [];
  if (byAmc.length === 1) return byAmc[0].id;
  const pool = byAmc.length ? byAmc : mine;
  const byClient = row.investorId ? pool.filter((c) => c.investorId === row.investorId) : [];
  return byClient.length === 1 ? byClient[0].id : null;
}

/** A transaction, as reversal matching reads it. */
export type RepairTxn = {
  id: string;
  /** folioKey | scheme code | type */
  key: string;
  /** YYYY-MM-DD */
  date: string;
  /** Absolute units. */
  units: number;
  /** Absolute amount. */
  amount: number;
};

export const REVERSAL_WINDOW_DAYS = 120;

const daysBetween = (a: string, b: string) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5;

/**
 * Pair each reversal with the transaction it reverses: the LATEST still-
 * unpaired one with the same folio, scheme and type, the same units (±0.001)
 * and amount (±₹1), dated on or up to 120 days before it. Oldest reversal
 * first, and each original is used at most once, so two reversals never cancel
 * one purchase and a reversal never cancels a later, genuine one.
 *
 * Returns reversal id → original id; a reversal with no partner is absent
 * (it is still cancelled itself — it is not money in — but cancels nothing).
 */
export function matchReversals(
  reversals: RepairTxn[],
  originals: RepairTxn[],
  windowDays = REVERSAL_WINDOW_DAYS,
): Map<string, string> {
  const byKey = new Map<string, RepairTxn[]>();
  for (const o of originals) {
    const list = byKey.get(o.key) ?? [];
    list.push(o);
    byKey.set(o.key, list);
  }
  for (const list of byKey.values()) list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  const used = new Set<string>();
  const out = new Map<string, string>();
  const ordered = [...reversals].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const r of ordered) {
    for (const o of byKey.get(r.key) ?? []) {
      if (used.has(o.id) || o.id === r.id) continue;
      const gap = daysBetween(r.date, o.date);
      if (gap < 0 || gap > windowDays) continue;
      if (Math.abs(o.units - r.units) > 0.001 || Math.abs(o.amount - r.amount) > 1) continue;
      used.add(o.id);
      out.set(r.id, o.id);
      break;
    }
  }
  return out;
}
