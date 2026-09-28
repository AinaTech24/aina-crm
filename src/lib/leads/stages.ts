/**
 * Canonical lead/blueprint stage presentation — ONE source of truth for how a
 * stage looks (colour) and reads (label), covering every value in the leads
 * stage enum (50+: lead-phase, client-phase, onboarding, legacy).
 *
 * Previously each surface kept its own partial colour map, so the lead detail
 * page only coloured 7 legacy stages and everything else rendered as a blank
 * chip. This maps stages to a small set of tones by FAMILY (with a graceful
 * slate fallback), so any stage — current or future — always renders sensibly.
 *
 * It is also where the lead PIPELINE is defined for display: the Leads kanban,
 * the Leads list, the stage filters, the dashboard's lead pipeline and every
 * stage picker read their labels from here, so a stage is called the same thing
 * on every screen (the dashboard used to say "New Lead Created" and "Won Lead"
 * while the kanban said "New" and "Won Lead").
 */

import { LEAD_TO_CLIENT_STAGES } from "@/lib/blueprints/lead_to_client";
import { LEAD_STAGE_ALIASES } from "@/lib/leads/normalize";

export type StageTone = "blue" | "cyan" | "amber" | "indigo" | "purple" | "teal" | "emerald" | "rose" | "slate";

/**
 * The pipeline as people see it: six columns, New → Contacted → Meeting
 * Scheduled → Meeting Done → Won / Lost.
 *
 * The blueprint behind it has ten lead-phase stages. Four of them are LOOPS
 * (the blueprint's own flavour for them): a call back later, a call that did
 * not connect, a lead parked for the future, a meeting not yet confirmed.
 * They are real states, and leads.stage keeps them, but they are outcomes of a
 * step rather than steps: a column each made the board ten wide and scroll
 * sideways. Here they fold into the step they belong to and show on the card
 * as a tag (LEAD_STAGE_TAG). Legacy / imported values fold the same way.
 *
 * `key` is the stage a card DROPPED on the column moves to.
 */
export type LeadPipelineColumn = {
  key: string;
  label: string;
  tone: StageTone;
  /** Every leads.stage value that sits in this column. */
  members: readonly string[];
};

const PIPELINE_BASE: readonly LeadPipelineColumn[] = [
  { key: "new", label: "New", tone: "blue", members: ["new"] },
  {
    key: "call_done",
    label: "Contacted",
    tone: "cyan",
    members: ["call_done", "call_back_later", "call_not_connected", "contact_in_future", "contacted", "first_call_pending", "follow_up"],
  },
  {
    key: "meeting_scheduled",
    label: "Meeting Scheduled",
    tone: "amber",
    members: ["meeting_scheduled", "meeting_pending", "appointment_scheduled", "qualified"],
  },
  { key: "meeting_done", label: "Meeting Done", tone: "indigo", members: ["meeting_done"] },
  { key: "won_lead", label: "Won", tone: "emerald", members: ["won_lead", "converted", "post_meeting_qualified"] },
  { key: "not_qualified", label: "Lost", tone: "rose", members: ["not_qualified", "lost", "not_interested", "cold"] },
];

/**
 * Each column also takes every legacy value the stage normaliser folds onto one
 * of its members (a CSV's `proposal_sent` counts as Won on the dashboard), so
 * the Leads page shows exactly the leads the dashboard counts.
 */
export const LEAD_PIPELINE: readonly LeadPipelineColumn[] = PIPELINE_BASE.map((c) => {
  const folded = Object.entries(LEAD_STAGE_ALIASES)
    .filter(([alias, target]) => c.members.includes(target) && !c.members.includes(alias))
    .map(([alias]) => alias);
  return { ...c, members: [...c.members, ...folded] };
});

/** Every stage value the Leads module shows (all columns' members). */
export const LEAD_PIPELINE_STAGE_VALUES: readonly string[] = LEAD_PIPELINE.flatMap((c) => c.members);

/** The column a stage value sits in, or null for a stage past the lead phase. */
export function leadPipelineColumn(stage: string | null | undefined): LeadPipelineColumn | null {
  if (!stage) return null;
  return LEAD_PIPELINE.find((c) => c.members.includes(stage)) ?? null;
}

/** The outcome a loop stage stands for, shown as a tag on the card and list row. */
export const LEAD_STAGE_TAG: Record<string, string> = {
  call_back_later: "Call back later",
  call_not_connected: "Call not connected",
  contact_in_future: "Contact in future",
  follow_up: "Contact in future",
  meeting_pending: "Meeting pending",
};

/**
 * A stage's full name where it stands alone (a picker, a list cell):
 * "Contacted · Call back later" for a loop stage, the plain label otherwise.
 */
export function leadStageDisplay(stage: string | null | undefined): string {
  if (!stage) return "—";
  const tag = LEAD_STAGE_TAG[stage];
  const column = leadPipelineColumn(stage);
  if (tag && column) return `${column.label} · ${tag}`;
  // A folded legacy value ("proposal_sent", "qualified") reads as its column.
  return column ? column.label : stageLabel(stage);
}

/**
 * How many days a lead may sit in its stage, from the blueprint's `slaDays`
 * (null = no SLA). The same numbers the dashboard counts "past stage SLA" with.
 */
export function leadStageSlaDays(stage: string | null | undefined): number | null {
  if (!stage) return null;
  const key = LEAD_STAGE_ALIASES[stage] ?? stage;
  return LEAD_TO_CLIENT_STAGES.find((s) => s.key === key)?.slaDays ?? null;
}

const TONE_CLASS: Record<StageTone, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
};

/** Explicit overrides for human-friendly labels where title-case isn't enough. */
const LABEL_OVERRIDES: Record<string, string> = {
  kyc_validated: "KYC Validated",
  kyc_registered: "KYC Registered",
  kyc_pending: "KYC Pending",
  modify_kyc: "Modify KYC",
  physical_kyc: "Physical KYC",
  online_kyc: "Online KYC",
  ucc_create: "Create UCC",
  ucc_activated: "UCC Activated",
  mandate_create: "Create Mandate",
  mandate_activated: "Mandate Activated",
  mandate_reject: "Mandate Rejected",
  mandate_rejected: "Mandate Rejected",
  add_in_review_sheet: "Active Client",
  // Lead phase: the pipeline's column names, and the loop stages' tag wording.
  new: "New",
  call_done: "Contacted",
  contacted: "Contacted",
  call_back_later: "Call back later",
  call_not_connected: "Call not connected",
  contact_in_future: "Contact in future",
  meeting_pending: "Meeting pending",
  won_lead: "Won",
  not_qualified: "Lost",
};

/** Title-case a snake_case stage key. */
export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  if (LABEL_OVERRIDES[stage]) return LABEL_OVERRIDES[stage];
  return stage
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Map a stage to a tone by family. */
export function stageTone(stage: string | null | undefined): StageTone {
  const s = stage ?? "";
  // Terminal-negative
  if (/(^|_)(lost|not_interested|not_qualified|cold|reject|rejected|failed)$/.test(s) || s === "cold") return "rose";
  // Won / completed
  if (/(converted|won_lead|transaction_successful|ucc_activated|mandate_activated|kyc_validated|kyc_registered|add_in_review_sheet)/.test(s)) return "emerald";
  // New / top of funnel
  if (s === "new") return "blue";
  // Contact attempts
  if (/(contacted|call_done|call_back_later|call_not_connected|contact_in_future|follow_up)/.test(s)) return "cyan";
  // Meetings
  if (/meeting/.test(s)) return "amber";
  // Proposal / risk
  if (/(proposal|risk_profile|risk_profiled)/.test(s)) return "purple";
  // Onboarding / ops (docs, kyc, ucc, mandate, transaction)
  if (/(doc|kyc|ucc|mandate|transaction|family_mapping|update_information)/.test(s)) return "indigo";
  if (/qualified/.test(s)) return "teal";
  return "slate";
}

/** Combined chip class for a stage (border + bg + text). */
export function stageBadgeClass(stage: string | null | undefined): string {
  return TONE_CLASS[stageTone(stage)];
}
