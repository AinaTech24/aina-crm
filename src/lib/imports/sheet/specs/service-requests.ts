/** The Service requests import sheet — see ../spec.ts. Pure data. */
import type { SheetSpec } from "../spec";
import { MAX_IMPORT_ROWS } from "../spec";

const t = (value: string, label?: string) => ({ value, label: label ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) });

/** Every type a ticket can have (db/schema/service_requests.ts), canonical ones first. */
export const SR_TYPE_OPTIONS = [
  t("nominee_update"), t("bank_update"), t("mobile_update"), t("email_update"), t("kyc_update"), t("minor_to_major"),
  t("capital_gain_report"), t("statement_request"), t("redemption_request"), t("switch_request"), t("transmission_case"),
  t("folio_correction"), t("complaint"), t("feedback"), t("iin", "IIN"), t("can", "CAN"), t("name_change"), t("swp", "SWP"),
  t("swp_stop", "SWP stop"), t("physical_kyc", "Physical KYC"), t("video_kyc", "Video KYC"), t("other"),
  t("redemption_help"), t("switch_help"), t("transaction_query"),
];
export const SR_STATUS_OPTIONS = [
  t("open"), t("in_progress"), t("waiting_customer", "Waiting for customer"), t("resolved"), t("closed"), t("escalated"),
];
export const SR_PRIORITY_OPTIONS = [t("low"), t("normal"), t("high"), t("urgent")];
export const SR_CHANNEL_OPTIONS = [t("whatsapp", "WhatsApp"), t("email"), t("phone"), t("in_person", "In person"), t("form", "Form")];
export const SEBI_CATEGORY_OPTIONS = [
  { value: "service", label: "Service / TAT" },
  { value: "mis_selling", label: "Mis-selling" },
  { value: "transaction", label: "Transaction / order" },
  { value: "fee", label: "Fee / commission" },
  { value: "kyc", label: "KYC / documents" },
  { value: "communication", label: "Communication / statements" },
  { value: "other", label: "Other" },
];
export const COMPLAINT_SOURCE_OPTIONS = [
  { value: "direct", label: "Direct (client)" },
  { value: "scores", label: "SCORES (SEBI)" },
  { value: "amfi", label: "AMFI" },
  { value: "amc", label: "AMC" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "walk_in", label: "Walk-in" },
  { value: "website", label: "Website form" },
  { value: "other", label: "Other" },
];

export const serviceRequestsSpec: SheetSpec = {
  entity: "service-requests",
  label: "Service requests",
  singular: "service request",
  maxRows: MAX_IMPORT_ROWS,
  columns: [
    { key: "ticketNo", header: "Ticket No", kind: "text", aliases: ["Service ID", "Ticket Number", "Ticket"], help: "Keep an old ticket number, e.g. from Zoho. Blank = the CRM gives the next number. A number already in use is refused." },
    { key: "type", header: "Service Type", required: true, kind: "enum", options: SR_TYPE_OPTIONS, aliases: ["Type", "Request Type"], help: "What the request is. Use Complaint for a complaint." },
    { key: "subject", header: "Subject", required: true, kind: "text", aliases: ["Title", "Summary"], help: "A short headline (2–300 characters)." },
    { key: "description", header: "Description", kind: "longtext", help: "The details of the request." },
    { key: "priority", header: "Priority", kind: "enum", options: SR_PRIORITY_OPTIONS, help: "Blank = Normal." },
    { key: "status", header: "Status", kind: "enum", options: SR_STATUS_OPTIONS, help: "Blank = Open." },
    { key: "channel", header: "Channel", kind: "enum", options: SR_CHANNEL_OPTIONS, aliases: ["Received Via", "Mode"], help: "How the client asked." },
    { key: "clientPan", header: "Client PAN", kind: "client", help: "The client it is for. The PAN is the surest way to find them." },
    { key: "clientName", header: "Client Name", kind: "client", aliases: ["Client"], help: "Used when there is no PAN. It must match one client exactly." },
    { key: "requesterName", header: "Requester Name", kind: "text", aliases: ["Complainant"], help: "Who asked, when there is no client record to link." },
    { key: "assignedTo", header: "Assigned To", kind: "user", aliases: ["Assignee", "Owner", "Handled By"], help: "The team member handling it — email (best) or name. Blank = you, the person importing." },
    { key: "createdDate", header: "Created Date", kind: "datetime", aliases: ["Created On", "Raised On", "Date"], help: "When it was raised. Blank = now. The clocks (SLA) run from this date." },
    { key: "resolvedDate", header: "Resolved Date", kind: "datetime", aliases: ["Resolved On", "Closed Date"], help: "For a Resolved or Closed request. Blank = the day you import." },
    { key: "resolutionNotes", header: "Resolution Notes", kind: "longtext", aliases: ["Resolution"], help: "How it was resolved." },
    { key: "remarks", header: "Remarks", kind: "longtext", help: "Internal remarks." },
    { key: "sebiCategory", header: "SEBI Category", kind: "enum", options: SEBI_CATEGORY_OPTIONS, help: "For a complaint." },
    { key: "sebiSubCategory", header: "SEBI Sub-category", kind: "text", help: "For a complaint." },
    { key: "complaintSource", header: "Complaint Source", kind: "enum", options: COMPLAINT_SOURCE_OPTIONS, help: "For a complaint. Blank = Direct (client)." },
    { key: "scoresRefNo", header: "SCORES Ref No", kind: "text", aliases: ["SCORES Reference"], help: "For a complaint received through SCORES." },
  ],
  examples: [
    {
      type: "Nominee update", subject: "Add nominee to folio 12345678", description: "Client wants to add his daughter as nominee",
      priority: "Normal", status: "In progress", channel: "WhatsApp", clientPan: "ABCDE1234F", assignedTo: "rahul@yourfirm.in",
      createdDate: "20-11-2026", remarks: "Form sent on WhatsApp",
    },
    {
      ticketNo: "SR-2026-00412", type: "Complaint", subject: "Redemption proceeds not received", priority: "High", status: "Resolved",
      channel: "Email", clientName: "Meera Patel", assignedTo: "Priya Shah", createdDate: "02-11-2026", resolvedDate: "09-11-2026",
      resolutionNotes: "Payment released by the AMC on 8 Nov", sebiCategory: "Transaction / order", complaintSource: "Direct (client)",
    },
    {
      type: "Statement request", subject: "Capital gains statement FY 2025-26", priority: "Low", status: "Closed", channel: "Phone",
      requesterName: "Mr. Shah (not yet a client)", createdDate: "05-11-2026", resolvedDate: "05-11-2026 16:00",
    },
  ],
  notes: [
    "Fill the Data sheet, one request per row, starting under the headings. The Example sheet shows filled rows — copy from it if useful.",
    "Columns marked * must be filled. Link a client by PAN or exact name, or write a Requester Name when there is no client record.",
    "Dates are read day first: 24-11-2026, 24/11/2026 or 24 Nov 2026.",
    "Imported requests send no acknowledgement to the client and start no automations — they are records, not new requests.",
    "The response and resolution clocks (SLA) run from the Created Date, by the service type.",
    "Importing the same file twice creates the requests twice, unless you gave Ticket Nos, which are refused the second time.",
  ],
};
