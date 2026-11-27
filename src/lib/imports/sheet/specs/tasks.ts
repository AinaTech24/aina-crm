/** The Tasks import sheet — see ../spec.ts. Pure data. */
import { REQUEST_TYPES } from "@/lib/tasks/request-types";
import type { SheetSpec } from "../spec";
import { MAX_IMPORT_ROWS } from "../spec";

const BASE_TYPES = [
  { value: "follow_up", label: "Follow-up" },
  { value: "review_meeting", label: "Review meeting" },
  { value: "collect_document", label: "Collect document" },
  { value: "kyc_renewal", label: "KYC renewal" },
  { value: "custom", label: "Custom" },
];

export const TASK_TYPE_OPTIONS = [
  ...BASE_TYPES,
  ...REQUEST_TYPES.filter((r) => !BASE_TYPES.some((b) => b.value === r.key)).map((r) => ({ value: r.key, label: r.label })),
];

export const TASK_DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "back_office", label: "Back office" },
  { value: "compliance", label: "Compliance" },
  { value: "marketing", label: "Marketing" },
  { value: "advisory", label: "Advisory" },
  { value: "support", label: "Support" },
  { value: "leadership", label: "Leadership" },
  { value: "other", label: "Other" },
];
export const TASK_PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
export const TASK_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
export const TASK_RECURRENCES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export const tasksSpec: SheetSpec = {
  entity: "tasks",
  label: "Tasks",
  singular: "task",
  maxRows: MAX_IMPORT_ROWS,
  columns: [
    { key: "title", header: "Title", required: true, kind: "text", aliases: ["Task", "Task Name", "Subject"], help: "What has to be done (2–300 characters)." },
    { key: "description", header: "Description", kind: "longtext", help: "Details of the task." },
    { key: "type", header: "Task Type", kind: "enum", options: TASK_TYPE_OPTIONS, aliases: ["Type"], help: "Blank = Follow-up." },
    { key: "department", header: "Department", kind: "enum", options: TASK_DEPARTMENTS, help: "Blank = the assignee's own department." },
    { key: "priority", header: "Priority", kind: "enum", options: TASK_PRIORITIES, help: "Blank = Normal." },
    { key: "status", header: "Status", kind: "enum", options: TASK_STATUSES, help: "Blank = Open." },
    { key: "assignee", header: "Assigned To", kind: "user", aliases: ["Assignee", "Owner", "Assigned To Email"], help: "The team member who does it. Blank = you, the person importing." },
    { key: "entryDate", header: "Entry Date", kind: "date", help: "The day the task was entered. Blank = today." },
    { key: "dueAt", header: "Due Date", kind: "datetime", aliases: ["Due", "Due On"], help: "When it is due. A date, or a date with a time." },
    { key: "slaDueAt", header: "SLA Due Date", kind: "datetime", help: "Blank = set from the priority, as for a task made in the CRM." },
    { key: "remindAt", header: "Reminder", kind: "datetime", aliases: ["Remind At"], help: "When to remind the assignee. A date with a time (a bare date reminds at 10:00 am)." },
    { key: "clientPan", header: "Client PAN", kind: "client", help: "Links the task to this client. The PAN is the surest way to find them." },
    { key: "clientName", header: "Client Name", kind: "client", aliases: ["Client", "Related Client"], help: "Used when there is no PAN. It must match one client exactly." },
    { key: "leadMobile", header: "Lead Mobile", kind: "lead", help: "Links the task to this lead." },
    { key: "leadName", header: "Lead Name", kind: "lead", aliases: ["Lead", "Related Lead"], help: "Used when there is no mobile. It must match one lead exactly." },
    { key: "remarks", header: "Remarks", kind: "longtext", aliases: ["Notes"], help: "Up to 1,000 characters." },
    { key: "tags", header: "Tags", kind: "list", help: "Several, separated by ;" },
    { key: "estimateMinutes", header: "Estimated Minutes", kind: "integer", aliases: ["Estimate"], help: "Planned effort in minutes." },
    { key: "recurrence", header: "Repeats", kind: "enum", options: TASK_RECURRENCES, aliases: ["Recurrence"], help: "Blank = one-off. A repeating task makes the next one when it is completed." },
    { key: "recurrenceUntil", header: "Repeat Until", kind: "date", help: "Last day it may repeat. Needs Repeats." },
    { key: "requiresApproval", header: "Requires Approval", kind: "bool", help: "Yes = the assignee submits it for sign-off instead of completing it." },
    { key: "actionPoints", header: "Action Points", kind: "list", aliases: ["Checklist", "Sub Tasks"], help: "The steps, separated by ; or one per line (up to 100)." },
    { key: "closedDate", header: "Closed Date", kind: "date", help: "For a Completed task: the day it was finished. Blank = the day you import." },
  ],
  examples: [
    {
      title: "Collect KYC documents from client", description: "PAN, Aadhaar and a cancelled cheque", type: "Collect document",
      department: "Operations", priority: "High", status: "Open", assignee: "rahul@yourfirm.in", entryDate: "24-11-2026",
      dueAt: "28-11-2026", clientPan: "ABCDE1234F", remarks: "Client prefers WhatsApp", tags: "kyc; onboarding",
      estimateMinutes: "30", requiresApproval: "No", actionPoints: "Call the client; Collect the documents; Verify the PAN",
    },
    {
      title: "Quarterly portfolio review call", type: "Follow-up", department: "Advisory", priority: "Normal", status: "In progress",
      assignee: "Priya Shah", dueAt: "30-11-2026 11:30", remindAt: "29-11-2026 09:00",
      clientName: "Meera Patel", recurrence: "Quarterly", recurrenceUntil: "31-03-2028",
    },
    {
      title: "Send welcome kit to new lead", type: "Follow-up", priority: "Low", status: "Completed", assignee: "rahul@yourfirm.in",
      entryDate: "10-11-2026", dueAt: "12-11-2026", leadMobile: "9876543210", closedDate: "11-11-2026",
    },
  ],
  notes: [
    "Fill the Data sheet, one task per row, starting under the headings. Delete nothing from row 1. The Example sheet shows filled rows — copy from it if useful.",
    "Columns marked * must be filled. Everything else is optional; leave a cell blank to use the default described below.",
    "Dates are read day first: 24-11-2026, 24/11/2026 or 24 Nov 2026. A real Excel date works too.",
    "Imported tasks do not send alerts one by one. Each person gets a single notification saying how many tasks were assigned to them.",
    "Automations do not run on imported tasks, and a task is never created for a client or lead you cannot see.",
    "Importing the same file twice creates the tasks twice.",
  ],
};
