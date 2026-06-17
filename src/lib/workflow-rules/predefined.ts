/**
 * Predefined Workflow Rules — a starter library every MFD sees and can activate.
 *
 * These are NOT seeded per tenant. The Rule Library page renders this catalog;
 * "Add to my rules" copies the chosen template into the tenant's workflow_rules
 * (created DISABLED so the MFD reviews it — and picks their own message template
 * for comms actions — before turning it on).
 *
 * Pure data only (no DB/server imports) so both the server page and the activate
 * API can import it.
 */

import type { WorkflowRuleInput } from "./types";

export interface PredefinedRule {
  key: string;
  title: string;
  description: string;
  category: "SIP" | "Leads" | "Clients" | "Service";
  /** Comms actions need an approved message template the MFD picks after adding. */
  needsTemplate: boolean;
  rule: WorkflowRuleInput;
}

const base = {
  criteriaPattern: null as string | null,
  scheduledActions: [] as WorkflowRuleInput["scheduledActions"],
  branches: [] as WorkflowRuleInput["branches"],
  enabled: false, // always added disabled — MFD reviews + enables
  executionOrder: 100,
};

export const PREDEFINED_RULES: PredefinedRule[] = [
  {
    key: "lead_welcome_email",
    title: "Welcome email to a new lead",
    description:
      "When a lead is created, email them a thank-you for connecting. If the lead came from a client referral, the email also thanks the referring client by name. Email templates are created for you automatically.",
    category: "Leads",
    needsTemplate: false, // both email templates are auto-provisioned on add
    rule: {
      ...base,
      module: "leads",
      name: "Welcome email to new lead",
      description: "Thank a new lead for connecting (names the referrer if any).",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      // Branch 0 (main criteria): referred by a client → referral-aware template.
      criteriaRows: [{ field: "referred_by_name", operator: "is_not_empty" }],
      instantActions: [
        { type: "send_email", label: "Email the lead (referred)", config: { templateKey: "lead_welcome_referral", category: "transactional", recipient: "subject" } },
      ],
      // Branch 1 (catch-all): no referral → plain welcome.
      branches: [
        {
          name: "No referral",
          criteriaPattern: null,
          criteriaRows: [],
          instantActions: [
            { type: "send_email", label: "Email the lead", config: { templateKey: "lead_welcome", category: "transactional", recipient: "subject" } },
          ],
          scheduledActions: [],
        },
      ],
    },
  },
  {
    key: "meeting_scheduled_confirmation",
    title: "Meeting scheduled → confirm to client",
    description:
      "When a meeting is created with status Scheduled, email the client a confirmation naming the RM and the meeting time. Template auto-created.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "review_meetings",
      name: "Meeting scheduled confirmation",
      description: "Confirm a newly-scheduled meeting to the client.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [{ field: "status", operator: "is", value: "scheduled" }],
      instantActions: [{ type: "send_email", label: "Email the client", config: { templateKey: "meeting_scheduled", category: "transactional", recipient: "subject" } }],
    },
  },
  {
    key: "meeting_reminder",
    title: "Meeting reminder (if reminder set)",
    description:
      "1 day before a scheduled meeting that has a reminder set, email the client a reminder naming the RM and time. Template auto-created. Remove the 'Reminder set' condition to remind every scheduled meeting.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "review_meetings",
      name: "Meeting reminder",
      description: "Remind the client 1 day before a scheduled meeting (when a reminder is set).",
      triggerType: "date_field",
      triggerConfig: { field: "meeting_date", when: "before", offset: 1, unit: "day", recurrence: "once", time: "09:00" },
      criteriaRows: [
        { field: "status", operator: "is", value: "scheduled" },
        { field: "reminder_task_id", operator: "is_not_empty" },
      ],
      instantActions: [{ type: "send_email", label: "Email the client", config: { templateKey: "meeting_reminder", category: "utility", recipient: "subject" } }],
    },
  },
  {
    key: "meeting_minutes_thankyou",
    title: "Meeting completed → AI minutes + thank-you",
    description:
      "When a meeting is marked Completed and the Discussion points (agenda) box isn't empty, email the client a thank-you (naming the RM) with AI-written minutes of meeting generated from the agenda. Template auto-created.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "review_meetings",
      name: "Meeting minutes + thank-you",
      description: "On meeting completion, email the client AI-written minutes of meeting.",
      triggerType: "record_action",
      // Fire when status is edited to 'completed'.
      triggerConfig: { when: "edit", editMode: "specific", fields: [], fieldConditions: [{ field: "status", operator: "is", value: "completed" }], repeat: false },
      // …only if the agenda box has content to summarise.
      criteriaRows: [{ field: "discussion_points", operator: "is_not_empty" }],
      instantActions: [
        {
          type: "send_email",
          label: "Email the client minutes of meeting",
          config: { templateKey: "meeting_minutes", category: "transactional", recipient: "subject", aiMinutesFrom: "discussion_points" },
        },
      ],
    },
  },
  {
    key: "sip_installment_reminder",
    title: "SIP installment reminder",
    description:
      "2 days before each active SIP's installment date, WhatsApp the client a reminder. Recurs every month off the SIP's next-installment date.",
    category: "SIP",
    needsTemplate: true,
    rule: {
      ...base,
      module: "sips",
      name: "SIP installment reminder",
      description: "Remind the client 2 days before each SIP debit.",
      triggerType: "date_field",
      triggerConfig: { field: "next_installment_at", when: "before", offset: 2, unit: "day", recurrence: "every_month", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [{ type: "send_whatsapp", label: "WhatsApp the client", config: { templateKey: "", category: "utility", recipient: "subject" } }],
    },
  },
  {
    key: "referral_thank_you",
    title: "Thank the referring client",
    description:
      "When a new lead is created from a client referral, email the referring client a thank-you that names the lead they referred. The email template is created for you automatically.",
    category: "Leads",
    needsTemplate: false, // referrer_thank_you template is auto-provisioned on add
    rule: {
      ...base,
      module: "leads",
      name: "Referral thank-you",
      description: "Email the referring client when a referred lead is created.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [{ field: "referred_by_name", operator: "is_not_empty" }],
      instantActions: [{ type: "send_email", label: "Email the referring client", config: { templateKey: "referrer_thank_you", category: "transactional", recipient: "referrer" } }],
    },
  },
  {
    key: "new_lead_welcome",
    title: "Welcome a new lead",
    description: "As soon as a lead is created, WhatsApp them a welcome message so first contact is instant.",
    category: "Leads",
    needsTemplate: true,
    rule: {
      ...base,
      module: "leads",
      name: "New lead welcome",
      description: "WhatsApp a welcome to every new lead.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [],
      instantActions: [{ type: "send_whatsapp", label: "WhatsApp the lead", config: { templateKey: "", category: "utility", recipient: "subject" } }],
    },
  },
  {
    key: "client_birthday_wish",
    title: "Client birthday wish",
    description: "On each active client's birthday, send a WhatsApp greeting. Recurs every year off the client's date of birth.",
    category: "Clients",
    needsTemplate: true,
    rule: {
      ...base,
      module: "investors",
      name: "Client birthday wish",
      description: "WhatsApp a greeting on the client's birthday.",
      triggerType: "date_field",
      triggerConfig: { field: "date_of_birth", when: "on", offset: 0, unit: "day", recurrence: "every_year", time: "09:00" },
      criteriaRows: [{ field: "status", operator: "is", value: "active" }],
      instantActions: [{ type: "send_whatsapp", label: "WhatsApp the client", config: { templateKey: "", category: "marketing", recipient: "subject" } }],
    },
  },
  {
    key: "sip_rejection_followup",
    title: "SIP rejection → RM follow-up task",
    description: "When a SIP rejection is recorded, create a high-priority follow-up task for the client's RM. No message template needed — works immediately.",
    category: "Service",
    needsTemplate: false,
    rule: {
      ...base,
      module: "sip_rejections",
      name: "SIP rejection follow-up",
      description: "Create an RM task to recover a rejected SIP.",
      triggerType: "record_action",
      triggerConfig: { when: "create", fields: [], repeat: false },
      criteriaRows: [],
      instantActions: [{ type: "create_task", label: "Create RM task", config: { title: "Follow up on rejected SIP", taskType: "follow_up", priority: "high", assignee: "subject.rm_id", department: "operations" } }],
    },
  },
];

export function getPredefinedRule(key: string): PredefinedRule | undefined {
  return PREDEFINED_RULES.find((r) => r.key === key);
}
