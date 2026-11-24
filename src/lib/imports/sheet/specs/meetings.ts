/** The Meetings import sheet — see ../spec.ts. Pure data. */
import type { SheetSpec } from "../spec";
import { MAX_IMPORT_ROWS } from "../spec";

export const MEETING_CATEGORY_OPTIONS = [
  { value: "review", label: "Review" },
  { value: "new", label: "New" },
  { value: "follow_up", label: "Follow-up" },
];
export const MEETING_TYPE_OPTIONS = [
  { value: "portfolio_review", label: "Portfolio review" },
  { value: "goal_review", label: "Goal review" },
  { value: "service_discussion", label: "Service discussion" },
  { value: "family_review", label: "Family review" },
  { value: "complaint_discussion", label: "Complaint discussion" },
  { value: "discovery_call", label: "Discovery call" },
  { value: "new_client_kickoff", label: "New client kickoff" },
  { value: "new_investment_discussion", label: "New investment discussion" },
  { value: "product_demo", label: "Product demo" },
  { value: "sales_pitch", label: "Sales pitch" },
  { value: "follow_up_call", label: "Follow-up call" },
  { value: "follow_up_visit", label: "Follow-up visit" },
  { value: "other", label: "Other" },
];
export const MEETING_MODE_OPTIONS = [
  { value: "office", label: "Office" },
  { value: "client_place", label: "Client place" },
  { value: "online", label: "Online" },
  { value: "phone", label: "Phone" },
];
export const MEETING_STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No show" },
];

export const meetingsSpec: SheetSpec = {
  entity: "meetings",
  label: "Meetings",
  singular: "meeting",
  maxRows: MAX_IMPORT_ROWS,
  columns: [
    { key: "clientPan", header: "Client PAN", kind: "client", help: "The client the meeting is with. The PAN is the surest way to find them. Give a client OR a lead, not both." },
    { key: "clientName", header: "Client Name", kind: "client", aliases: ["Client"], help: "Used when there is no PAN. It must match one client exactly." },
    { key: "leadMobile", header: "Lead Mobile", kind: "lead", help: "The lead the meeting is with (instead of a client)." },
    { key: "leadName", header: "Lead Name", kind: "lead", aliases: ["Lead"], help: "Used when there is no mobile. It must match one lead exactly." },
    { key: "meetingDate", header: "Meeting Date", required: true, kind: "date", aliases: ["Date"], help: "The day of the meeting." },
    { key: "meetingTime", header: "Meeting Time", kind: "time", aliases: ["Time", "Start Time"], help: "India time, e.g. 14:30 or 2:30 pm. Blank = 10:00 am." },
    { key: "durationMinutes", header: "Duration (minutes)", kind: "integer", aliases: ["Duration"], help: "Blank = 30." },
    { key: "category", header: "Category", kind: "enum", options: MEETING_CATEGORY_OPTIONS, help: "Blank = Review." },
    { key: "meetingType", header: "Meeting Type", required: true, kind: "enum", options: MEETING_TYPE_OPTIONS, aliases: ["Type", "Agenda Type"], help: "What the meeting is for." },
    { key: "meetingMode", header: "Mode", required: true, kind: "enum", options: MEETING_MODE_OPTIONS, aliases: ["Meeting Mode"], help: "Where or how it happens." },
    { key: "locationOrLink", header: "Location / Link", kind: "text", aliases: ["Location", "Link", "Venue"], help: "An address, or the video-call link." },
    { key: "subject", header: "Subject", kind: "text", aliases: ["Title", "Headline"], help: "A short headline (up to 300 characters)." },
    { key: "discussionPoints", header: "Agenda / Discussion Points", kind: "longtext", aliases: ["Agenda", "Discussion Points"], help: "What is to be discussed." },
    { key: "status", header: "Status", kind: "enum", options: MEETING_STATUS_OPTIONS, help: "Blank = Completed for a past date, Scheduled for today or later." },
    { key: "rm", header: "RM", kind: "user", aliases: ["Relationship Manager", "Owner", "RM Email"], help: "The team member who holds it — email (best) or name. Blank = the client's or lead's own RM, else you." },
    { key: "coAttendees", header: "Other Attendees", kind: "list", aliases: ["Attendees", "Co Attendees"], help: "Colleagues or guests, separated by ; — a team member's email or name; anyone else is added as a guest." },
  ],
  examples: [
    {
      clientPan: "ABCDE1234F", meetingDate: "02-12-2026", meetingTime: "11:00", durationMinutes: "45", category: "Review",
      meetingType: "Portfolio review", meetingMode: "Office", subject: "Annual portfolio review", discussionPoints: "Asset allocation, SIP step-up, goals",
      rm: "rahul@yourfirm.in", coAttendees: "priya@yourfirm.in; Mrs. Meera Patel",
    },
    {
      leadMobile: "9876543210", meetingDate: "26-11-2026", meetingTime: "4:30 pm", category: "New", meetingType: "Discovery call",
      meetingMode: "Online", locationOrLink: "https://meet.google.com/abc-defg-hij", status: "Confirmed", rm: "Priya Shah",
    },
    {
      clientName: "Meera Patel", meetingDate: "10-11-2026", meetingType: "Follow-up call", meetingMode: "Phone", category: "Follow-up",
      discussionPoints: "Discussed the SIP bounce and the new mandate",
    },
  ],
  notes: [
    "Fill the Data sheet, one meeting per row, starting under the headings. The Example sheet shows filled rows — copy from it if useful.",
    "Columns marked * must be filled. Give each meeting a client (PAN or name) OR a lead (mobile or name) — exactly one.",
    "Dates are read day first: 24-11-2026, 24/11/2026 or 24 Nov 2026. Times are India time.",
    "Imported meetings send nothing to clients and start no automations (no confirmation or reminder messages). A meeting dated tomorrow or later also gets the usual reminder task for its RM.",
    "A meeting is not created when its RM already has one at the same time — those rows are listed so you can correct them.",
    "Importing the same file twice creates the meetings twice (the second time the clash check will list them).",
  ],
};
