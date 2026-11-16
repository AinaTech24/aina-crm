/**
 * One row of a Zoho CRM "Meetings" export → a review meeting. Pure; tested in
 * tests/zoho-import.test.ts.
 *
 * Decisions (We Care Freedom Wealth, 2026-11-14):
 *  - Only meetings with a Contact are imported; a meeting tied only to a Lead
 *    or a Deal ("Related To") is skipped.
 *  - Host is the meeting's RM.
 *  - A meeting whose time has passed but that Zoho still calls scheduled
 *    comes in as Completed.
 *  - Nothing is triggered: no reminder task, no notification, no workflow.
 */

import type { REVIEW_MEETING_MODES, REVIEW_MEETING_TYPES } from "@/db/schema";
import { cell, hasTime, istInstant, yesNo, zohoId } from "./values";

export const MEETING_SIGNATURE = ["Record Id", "Host", "From"];

type MeetingType = (typeof REVIEW_MEETING_TYPES)[number];
type MeetingMode = (typeof REVIEW_MEETING_MODES)[number];
export type ImportedMeetingStatus = "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";

export type MappedMeeting = {
  zohoId: string;
  hostText: string;
  contactZohoId: string;
  contactName: string;
  subject: string | null;
  start: Date | null;
  durationMinutes: number;
  meetingType: MeetingType;
  meetingMode: MeetingMode;
  locationOrLink: string | null;
  status: ImportedMeetingStatus;
  /** Zoho said scheduled, but the time is past — imported as completed. */
  closedAsPast: boolean;
  discussionPoints: string | null;
  zohoType: string;
  zohoStatus: string;
  /** Why this row is not imported, if it is not. */
  skip: string | null;
};

const TYPE_RULES: Array<[RegExp, MeetingType]> = [
  [/goal/i, "goal_review"],
  [/family/i, "family_review"],
  [/complain|grievance/i, "complaint_discussion"],
  [/service|kyc|nomination|document|query/i, "service_discussion"],
  [/discover|intro|first|prospect|fact.?find/i, "discovery_call"],
  [/kick.?off|onboard|welcome/i, "new_client_kickoff"],
  [/demo|presentation/i, "product_demo"],
  [/pitch|sales/i, "sales_pitch"],
  [/new.?invest|investment|proposal|lumpsum|sip/i, "new_investment_discussion"],
  [/follow.?up.*(visit|meet)|visit/i, "follow_up_visit"],
  [/follow.?up|call/i, "follow_up_call"],
  [/review|portfolio|meeting/i, "portfolio_review"],
];

/** Zoho's Meeting Type text → the CRM's type. Blank reads as a portfolio review; anything unknown as Other. */
export function meetingTypeFromZoho(v: string): MeetingType {
  const s = v.trim();
  if (!s) return "portfolio_review";
  for (const [re, t] of TYPE_RULES) if (re.test(s)) return t;
  return "other";
}

/** Zoho's Meeting Venue / Location text → the CRM's mode. */
export function meetingModeFromZoho(venue: string, location: string): MeetingMode {
  const s = `${venue} ${location}`.toLowerCase();
  if (/zoom|meet\.google|google meet|teams|webex|online|virtual|video|https?:\/\//.test(s)) return "online";
  if (/phone|call|telephon|whatsapp/.test(s)) return "phone";
  if (/client|home|resid|house|site|their|visit|field/.test(s)) return "client_place";
  return "office";
}

function statusFromZoho(raw: string, checkedIn: string): Exclude<ImportedMeetingStatus, "scheduled"> | "scheduled" {
  const s = raw.toLowerCase();
  if (/cancel/.test(s)) return "cancelled";
  if (/no.?show|not.?turn|absent/.test(s)) return "no_show";
  if (/reschedul|postpone/.test(s)) return "rescheduled";
  if (/complet|done|held|close|finish|attended|conducted/.test(s)) return "completed";
  if (/checked.?in/i.test(checkedIn) || yesNo(checkedIn) === true) return "completed";
  return "scheduled";
}

/** Map one Meetings row. `now` decides which "scheduled" meetings are already past. */
export function mapZohoMeeting(row: Record<string, unknown>, now: Date = new Date()): MappedMeeting {
  const g = (col: string) => cell(row[col]);
  const contactZohoId = zohoId(row["Contact Name.id"]);
  const allDay = yesNo(row["All day"]) === true;

  let start = istInstant(row["From"]);
  // An all-day meeting (or one with only a date) sits at 10:00 IST, an hour long.
  if (start && (allDay || !hasTime(row["From"]))) start = new Date(start.getTime() + 10 * 3_600_000);
  const end = istInstant(row["To"]);
  let durationMinutes = 30;
  if (allDay || !hasTime(row["From"])) durationMinutes = 60;
  else if (start && end && end > start) durationMinutes = Math.min(Math.round((end.getTime() - start.getTime()) / 60_000), 12 * 60);

  const zohoStatus = g("Meeting Status");
  let status: ImportedMeetingStatus = statusFromZoho(zohoStatus, g("Checked In Status"));
  let closedAsPast = false;
  if (status === "scheduled" && start && start.getTime() < now.getTime()) {
    status = "completed";
    closedAsPast = true;
  }

  const venue = g("Meeting Venue");
  const location = g("Location");
  const title = g("Title");

  let skip: string | null = null;
  if (!contactZohoId) skip = g("Related To") ? "Linked to a lead or deal, not a contact" : "No contact on the meeting";
  else if (!start) skip = `Meeting date "${g("From")}" could not be read`;

  return {
    zohoId: zohoId(row["Record Id"]),
    hostText: g("Host"),
    contactZohoId,
    contactName: g("Contact Name"),
    subject: title ? title.slice(0, 300) : null,
    start,
    durationMinutes: Math.max(durationMinutes, 5),
    meetingType: meetingTypeFromZoho(g("Meeting Type") || title),
    meetingMode: meetingModeFromZoho(venue, location),
    locationOrLink: [location, venue].filter(Boolean).join(" · ").slice(0, 500) || null,
    status,
    closedAsPast,
    discussionPoints: g("Description") ? g("Description").slice(0, 5000) : null,
    zohoType: g("Meeting Type"),
    zohoStatus,
    skip,
  };
}
