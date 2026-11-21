/**
 * New service request — field-for-field the web form
 * (src/app/dashboard/service-requests/new/page.tsx): client (optional — a
 * general request has none), type, priority, subject, description, channel,
 * assignee (defaults to you), and for a complaint the SEBI register fields.
 * POST /api/service-requests; the server opens the ticket (number, SLA, the
 * client acknowledgement) exactly as it does for the web.
 */

import type { FormSpec } from "./types";

const TYPES = [
  { value: "nominee_update", label: "Nominee update" },
  { value: "bank_update", label: "Bank update" },
  { value: "mobile_update", label: "Mobile update" },
  { value: "email_update", label: "Email update" },
  { value: "kyc_update", label: "KYC update" },
  { value: "minor_to_major", label: "Minor → Major" },
  { value: "capital_gain_report", label: "Capital gain report" },
  { value: "statement_request", label: "Statement request" },
  { value: "redemption_request", label: "Redemption request" },
  { value: "switch_request", label: "Switch request" },
  { value: "transmission_case", label: "Transmission case" },
  { value: "folio_correction", label: "Folio correction" },
  { value: "complaint", label: "Complaint" },
  { value: "other", label: "Other" },
];

const SEBI_CATEGORIES = [
  { value: "service", label: "Service / TAT" },
  { value: "mis_selling", label: "Mis-selling" },
  { value: "transaction", label: "Transaction / order" },
  { value: "fee", label: "Fee / commission" },
  { value: "kyc", label: "KYC / documents" },
  { value: "communication", label: "Communication / statements" },
  { value: "other", label: "Other" },
];

const COMPLAINT_SOURCES = [
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

/** A subject someone else can act on — the web's floor. */
const SUBJECT_MIN = 6;
const isComplaint = (v: Record<string, any>) => v.type === "complaint";

export const serviceRequestForm: FormSpec = {
  title: "New service request",
  endpoint: "/api/service-requests",
  submitLabel: "Create request",
  initial: (params) => ({
    investorId: params.investorId ?? "",
    type: params.type === "complaint" ? "complaint" : "kyc_update",
    subject: "",
    description: "",
    priority: "normal",
    channel: "phone",
    sebiCategory: "service",
    sebiSubCategory: "",
    complaintSource: "direct",
    scoresRefNo: "",
    assignedToUserId: "",
  }),
  sections: [
    {
      fields: [
        {
          key: "investorId",
          label: "Client",
          type: "typeahead",
          searchEndpoint: "/api/search",
          searchEnvelope: "investors",
          searchLabel: (i) => i.name,
          searchSublabel: (i) => [i.pan_display, i.segment_tag].filter(Boolean).join(" · "),
          placeholder: "Search a client — or leave blank for a general request",
        },
        { key: "type", label: "Type", type: "select", required: true, options: TYPES },
        {
          key: "priority",
          label: "Priority",
          type: "select",
          options: [
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ],
        },
        {
          key: "subject",
          label: "Subject",
          required: true,
          placeholder: "e.g. Update bank account on folio 12345",
          help: "What the client needs, in a few words — this is what the team sees in the list.",
        },
        { key: "description", label: "Description", type: "textarea" },
        {
          key: "channel",
          label: "Channel",
          type: "select",
          options: [
            { value: "phone", label: "Phone" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "email", label: "Email" },
            { value: "in_person", label: "In person" },
            { value: "form", label: "Web form" },
          ],
        },
        {
          key: "assignedToUserId",
          label: "Assign to",
          type: "lookup",
          lookupEndpoint: "/api/employees",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "Assign to myself",
          clearable: true,
        },
      ],
    },
    {
      title: "SEBI complaint register",
      visibleIf: isComplaint,
      fields: [
        { key: "sebiCategory", label: "SEBI category", type: "select", required: true, options: SEBI_CATEGORIES },
        { key: "sebiSubCategory", label: "Sub-category", placeholder: "e.g. Scheme switch, NAV dispute" },
        { key: "complaintSource", label: "Source", type: "select", options: COMPLAINT_SOURCES },
        {
          key: "scoresRefNo",
          label: "SCORES ref no",
          placeholder: "e.g. 2026/0001234",
          visibleIf: (v) => v.complaintSource === "scores",
          help: "Complaints carry a 21-day resolution SLA.",
        },
      ],
    },
  ],
  validate: (v): Record<string, string> | null => {
    const len = String(v.subject ?? "").trim().length;
    if (len < SUBJECT_MIN) return { subject: `Describe the request in at least ${SUBJECT_MIN} characters (${len} so far).` };
    if (isComplaint(v) && !v.sebiCategory) return { sebiCategory: "Pick the SEBI category." };
    return null;
  },
  buildBody: (v) => ({
    investorId: v.investorId || undefined,
    type: v.type,
    subject: String(v.subject).trim(),
    description: v.description || undefined,
    priority: v.priority,
    channel: v.channel,
    sebiCategory: isComplaint(v) ? v.sebiCategory || undefined : undefined,
    sebiSubCategory: isComplaint(v) ? v.sebiSubCategory || undefined : undefined,
    complaintSource: isComplaint(v) ? v.complaintSource || undefined : undefined,
    scoresRefNo: isComplaint(v) && v.complaintSource === "scores" ? v.scoresRefNo || undefined : undefined,
    assignedToUserId: v.assignedToUserId || undefined,
  }),
  redirect: (json) => (json?.id ? `/m/service-requests/${json.id}` : null),
  invalidate: ["service-requests", "command-center"],
};
