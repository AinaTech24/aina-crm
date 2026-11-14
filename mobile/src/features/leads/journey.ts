/**
 * The lead journey, as the CRM runs it — a port of the lead-phase part of
 * src/lib/blueprints/stage-actions.ts (STAGE_ACTIONS) and the rules of
 * components/leads/GuidedStageActions.tsx. Keep the two in step: the stage
 * keys, targets and order are the web's, so a lead moves the same way from
 * either screen.
 *
 * The firm's rules this encodes:
 *  - A lead is Won when the client APPROVES the proposal (Proposal Sent →
 *    "Proposal Approved — Won Lead"), or, past Meeting Done, through the
 *    secondary "Skip Proposal — Won Lead" (pick the product) — never by
 *    picking "Won" from a list.
 *  - The call loops (call back later / not connected / contact in future)
 *    always ask for the next follow-up; closing a lead asks why.
 *  - The step pop-up has no notes / remarks box (2026-10-02).
 *
 * Onboarding after Won (KYC, UCC, mandate, risk profile, documents) is run in
 * the CRM; the app shows where the lead is and offers only the Won step's own
 * simple actions.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export type JourneyBehaviour =
  /** Log the call / the meeting that happened (POST /api/leads/[id]/notes);
   *  the server moves the journey on (call.logged / meeting.completed). */
  | { kind: "log"; activityType: "call" | "meeting" }
  /** The meeting form; saving it moves the journey to Meeting Scheduled. */
  | { kind: "schedule_meeting" }
  /** Pick the product(s) the client is investing in → POST /won. */
  | { kind: "won_product" }
  | { kind: "advance" }
  | { kind: "call_api"; endpoint: string; afterStage?: string }
  | { kind: "proposal"; step: "create_or_send" | "open" | "accept" };

export interface JourneyAction {
  key: string;
  label: string;
  tone: "primary" | "secondary" | "danger" | "success";
  targetStage: string;
  behaviour: JourneyBehaviour;
  /** Only for these lead pipelines (mf | insurance | general). */
  pipelines?: string[];
}

const a = (key: string, label: string, tone: JourneyAction["tone"], targetStage: string, behaviour: JourneyBehaviour, pipelines?: string[]): JourneyAction =>
  ({ key, label, tone, targetStage, behaviour, ...(pipelines ? { pipelines } : {}) });
const ADVANCE: JourneyBehaviour = { kind: "advance" };

export const LEAD_JOURNEY: Record<string, JourneyAction[]> = {
  new: [
    a("call_done", "Call Done", "primary", "call_done", { kind: "log", activityType: "call" }),
    a("call_back_later", "Call Back Later", "secondary", "call_back_later", ADVANCE),
    a("call_not_connected", "Call Not Connected", "secondary", "call_not_connected", ADVANCE),
    a("contact_in_future", "Contact in Future", "secondary", "contact_in_future", ADVANCE),
  ],
  call_done: [
    a("schedule_meeting", "Schedule Meeting", "primary", "meeting_scheduled", { kind: "schedule_meeting" }),
    a("proposal", "Create Proposal", "secondary", "proposal_sent", { kind: "proposal", step: "create_or_send" }),
    a("meeting_pending", "Meeting Tentative", "secondary", "meeting_pending", ADVANCE),
    a("not_qualified", "Not Qualified", "danger", "not_qualified", ADVANCE),
  ],
  call_back_later: [
    a("reached", "Reached Successfully", "primary", "call_done", { kind: "log", activityType: "call" }),
    a("still_no_answer", "Still No Answer", "secondary", "call_not_connected", ADVANCE),
    a("defer", "Defer Long-term", "secondary", "contact_in_future", ADVANCE),
  ],
  call_not_connected: [
    a("reached", "Eventually Reached", "primary", "call_done", { kind: "log", activityType: "call" }),
    a("schedule_callback", "Retry Tomorrow", "secondary", "call_back_later", ADVANCE),
    a("long_term", "Long-term Nurture", "secondary", "contact_in_future", ADVANCE),
  ],
  contact_in_future: [
    a("resurfaced", "Reached / Resurfaced", "primary", "call_done", { kind: "log", activityType: "call" }),
    a("confirmed_lost", "Confirmed Not Interested", "danger", "not_qualified", ADVANCE),
  ],
  meeting_scheduled: [
    a("meeting_done", "Meeting Done", "primary", "meeting_done", { kind: "log", activityType: "meeting" }),
    a("reschedule", "Reschedule", "secondary", "meeting_scheduled", { kind: "schedule_meeting" }),
    a("pending", "Awaiting Confirmation", "secondary", "meeting_pending", ADVANCE),
    a("no_show", "Client No-show", "danger", "contact_in_future", ADVANCE),
  ],
  meeting_pending: [
    a("meeting_done", "Meeting Done", "primary", "meeting_done", { kind: "log", activityType: "meeting" }),
    a("confirmed", "Confirmed / Rescheduled", "secondary", "meeting_scheduled", { kind: "schedule_meeting" }),
    a("no_show", "Client No-show", "danger", "contact_in_future", ADVANCE),
  ],
  meeting_done: [
    a("proposal", "Create Proposal", "primary", "proposal_sent", { kind: "proposal", step: "create_or_send" }),
    a("skip_proposal", "Skip Proposal — Won Lead", "secondary", "won_lead", { kind: "won_product" }),
    a("not_qualified", "Not a Fit", "danger", "not_qualified", ADVANCE),
  ],
  proposal_sent: [
    a("won_lead", "Proposal Approved — Won Lead", "success", "won_lead", { kind: "proposal", step: "accept" }),
    a("open_proposal", "View Proposal", "secondary", "proposal_sent", { kind: "proposal", step: "open" }),
    a("follow_up_meeting", "Schedule Follow-up Meeting", "secondary", "meeting_scheduled", { kind: "schedule_meeting" }),
    a("not_qualified", "Proposal Declined", "danger", "not_qualified", ADVANCE),
  ],
  won_lead: [
    a("request_docs", "Request Documents", "primary", "request_documents",
      { kind: "call_api", endpoint: "/api/leads/{id}/send-doc-checklist", afterStage: "documents_pending" }, ["mf", "general"]),
    a("start_insurance", "Start Insurance Onboarding", "primary", "insurance_needs_analysis", ADVANCE, ["insurance"]),
  ],
};

/** The lead phase — after it the journey is client onboarding, run in the CRM. */
export const LEAD_PHASE = new Set([
  "new", "call_done", "call_back_later", "call_not_connected", "contact_in_future",
  "meeting_scheduled", "meeting_pending", "meeting_done", "proposal_sent", "won_lead", "not_qualified",
]);

/** These always ask when to follow up next (web NEXT_TOUCH_STAGES). */
export const NEXT_TOUCH_STAGES = new Set(["call_back_later", "call_not_connected", "contact_in_future"]);

/** Why a lead was closed — the web's list, for win/loss analytics. */
export const LOST_REASONS = [
  "Not interested",
  "No budget / can't invest now",
  "Chose a competitor",
  "Unhappy with charges / commission",
  "Unreachable / no response",
  "Not eligible (NRI / KYC / docs)",
  "Bad timing — revisit later",
  "Duplicate / invalid lead",
  "Other",
];

/** What a Won lead invests in (lib/blueprints/lead_to_client LEAD_PRODUCTS). */
export const LEAD_PRODUCTS = [
  { value: "mutual_funds", label: "Mutual Funds" },
  { value: "insurance", label: "Insurance" },
  { value: "stocks_pms_aif", label: "Stocks / PMS / AIF" },
  { value: "nps", label: "NPS" },
  { value: "fd_bonds", label: "FD / Bonds" },
  { value: "other", label: "Other" },
];

export interface LeadBlueprint {
  current: { key: string; name: string; isDelayed: boolean; slaRemainingDays: number | null };
  pipeline: string;
}
export interface LeadProposal { id: string; number: string; status: string }
export interface Prereq { label: string; satisfied: boolean; hint?: string; cta?: { href: string; label: string } }
export interface MissingField { key: string; label: string; type: string; options?: string[] }

export function useLeadBlueprint(id: string | undefined) {
  return useQuery({
    queryKey: ["lead-blueprint", id],
    queryFn: () => api.get<LeadBlueprint>(`/api/leads/${id}/blueprint`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

export function useLeadProposal(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["lead-proposal", id],
    queryFn: () => api.get<{ proposal: LeadProposal | null }>(`/api/leads/${id}/proposal`).then((r) => r.proposal),
    enabled: !!id && enabled,
    staleTime: 15_000,
  });
}

export const canAdvance = (id: string, to: string) =>
  api.get<{ ok: boolean; items: Prereq[]; missingFields?: MissingField[] }>(`/api/leads/${id}/blueprint/can-advance`, { to });

export const advanceLead = (id: string, body: { toStageKey: string; remarks?: string; fields?: Record<string, unknown>; callBackAt?: string }) =>
  api.post<{ ok?: boolean }>(`/api/leads/${id}/blueprint/advance`, body);

export const markLeadWon = (id: string, products: string[], primaryProduct: string) =>
  api.post<{ ok: boolean; pipeline: string }>(`/api/leads/${id}/won`, { products, primaryProduct });

/** Everything a journey move can change on the lead screen and the pipeline. */
export function useRefreshLead(id: string | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["lead-blueprint", id] });
    qc.invalidateQueries({ queryKey: ["lead-proposal", id] });
    qc.invalidateQueries({ queryKey: ["lead", id] });
    qc.invalidateQueries({ queryKey: ["lead-full", id] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };
}

/** The label a proposal action shows once a proposal exists (web proposalAware). */
export function proposalAware(action: JourneyAction, p: LeadProposal | null | undefined): JourneyAction {
  if (action.behaviour.kind !== "proposal" || action.behaviour.step !== "create_or_send" || !p) return action;
  if (p.status === "rejected" || p.status === "expired") return action;
  if (p.status === "draft" || p.status === "ready") return { ...action, label: "Send Proposal" };
  return { ...action, label: "Open Proposal", tone: "secondary" };
}

/** A server CTA (/dashboard/…) as the app's own screen, or null when there is none. */
export function ctaToMobile(href: string, leadId: string): string | null {
  if (!href.startsWith("/dashboard/")) return null;
  if (href.split("?")[0] === `/dashboard/leads/${leadId}`) return null; // this screen
  return href.replace(/^\/dashboard\//, "/m/");
}
