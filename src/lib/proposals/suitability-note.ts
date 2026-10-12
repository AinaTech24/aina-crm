/**
 * The suitability note — the written reason a proposal suits the client.
 *
 * Every proposal needs one before it can be sent, and typing the same few
 * sentences for every client is slow, so the note is DRAFTED from the
 * proposal's own data: the client's name, their confirmed risk profile, the
 * goal and horizon on the recommendation, the funds and the amounts. The
 * advisor reads it, adds what only they know, and saves it.
 *
 * It states only what the records show — never that the client has "agreed",
 * "understood" or has "surplus" money; those are the advisor's own words to
 * add. Plain module (no "use client"): the builder, the proposal page and the
 * send dialog all call it.
 *
 * The template is the text below. {tokens} are filled from the proposal; a
 * [bracketed part] and any sentence whose token has no value are left out, so
 * a missing horizon or goal never prints as a blank.
 */

import type { ProposalLineItem } from "@/db/schema/proposals";
import { checkAlignment, type ClientProfile } from "@/lib/proposal/risk-alignment";
import { itemMonthly, itemName, itemOneTime } from "@/lib/proposals/items";

export const SUITABILITY_TEMPLATE = [
  "Recommended for {client}'s goal of {goal}[ over {horizon}].",
  "{client}'s confirmed risk profile is {risk_profile}, and {fit}.",
  "{exceptions}",
  "The recommendation is {investment}.",
].join("\n");

export type SuitabilityContext = {
  /** The client's name as the proposal shows it. */
  clientName: string;
  /** conservative / moderate / aggressive / very_aggressive — only when the client has CONFIRMED it. */
  riskProfile?: string | null;
  /** The client's recorded goals, used when the recommendation names none. */
  goals?: Array<{ name: string; targetYear?: number | null }>;
  items: Array<ProposalLineItem | any>;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const RISK_LABEL: Record<string, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
  very_aggressive: "Very aggressive",
};

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function listOf(names: string[], max = 3): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  const shown = unique.slice(0, max);
  const more = unique.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** The values for each {token}; a token with no value is absent. */
export function suitabilityValues(ctx: SuitabilityContext): Record<string, string> {
  const out: Record<string, string> = {};
  const clientName = ctx.clientName.trim();
  if (clientName) out.client = clientName;

  const mf = ctx.items.filter((it) => it?.kind === "mf");
  const key = String(ctx.riskProfile ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const profile = RISK_LABEL[key] ? (key as NonNullable<ClientProfile>) : null;
  if (profile) out.risk_profile = RISK_LABEL[profile];

  // The goal the recommendation names; failing that, the client's own.
  const goal =
    mf.map((it) => String(it.goal ?? "").trim()).find(Boolean) ??
    (ctx.goals?.[0]?.name ? ctx.goals[0].name.trim() : "");
  // Written in a sentence: "Wealth Creation" reads "wealth creation"; an acronym ("NPS") keeps its capitals.
  if (goal) out.goal = goal.replace(/\b([A-Z])([a-z']+)\b/g, (_, a: string, b: string) => a.toLowerCase() + b);

  const years = Math.max(0, ...mf.map((it) => Number(it.sipTermYears) || 0));
  if (years > 0) out.horizon = `${years} year${years === 1 ? "" : "s"}`;

  // How the funds sit against the profile.
  const names = mf.map((it) => itemName(it));
  if (names.length && profile) {
    const alignment = checkAlignment(profile, mf.map((it) => ({ name: itemName(it), riskRating: (it.riskRating ?? null) as any })));
    // "Within that risk level" is claimed only when EVERY fund carries a risk rating and none is above the
    // profile; a fund with no rating has not been checked, so it is "reviewed against", never "within".
    const allRated = mf.every((it) => !!it.riskRating);
    out.fit =
      alignment.overall === "ok" && allRated
        ? `the recommended ${names.length === 1 ? "fund" : "funds"} (${listOf(names)}) ${names.length === 1 ? "is" : "are"} within that risk level`
        : `the recommended ${names.length === 1 ? "fund" : "funds"} (${listOf(names)}) ${names.length === 1 ? "was" : "were"} reviewed against it`;

    // A fund kept above the client's level is explained only with the reason the advisor recorded on it.
    const above = alignment.findings.filter((f) => f.severity !== "ok").map((f) => f.schemeName);
    const reasons = mf
      .filter((it) => above.includes(itemName(it)) && String(it.suitabilityReason ?? "").trim())
      .map((it) => `${itemName(it)} is kept above the client's risk level because ${String(it.suitabilityReason).trim().replace(/[.\s]+$/, "")}.`);
    if (reasons.length) out.exceptions = reasons.join(" ");
  }

  // What goes in, line by line, so each amount sits against its own fund; a long list is summed instead.
  const lines: string[] = [];
  let monthly = 0, oneTime = 0;
  for (const it of ctx.items) {
    const m = itemMonthly(it), o = itemOneTime(it), name = itemName(it);
    if (m) { monthly += m; lines.push(`a monthly SIP of ${inr(m)} in ${name}`); }
    if (o) { oneTime += o; lines.push(`a lumpsum of ${inr(o)} in ${name}`); }
  }
  if (lines.length && lines.length <= 3) {
    out.investment = lines.length === 1 ? lines[0] : `${lines.slice(0, -1).join(", ")} and ${lines[lines.length - 1]}`;
  } else if (lines.length) {
    const totals = [monthly > 0 && `monthly SIPs totalling ${inr(monthly)}`, oneTime > 0 && `lumpsums totalling ${inr(oneTime)}`].filter(Boolean) as string[];
    out.investment = `${totals.join(" and ")} across ${listOf(names)}`;
  }
  return out;
}

/** The template filled in. Empty when the proposal says too little to draft anything useful. */
export function draftSuitabilityNote(ctx: SuitabilityContext, template = SUITABILITY_TEMPLATE): string {
  const values = suitabilityValues(ctx);
  const fill = (text: string): string | null => {
    let missing = false;
    const done = text.replace(/\{(\w+)\}/g, (_, k: string) => {
      if (values[k] == null) missing = true;
      return values[k] ?? "";
    });
    return missing ? null : done;
  };
  const lines = template
    .split("\n")
    .map((line) => {
      // Optional [parts] first: dropped when a token in them has no value.
      const withOptional = line.replace(/\[([^\]]*)\]/g, (_, inner: string) => fill(inner) ?? "");
      return fill(withOptional);
    })
    .filter((l): l is string => !!l && l.trim().length > 0);
  // Fewer than two sentences is a stub, not a note: leave the box for the advisor.
  return lines.length >= 2 ? lines.join(" ") : "";
}
