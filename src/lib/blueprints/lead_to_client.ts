/**
 * The canonical lead-to-client blueprint — 15 stages per the spec.
 *
 * Each stage declares:
 *   - the role that owns it (drives "Pending — RM" badges)
 *   - required-field list (drives "Capture these before moving on" checklist)
 *   - SLA in days (drives the "Due in / Overdue by" badge + escalation worker)
 *   - allowed actions (button visibility on the lead detail page)
 *   - automation-recipe keys that fire on enter/exit
 *
 * Tenants get this seeded once when their first lead is created.
 */

export interface SeedStage {
  key: string;
  name: string;
  description?: string;
  order: number;
  ownerRole: "sales" | "back_office" | "operations" | "compliance" | "owner";
  requiredFields: string[];
  slaDays?: number;
  allowedActions: string[];
  automationsOnEnter?: string[];
  automationsOnExit?: string[];
}

export const LEAD_TO_CLIENT_BLUEPRINT_NAME = "Lead → Client journey";

export const LEAD_TO_CLIENT_STAGES: SeedStage[] = [
  {
    key: "new",
    name: "New Lead Created",
    order: 1,
    ownerRole: "sales",
    requiredFields: ["name", "phone", "source", "ownerId"],
    slaDays: 1,
    allowedActions: ["send_welcome", "schedule_call"],
    automationsOnEnter: ["lead_welcome"],
  },
  {
    key: "first_call_pending",
    name: "First Call Pending",
    description: "RM must call the lead and record outcome.",
    order: 2,
    ownerRole: "sales",
    requiredFields: ["lastContactAt"],
    slaDays: 1,
    allowedActions: ["log_call_outcome"],
  },
  {
    key: "appointment_scheduled",
    name: "Appointment Scheduled",
    order: 3,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 3,
    allowedActions: ["confirm_meeting", "reschedule_meeting", "cancel_meeting"],
  },
  {
    key: "meeting_done",
    name: "Meeting Completed",
    order: 4,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["capture_meeting_outcome", "qualify_lead"],
  },
  {
    key: "post_meeting_qualified",
    name: "Post-Meeting Qualification",
    description: "Captured whether the lead is ready to proceed.",
    order: 5,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["send_risk_profile", "mark_nurture", "mark_lost"],
  },
  {
    key: "risk_profile_sent",
    name: "Risk Profile Sent",
    order: 6,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 5,
    allowedActions: ["resend_risk_profile", "manual_capture_risk_profile"],
  },
  {
    key: "risk_profiled",
    name: "Risk Profile Completed",
    order: 7,
    ownerRole: "sales",
    requiredFields: ["riskProfile"],
    slaDays: 1,
    allowedActions: ["create_proposal"],
  },
  {
    key: "proposal_drafted",
    name: "Proposal Drafted",
    order: 8,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 2,
    allowedActions: ["send_proposal", "edit_proposal", "suitability_check"],
  },
  {
    key: "proposal_sent",
    name: "Proposal Sent",
    order: 9,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 7,
    allowedActions: ["resend_proposal", "capture_approval", "revise_proposal"],
  },
  {
    key: "proposal_approved",
    name: "Proposal Approved",
    order: 10,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["send_doc_checklist"],
    automationsOnEnter: ["proposal_approved_request_docs"],
  },
  {
    key: "docs_requested",
    name: "Documents Requested",
    order: 11,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 7,
    allowedActions: ["resend_doc_checklist", "manual_upload_docs"],
  },
  {
    key: "docs_received",
    name: "Documents Received",
    order: 12,
    ownerRole: "sales",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["convert_to_client"],
    automationsOnEnter: ["docs_received_convert"],
  },
  {
    key: "ops_in_progress",
    name: "Operations In Progress",
    description: "Back-office is running KYC, UCC, mandate, first transaction.",
    order: 13,
    ownerRole: "back_office",
    requiredFields: [],
    slaDays: 5,
    allowedActions: ["view_ops_tasks", "escalate_to_owner"],
  },
  {
    key: "portal_welcome_sent",
    name: "Portal Welcome Sent",
    order: 14,
    ownerRole: "operations",
    requiredFields: [],
    slaDays: 1,
    allowedActions: ["schedule_first_review"],
    automationsOnEnter: ["ops_complete_portal_welcome"],
  },
  {
    key: "active_client",
    name: "Active Client",
    description: "Onboarding complete. Client is in the review cycle.",
    order: 15,
    ownerRole: "sales",
    requiredFields: [],
    allowedActions: [],
  },
];

/**
 * Default forward transitions between adjacent stages. Custom branches
 * (e.g. meeting_done → nurture / lost) are layered on top of this.
 */
export const LEAD_TO_CLIENT_TRANSITIONS: Array<{
  from: string;
  to: string;
  name: string;
  allowedRoles?: string[];
}> = [
  // Forward path
  { from: "new", to: "first_call_pending", name: "Lead onboarded — call queue" },
  { from: "first_call_pending", to: "appointment_scheduled", name: "Appointment booked", allowedRoles: ["rm", "sales"] },
  { from: "first_call_pending", to: "post_meeting_qualified", name: "Skip — already qualified" },
  { from: "appointment_scheduled", to: "meeting_done", name: "Meeting completed", allowedRoles: ["rm", "sales"] },
  { from: "meeting_done", to: "post_meeting_qualified", name: "Capture outcome", allowedRoles: ["rm", "sales"] },
  { from: "post_meeting_qualified", to: "risk_profile_sent", name: "Send risk profile", allowedRoles: ["rm", "sales"] },
  { from: "risk_profile_sent", to: "risk_profiled", name: "Risk profile submitted" },
  { from: "risk_profiled", to: "proposal_drafted", name: "Draft proposal", allowedRoles: ["rm", "sales"] },
  { from: "proposal_drafted", to: "proposal_sent", name: "Send proposal", allowedRoles: ["rm", "sales"] },
  { from: "proposal_sent", to: "proposal_approved", name: "Approval captured" },
  { from: "proposal_approved", to: "docs_requested", name: "Send doc checklist", allowedRoles: ["rm", "sales"] },
  { from: "docs_requested", to: "docs_received", name: "Documents uploaded" },
  { from: "docs_received", to: "ops_in_progress", name: "Convert + assign ops" },
  { from: "ops_in_progress", to: "portal_welcome_sent", name: "Ops complete" },
  { from: "portal_welcome_sent", to: "active_client", name: "Onboarding complete" },

  // Branches off the qualification stage
  { from: "post_meeting_qualified", to: "first_call_pending", name: "Needs more discussion (re-nurture)" },
];
