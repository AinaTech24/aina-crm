/**
 * Family-level health + missing-data helpers.
 *
 * Pure functions, no DB calls. Feed them the family row + its members (the
 * same shapes the family pages load from drizzle).
 *
 * Who counts: LIVE members only — not deleted, not merged into another
 * record, not closed (the same rule as lib/metrics `aliveClient`, so the
 * family and the Clients list agree on who a client is). A merged-away
 * duplicate used to stay a "member" and count against nominee coverage.
 *
 * Score model — 100 minus deductions:
 *   - 15  no head of family (or the head set is not a live member)
 *   - 10  family RM not assigned
 *   - 12  never reviewed as a family; 10 when the review is overdue — overdue
 *         against the family's own next-review date when it has one (its
 *         cadence), else a year after the last review
 *   -  varies  nominee / KYC-verified / signed-risk-profile coverage <100%
 *   - 10  no next-gen member captured (no minor, no one under 35)
 *   -  5  only one member captured
 * A family with no live member is scored on its family-level facts alone —
 * it used to be scored as one imaginary member with every gap.
 */

import type { HealthBand } from "@/lib/investors/health";
import { canNominate, type ClientTypeDetails } from "@/lib/investors/client-types";

export type FamilyForHealth = {
  primaryInvestorId?: string | null;
  rmId?: string | null;
  lastReviewAt?: Date | string | null;
  nextReviewAt?: Date | string | null;
};

export type MemberForHealth = {
  id: string;
  name?: string | null;
  status?: string | null;
  deletedAt?: Date | string | null;
  mergedIntoId?: string | null;
  dob?: Date | string | null;
  isMinor?: boolean | null;
  kycStatus?: string | null;
  nomineeName?: string | null;
  nominees?: unknown;
  /** The client type — only an individual nominates. */
  investorCategory?: string | null;
  typeDetails?: ClientTypeDetails | null;
  riskProfile?: string | null;
  riskProfileSignedAt?: Date | string | null;
  aum?: string | number | null;
  activeSipAmount?: string | number | null;
};

export type FamilyHealthBreakdown = {
  score: number;
  band: HealthBand;
  factors: Array<{
    key: string;
    label: string;
    deduction: number;
    why: string;
  }>;
  coverage: {
    nomineePct: number;
    kycPct: number;
    riskProfilePct: number;
  };
  hasNextGen: boolean;
  activeMemberCount: number;
};

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysSince(v: Date | string | null | undefined, now = new Date()): number | null {
  const d = toDate(v);
  if (!d) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/** A member we still serve: not deleted, not merged away, not closed. */
export function isLiveMember(m: Pick<MemberForHealth, "status" | "deletedAt" | "mergedIntoId">): boolean {
  return !m.deletedAt && !m.mergedIntoId && m.status !== "closed" && m.status !== "exited";
}

/** Age in whole years, or null without a usable date of birth. */
export function memberAge(m: Pick<MemberForHealth, "dob">, now = new Date()): number | null {
  const dob = toDate(m.dob ?? null);
  if (!dob) return null;
  return Math.floor((now.getTime() - dob.getTime()) / (365.25 * 86_400_000));
}

/** Has a nominee on file (the multi-nominee list or the legacy single field). */
export function hasNominee(m: Pick<MemberForHealth, "nomineeName" | "nominees">): boolean {
  if (m.nomineeName && m.nomineeName.trim() !== "") return true;
  return Array.isArray(m.nominees) && m.nominees.some((n: any) => n && String(n.name ?? "").trim() !== "");
}

/**
 * Whether this member nominates at all. Only an individual does (SEBI; the
 * firm's rule, lib/investors/client-types.ts): an HUF, a minor or an entity
 * never has a nominee gap.
 */
export function nominationApplies(m: Pick<MemberForHealth, "investorCategory">): boolean {
  return canNominate(m.investorCategory);
}

/**
 * A member who should have a nominee and has neither one on file nor a
 * recorded opt-out — lib/investors/type-rules needsNominee, for a member.
 */
export function nomineeGap(m: Pick<MemberForHealth, "investorCategory" | "typeDetails" | "nomineeName" | "nominees">): boolean {
  return nominationApplies(m) && !m.typeDetails?.nominationOptOut && !hasNominee(m);
}

/**
 * A next-generation PROSPECT: a minor, or an 18–30-year-old, who is not yet
 * investing (no AUM). The one definition — the family page, the next-gen view
 * and the engage action all use it.
 */
export function isNextGenProspect(m: MemberForHealth, now = new Date()): boolean {
  if (Number(m.aum ?? 0) > 0) return false;
  if (m.isMinor) return true;
  const age = memberAge(m, now);
  return age != null && age >= 18 && age <= 30;
}

/** The next generation is CAPTURED when a minor or someone under 35 is a member. */
function isNextGenMember(m: MemberForHealth, now: Date): boolean {
  if (m.isMinor) return true;
  const age = memberAge(m, now);
  return age != null && age < 35;
}

/** Overdue review: against the family's next-review date when set, else a year after the last. */
export function familyReviewState(family: FamilyForHealth, now = new Date()): "never" | "overdue" | "ok" {
  const next = toDate(family.nextReviewAt ?? null);
  const last = toDate(family.lastReviewAt ?? null);
  if (!last && !next) return "never";
  if (next) return next.getTime() < now.getTime() ? (last ? "overdue" : "never") : "ok";
  return (daysSince(last, now) ?? 0) > 365 ? "overdue" : "ok";
}

export function familyHealth(
  family: FamilyForHealth,
  members: MemberForHealth[],
  now = new Date()
): FamilyHealthBreakdown {
  const factors: FamilyHealthBreakdown["factors"] = [];
  let score = 100;

  const live = members.filter(isLiveMember);
  const total = live.length;

  // 1. Head of family — must be a live member, not just a stored id.
  const headIsMember = !!family.primaryInvestorId && live.some((m) => m.id === family.primaryInvestorId);
  if (!headIsMember) {
    factors.push({
      key: "primary",
      label: "Head of family not set",
      deduction: 15,
      why: "Without a head, decisions and routing get ambiguous",
    });
    score -= 15;
  }

  // 2. Family RM
  if (!family.rmId) {
    factors.push({
      key: "rm",
      label: "Family RM not assigned",
      deduction: 10,
      why: "Assign one RM so the family has a single point of contact",
    });
    score -= 10;
  }

  // 3. Review cadence
  const review = familyReviewState(family, now);
  if (review === "never") {
    factors.push({
      key: "review",
      label: "Never reviewed as a family",
      deduction: 12,
      why: "Schedule the first family review",
    });
    score -= 12;
  } else if (review === "overdue") {
    factors.push({
      key: "review",
      label: "Family review overdue",
      deduction: 10,
      why: "The review the family's cadence calls for has passed",
    });
    score -= 10;
  }

  // 4. Coverage across live members (only when there are any)
  // Nominee coverage counts only members who nominate (individuals).
  const nominating = live.filter(nominationApplies);
  const withNominee = nominating.filter((m) => !nomineeGap(m)).length;
  const withKyc = live.filter((m) => m.kycStatus === "verified").length;
  const withRp = live.filter((m) => m.riskProfile && m.riskProfileSignedAt).length;

  const nomineePct = nominating.length > 0 ? (withNominee / nominating.length) * 100 : 100;
  const kycPct = total > 0 ? (withKyc / total) * 100 : 0;
  const riskProfilePct = total > 0 ? (withRp / total) * 100 : 0;

  if (nominating.length > 0 && nomineePct < 100) {
    const gap = nominating.length - withNominee;
    const ded = nomineePct < 50 ? 15 : nomineePct < 80 ? 10 : 5;
    factors.push({
      key: "nominee",
      label: `${gap} member${gap === 1 ? "" : "s"} without nominee`,
      deduction: ded,
      why: "Transmission risk — every member needs a nominee on file",
    });
    score -= ded;
  }

  if (total > 0 && kycPct < 100) {
    const gap = total - withKyc;
    const ded = kycPct < 50 ? 10 : 5;
    factors.push({
      key: "kyc",
      label: `${gap} member${gap === 1 ? "" : "s"} KYC not verified`,
      deduction: ded,
      why: "Unverified members can't transact freely",
    });
    score -= ded;
  }

  if (total > 0 && riskProfilePct < 100) {
    const gap = total - withRp;
    const ded = riskProfilePct < 50 ? 8 : 5;
    factors.push({
      key: "risk_profile",
      label: `${gap} member${gap === 1 ? "" : "s"} without signed risk profile`,
      deduction: ded,
      why: "SEBI requires a signed risk profile per advised client",
    });
    score -= ded;
  }

  // 5. Next-gen capture
  const hasNextGen = live.some((m) => isNextGenMember(m, now));
  if (!hasNextGen && total >= 2) {
    factors.push({
      key: "next_gen",
      label: "No next-gen member captured",
      deduction: 10,
      why: "Retention drops sharply at generational handoff without next-gen onboarding",
    });
    score -= 10;
  }

  // 6. Single-member family
  if (total === 1) {
    factors.push({
      key: "single_member",
      label: "Only one member captured",
      deduction: 5,
      why: "Onboarding spouse/children is one of the fastest wallet-share wins",
    });
    score -= 5;
  }

  const clamped = Math.max(0, Math.min(100, score));

  return {
    score: clamped,
    band: clamped >= 80 ? "green" : clamped >= 60 ? "amber" : "red",
    factors,
    coverage: { nomineePct, kycPct, riskProfilePct },
    hasNextGen,
    activeMemberCount: total,
  };
}

/**
 * Convenience: the persistable family-health columns. Spread into a Drizzle
 * insert/update. Pure (no DB) — the persist layer loads the members and calls
 * this. `band` is the familyHealth band.
 */
export function familyHealthFields(
  family: FamilyForHealth,
  members: MemberForHealth[],
  now = new Date()
): { healthScore: number; healthBand: HealthBand; healthScoredAt: Date } {
  const { score, band } = familyHealth(family, members, now);
  return { healthScore: score, healthBand: band, healthScoredAt: now };
}

/**
 * The household's gaps, as one ordered checklist — the ONLY place the family
 * page lists them (nominee coverage used to appear five times, with two
 * different percentages). Each item says what to do and, where there is one,
 * links to the place to do it.
 */
export type MissingItem = {
  key: string;
  label: string;
  severity: "high" | "medium";
  action?: { href: string; label: string };
};

export function familyMissingChecklist(
  familyId: string,
  family: FamilyForHealth,
  members: MemberForHealth[],
  now = new Date()
): MissingItem[] {
  const items: MissingItem[] = [];
  const live = members.filter(isLiveMember);

  if (!family.primaryInvestorId || !live.some((m) => m.id === family.primaryInvestorId)) {
    items.push({
      key: "primary",
      label: "Set the head of family",
      severity: "high",
      action: live.length ? { href: "#family-details", label: "Set" } : undefined,
    });
  }
  if (!family.rmId) {
    items.push({ key: "rm", label: "Assign a family RM", severity: "high", action: { href: "#family-details", label: "Assign" } });
  }
  const review = familyReviewState(family, now);
  if (review !== "ok") {
    items.push({
      key: "review",
      label: review === "never" ? "Schedule the first family review" : "Family review is overdue",
      severity: "medium",
      action: { href: `/dashboard/review-meetings/new?familyId=${familyId}&meetingType=family_review`, label: "Schedule" },
    });
  }

  for (const m of live) {
    const who = m.name ?? "member";
    if (nomineeGap(m)) {
      items.push({ key: `nominee-${m.id}`, label: `Add a nominee for ${who}`, severity: "high", action: { href: `/dashboard/investors/${m.id}#rel-nominees`, label: "Open" } });
    }
    if (m.kycStatus !== "verified") {
      items.push({ key: `kyc-${m.id}`, label: `KYC ${m.kycStatus ? m.kycStatus.replace(/_/g, " ") : "not recorded"} for ${who}`, severity: "high", action: { href: `/dashboard/investors/${m.id}`, label: "Open" } });
    }
    if (!m.riskProfile || !m.riskProfileSignedAt) {
      items.push({ key: `rp-${m.id}`, label: `Risk profile missing for ${who}`, severity: "medium", action: { href: `/dashboard/risk-profiles/new?investorId=${m.id}`, label: "Start" } });
    }
  }

  return items;
}
