/**
 * The firm's retention policy (DPDP Act s.8(7): erase personal data once the
 * purpose is served, unless a law requires it to be kept). No database here,
 * so the rules can be tested; the nightly job is lib/privacy/retention.ts.
 *
 * Off until the firm sets it — erasing is irreversible, so it is the firm's
 * decision, made once it has seen what would go (Settings → Privacy notice).
 *
 * - Lost leads: a lead lost, not interested or deleted is erased after N
 *   months (at least 6, so a late follow-up still has its record).
 * - Former clients: purged N years after the relationship ended — never fewer
 *   than five, the Prevention of Money Laundering Act's minimum — and never
 *   while they hold money with the registrar.
 */

import { z } from "zod";
import { RETENTION_YEARS } from "./requests-core";

export const RetentionSettingsSchema = z.object({
  lostLeadMonths: z.number().int().min(6).max(120).nullable().default(null),
  formerClientYears: z.number().int().min(RETENTION_YEARS).max(20).nullable().default(null),
});
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>;

export type RetentionRun = { at: string; leads: number; clients: number };
/** lastRun: the latest night the job ran; lastErased: the latest night it erased anything. */
export type StoredRetention = RetentionSettings & { lastRun: RetentionRun | null; lastErased: RetentionRun | null };

export function readRetention(raw: unknown): StoredRetention {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = RetentionSettingsSchema.safeParse({
    lostLeadMonths: obj.lostLeadMonths ?? null,
    formerClientYears: obj.formerClientYears ?? null,
  });
  const base = parsed.success ? parsed.data : { lostLeadMonths: null, formerClientYears: null };
  const run = (v: unknown) => (v && typeof (v as RetentionRun).at === "string" ? (v as RetentionRun) : null);
  return { ...base, lastRun: run(obj.lastRun), lastErased: run(obj.lastErased) };
}

export const retentionIsOn = (s: RetentionSettings) => s.lostLeadMonths != null || s.formerClientYears != null;

/** The date before which a lost lead / a client's exit makes them due. */
export function cutoffs(s: RetentionSettings, now: Date = new Date()): { leadsBefore: Date | null; clientsExitedBefore: Date | null } {
  const back = (months: number) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - months);
    return d;
  };
  return {
    leadsBefore: s.lostLeadMonths != null ? back(s.lostLeadMonths) : null,
    clientsExitedBefore: s.formerClientYears != null ? back(s.formerClientYears * 12) : null,
  };
}

/** At most this many of each per firm per night — a first run on an old book is spread out. */
export const NIGHTLY_LIMIT = { leads: 500, clients: 200 } as const;
