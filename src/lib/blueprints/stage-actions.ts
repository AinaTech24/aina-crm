/**
 * Stage-action catalog — what the user actually sees and clicks at each
 * stage of the Lead → Client journey.
 *
 * Replaces the generic "Next action" chip strip with a guided flow:
 *
 *   - Each stage exposes 1-3 primary buttons (Call Done / Schedule
 *     Meeting / Send Proposal / …).
 *   - Each button declares:
 *       a) `prereqKey`     — the prerequisite that must be satisfied
 *                            before the blueprint can advance.
 *       b) `targetStage`   — where to advance once the prereq is met.
 *       c) `behaviour`     — what clicking the button does on the UI side
 *                            (open a dialog, navigate to a form, or
 *                            just advance the stage).
 *
 *   - When the user clicks a button:
 *       1. UI hits /api/leads/[id]/blueprint/can-advance?to=<target> to
 *          check the prerequisite.
 *       2. If satisfied  → call /advance, refresh.
 *       3. If unsatisfied → show inline checklist with a direct CTA to
 *          complete the missing artefact (open dialog / navigate).
 *
 * That checklist is intentionally the *same* prerequisite list that
 * stops a manual "Advance" — one source of truth for "is this stage
 * ready to be closed?".
 */

export type StageActionBehaviour =
  /** Opens an in-place modal dialog (e.g. log call, log past meeting). */
  | { kind: "open_dialog"; dialog: DialogKind }
  /** Navigates to a form page with leadId pre-filled. */
  | { kind: "navigate"; hrefPattern: string }
  /** Just advances the stage (no form, no dialog). */
  | { kind: "advance_only" }
  /** Calls an API directly — used for short-circuit "Not Connected" / "Cancel". */
  | { kind: "call_api"; endpoint: string; body?: Record<string, unknown>; afterStage?: string };

export type DialogKind =
  | "log_call"
  | "log_past_meeting"
  | "send_risk_profile"
  | "capture_risk_profile_manually"
  | "send_doc_checklist"
  | "capture_approval"
  | "mark_lost";

export type StageAction = {
  key: string;
  /** Button label shown to the user. */
  label: string;
  /** Visual tone: primary (filled), secondary (outline), danger (red). */
  tone: "primary" | "secondary" | "danger" | "success";
  /** Stage to land on after the action is successful. */
  targetStage: string;
  /**
   * Name of a prerequisite rule (see src/lib/blueprints/prerequisites.ts
   * PREREQ_RULES_BY_TARGET) — when the action fires, the UI runs this
   * check against the target stage. If unsatisfied, the user is shown
   * the checklist instead of an immediate advance.
   *
   * Set to `null` for short-circuit moves (e.g. "Mark Not Connected"
   * just records a note and stays in place).
   */
  hint?: string;
  behaviour: StageActionBehaviour;
};

/**
 * The catalog — keyed by current stage. Each value is the array of
 * actions to render. Order matters: first action gets the primary tone.
 */
export const STAGE_ACTIONS: Record<string, StageAction[]> = {
  // ── Stage 1: New Lead Created ───────────────────────────────────
  new: [
    {
      key: "call_done",
      label: "Call Done",
      tone: "primary",
      targetStage: "first_call_pending",
      hint: "Log what was discussed on the first call",
      behaviour: { kind: "open_dialog", dialog: "log_call" },
    },
    {
      key: "call_not_connected",
      label: "Call Not Connected",
      tone: "secondary",
      targetStage: "new",
      hint: "Stays at New; we'll surface this lead in tomorrow's call queue",
      behaviour: {
        kind: "call_api",
        endpoint: "/api/leads/{id}/call-outcome",
        body: { outcome: "not_connected", attempted: true },
      },
    },
    {
      key: "call_pending",
      label: "Call Pending",
      tone: "secondary",
      targetStage: "new",
      hint: "Snooze — RM will be reminded tomorrow",
      behaviour: { kind: "advance_only" },
    },
  ],

  // ── Stage 2: First Call Done (system label: first_call_pending) ─
  first_call_pending: [
    {
      key: "schedule_meeting",
      label: "Schedule Meeting",
      tone: "primary",
      targetStage: "appointment_scheduled",
      hint: "Opens the scheduling form pre-filled with this lead",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/review-meetings/new?leadId={id}" },
    },
    {
      key: "meeting_done",
      label: "Meeting Already Done",
      tone: "secondary",
      targetStage: "meeting_done",
      hint: "Log a meeting that already happened",
      behaviour: { kind: "open_dialog", dialog: "log_past_meeting" },
    },
    {
      key: "mark_lost",
      label: "Lead Not Interested",
      tone: "danger",
      targetStage: "new", // stays; the lost-marker happens via a different flow
      hint: "Mark this lead as lost",
      behaviour: { kind: "open_dialog", dialog: "mark_lost" },
    },
  ],

  // ── Stage 3: Appointment Scheduled ──────────────────────────────
  appointment_scheduled: [
    {
      key: "meeting_done",
      label: "Meeting Done",
      tone: "primary",
      targetStage: "meeting_done",
      hint: "Mark the scheduled meeting as completed and capture outcome",
      behaviour: { kind: "open_dialog", dialog: "log_past_meeting" },
    },
    {
      key: "reschedule",
      label: "Reschedule Meeting",
      tone: "secondary",
      targetStage: "appointment_scheduled",
      hint: "Move the existing meeting to a new date / time",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/review-meetings?leadId={id}" },
    },
    {
      key: "cancel",
      label: "Cancel Meeting",
      tone: "danger",
      targetStage: "first_call_pending",
      hint: "Cancel the meeting and return to call-queue",
      behaviour: { kind: "advance_only" },
    },
  ],

  // ── Stage 4: Meeting Completed ──────────────────────────────────
  meeting_done: [
    {
      key: "qualify",
      label: "Qualify — Move to Proposal Track",
      tone: "primary",
      targetStage: "post_meeting_qualified",
      hint: "Captures meeting outcome and qualifies the lead",
      behaviour: { kind: "open_dialog", dialog: "log_call" }, // re-use to capture outcome notes
    },
    {
      key: "mark_lost",
      label: "Not a Fit",
      tone: "danger",
      targetStage: "new",
      hint: "Mark lead as lost / not a fit",
      behaviour: { kind: "open_dialog", dialog: "mark_lost" },
    },
  ],

  // ── Stage 5: Post-Meeting Qualified ─────────────────────────────
  post_meeting_qualified: [
    {
      key: "send_risk_profile",
      label: "Send Risk Profile Link",
      tone: "primary",
      targetStage: "risk_profile_sent",
      hint: "Mints a one-time WhatsApp/email link for the client",
      behaviour: { kind: "open_dialog", dialog: "send_risk_profile" },
    },
    {
      key: "capture_manually",
      label: "Capture Risk Profile Manually",
      tone: "secondary",
      targetStage: "risk_profiled",
      hint: "RM fills the questionnaire on the client's behalf",
      behaviour: { kind: "open_dialog", dialog: "capture_risk_profile_manually" },
    },
  ],

  // ── Stage 6: Risk Profile Sent ──────────────────────────────────
  risk_profile_sent: [
    {
      key: "resend",
      label: "Resend Link",
      tone: "secondary",
      targetStage: "risk_profile_sent",
      hint: "Send another reminder (also via WhatsApp / email)",
      behaviour: { kind: "open_dialog", dialog: "send_risk_profile" },
    },
    {
      key: "capture_manually",
      label: "Capture Manually",
      tone: "primary",
      targetStage: "risk_profiled",
      hint: "Client too busy? Capture their answers yourself.",
      behaviour: { kind: "open_dialog", dialog: "capture_risk_profile_manually" },
    },
  ],

  // ── Stage 7: Risk Profile Completed ─────────────────────────────
  risk_profiled: [
    {
      key: "create_proposal",
      label: "Create Proposal",
      tone: "primary",
      targetStage: "proposal_drafted",
      hint: "Open the proposal builder with risk + goals pre-filled",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/proposals/new?leadId={id}" },
    },
  ],

  // ── Stage 8: Proposal Drafted ───────────────────────────────────
  proposal_drafted: [
    {
      key: "send_proposal",
      label: "Send Proposal",
      tone: "primary",
      targetStage: "proposal_sent",
      hint: "Choose Email or WhatsApp; we'll log the send",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/proposals?leadId={id}" },
    },
    {
      key: "edit",
      label: "Edit Proposal",
      tone: "secondary",
      targetStage: "proposal_drafted",
      hint: "Tweak the draft before sending",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/proposals?leadId={id}" },
    },
  ],

  // ── Stage 9: Proposal Sent ──────────────────────────────────────
  proposal_sent: [
    {
      key: "capture_approval",
      label: "Client Approved",
      tone: "success",
      targetStage: "proposal_approved",
      hint: "Capture verbal / digital approval (with SEBI evidence)",
      behaviour: { kind: "open_dialog", dialog: "capture_approval" },
    },
    {
      key: "resend",
      label: "Resend Proposal",
      tone: "secondary",
      targetStage: "proposal_sent",
      hint: "Nudge — client hasn't viewed yet?",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/proposals?leadId={id}" },
    },
    {
      key: "revise",
      label: "Revise Proposal",
      tone: "secondary",
      targetStage: "proposal_drafted",
      hint: "Client wants changes — go back to draft",
      behaviour: { kind: "navigate", hrefPattern: "/dashboard/proposals?leadId={id}" },
    },
  ],

  // ── Stage 10: Proposal Approved ─────────────────────────────────
  proposal_approved: [
    {
      key: "send_doc_checklist",
      label: "Send Document Checklist",
      tone: "primary",
      targetStage: "docs_requested",
      hint: "One-time link the client uses to upload KYC docs",
      behaviour: { kind: "open_dialog", dialog: "send_doc_checklist" },
    },
  ],

  // ── Stage 11: Documents Requested ───────────────────────────────
  docs_requested: [
    {
      key: "resend_checklist",
      label: "Resend Checklist",
      tone: "secondary",
      targetStage: "docs_requested",
      hint: "Client missed the link? Resend.",
      behaviour: { kind: "open_dialog", dialog: "send_doc_checklist" },
    },
    {
      key: "manual_upload",
      label: "Documents Received",
      tone: "primary",
      targetStage: "docs_received",
      hint: "Client gave docs in-person? Confirm receipt.",
      behaviour: { kind: "advance_only" },
    },
  ],

  // ── Stage 12: Documents Received ────────────────────────────────
  // No actions — the Convert-to-Client CTA on the boundary card handles it.
  docs_received: [],
};
