/** The Visitor Register import sheet — see ../spec.ts. Pure data. */
import { VISITOR_LABELS } from "@/lib/visitors/entry";
import type { SheetSpec } from "../spec";
import { MAX_IMPORT_ROWS } from "../spec";

export const visitorsSpec: SheetSpec = {
  entity: "visitors",
  label: "Visitors",
  singular: "visit",
  maxRows: MAX_IMPORT_ROWS,
  columns: [
    { key: "visitorName", header: VISITOR_LABELS.visitorName, required: true, kind: "text", aliases: ["Name", "Visitor"], help: "Who came (200 characters at most)." },
    { key: "email", header: VISITOR_LABELS.email, kind: "text", aliases: ["Email Address", "Email ID"], help: "The visitor's email address." },
    { key: "mobile", header: VISITOR_LABELS.mobile, kind: "text", aliases: ["Mobile", "Mobile No", "Phone", "Phone Number", "Contact Number"], help: "7 to 15 digits; spaces, + - and brackets are fine." },
    { key: "companyName", header: VISITOR_LABELS.companyName, kind: "text", aliases: ["Company", "Organisation"], help: "Where the visitor is from." },
    { key: "visitDate", header: VISITOR_LABELS.visitDate, required: true, kind: "date", aliases: ["Date", "Date of Visit"], help: "The day of the visit." },
    { key: "entryTime", header: VISITOR_LABELS.entryTime, kind: "time", aliases: ["In Time", "Time In", "Check In"], help: "When they came in." },
    { key: "exitTime", header: VISITOR_LABELS.exitTime, kind: "time", aliases: ["Out Time", "Time Out", "Check Out"], help: "When they left. Not earlier than the Entry Time." },
    { key: "purpose", header: VISITOR_LABELS.purpose, kind: "longtext", aliases: ["Purpose"], help: "Why they came." },
    { key: "meetingWithUserId", header: VISITOR_LABELS.meetingWithUserId, kind: "user", aliases: ["Meeting With", "Person to Meet", "Met With"], help: "The team member they came to meet — email (best) or name." },
    { key: "remarks", header: VISITOR_LABELS.remarks, kind: "longtext", aliases: ["Notes", "Comments"], help: "Anything else." },
  ],
  // The names are refused on import, so an example row can never become a visit.
  examples: [
    {
      visitorName: "Sample Visitor 1", email: "visitor1@example.com", mobile: "98765 43210", companyName: "Sample Company",
      visitDate: "24-11-2026", entryTime: "10:30", exitTime: "11:15", purpose: "Submit KYC documents", remarks: "Delete this example row",
    },
    {
      visitorName: "Sample Visitor 2", mobile: "91234 56780", visitDate: "25-11-2026", entryTime: "3:00 pm",
      purpose: "New investment discussion", remarks: "Delete this example row",
    },
  ],
  notes: [
    "Only Visitor Name and Visit Date are required.",
    "Meeting with must be an active team member of your firm; leave it blank if not known.",
    "Replace the example rows (Sample Visitor 1 and 2) with your own — they are never imported.",
  ],
};
