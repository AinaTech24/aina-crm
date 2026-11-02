/**
 * Personal-data breaches under the DPDP Rules, 2025 (Rule 7), with no
 * database — the register is lib/privacy/breaches.ts.
 *
 * On becoming aware of a breach the firm must, without delay:
 *   - tell each affected person: what happened (nature, extent, timing,
 *     location), the likely consequences for them, what the firm is doing,
 *     what they can do to protect themselves, and whom to contact;
 *   - tell the Data Protection Board, and within 72 hours send it a detailed
 *     report: the facts and reasons, what was done to mitigate, who caused it
 *     (if known), what will stop it recurring, and the intimations given.
 * The two texts below are built from the register so nothing required is left out.
 */

export const REPORT_HOURS = 72;

export function reportDueFor(detectedAt: Date): Date {
  return new Date(detectedAt.getTime() + REPORT_HOURS * 3600 * 1000);
}

/** "BR-2026-0003" — the firm's next breach number in the year. */
export function breachReference(year: number, seq: number): string {
  return `BR-${year}-${String(seq).padStart(4, "0")}`;
}

/** Whole hours until the 72-hour report is due (negative = late). */
export function hoursLeft(due: Date, now: Date = new Date()): number {
  return Math.floor((due.getTime() - now.getTime()) / 3600000);
}

export type BreachFacts = {
  reference: string;
  title: string;
  detectedAt: Date;
  occurredAt: Date | null;
  description: string | null;
  dataAffected: string | null;
  affectedCount: number | null;
  cause: string | null;
  consequences: string | null;
  mitigation: string | null;
  personSteps: string | null;
  peopleNotifiedAt: Date | null;
  peopleNotifiedCount: number | null;
};

export type FirmFacts = { name: string; contact: string | null };

const ist = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

const blank = "[to be filled in]";
const or = (v: string | null | undefined) => (v && v.trim() ? v.trim() : blank);

/** What each affected person must be told (Rule 7(1)). */
export function personNotice(b: BreachFacts, firm: FirmFacts): string {
  return [
    `Important: a security incident involving your personal data`,
    ``,
    `Dear client,`,
    ``,
    `We are writing to tell you about a security incident at ${firm.name} that involved your personal data.`,
    ``,
    `What happened: ${or(b.description)}`,
    `When: ${b.occurredAt ? `it happened on ${ist(b.occurredAt)}; ` : ""}we became aware of it on ${ist(b.detectedAt)}.`,
    `What data was involved: ${or(b.dataAffected)}`,
    ``,
    `What this could mean for you: ${or(b.consequences)}`,
    ``,
    `What we are doing: ${or(b.mitigation)}`,
    ``,
    `What you can do: ${or(b.personSteps)}`,
    ``,
    `If you have any questions, please contact ${firm.contact ?? "your relationship manager"}.`,
    ``,
    `We are sorry this happened.`,
    ``,
    firm.name,
  ].join("\n");
}

/** The detailed report the Data Protection Board must have within 72 hours (Rule 7(2)(b)). */
export function boardReport(b: BreachFacts, firm: FirmFacts): string {
  return [
    `Personal data breach report — ${firm.name} (reference ${b.reference})`,
    ``,
    `1. Facts of the breach`,
    `   What happened: ${or(b.description)}`,
    `   Occurred: ${b.occurredAt ? ist(b.occurredAt) : "not yet known"}`,
    `   Became aware: ${ist(b.detectedAt)}`,
    `   Personal data involved: ${or(b.dataAffected)}`,
    `   People affected: ${b.affectedCount != null ? b.affectedCount : "being established"}`,
    ``,
    `2. Circumstances and reasons: ${or(b.cause)}`,
    ``,
    `3. Measures taken or proposed to mitigate the risk: ${or(b.mitigation)}`,
    ``,
    `4. Likely consequences for the people affected: ${or(b.consequences)}`,
    ``,
    `5. Remedial measures to prevent a recurrence: ${or(b.mitigation)}`,
    ``,
    `6. Intimation to the people affected: ${
      b.peopleNotifiedAt
        ? `${b.peopleNotifiedCount ?? "All"} affected people were informed on ${ist(b.peopleNotifiedAt)}.`
        : "being sent."
    }`,
    ``,
    `Contact for this report: ${firm.contact ?? blank}`,
  ].join("\n");
}
