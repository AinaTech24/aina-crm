/**
 * What the Activity Log's popup says about one entry. A fact the entry does not
 * have is left out, never shown as zero or a dash.
 */

import { formatDate } from "@/lib/format";

export type ActivityFactsRow = {
  occurred_at: string | Date | null;
  created_at?: string | Date | null;
  direction?: string | null;
  status?: string | null;
  duration_sec?: number | null;
  location_label?: string | null;
  geo_lat?: string | number | null;
  geo_lng?: string | number | null;
  next_followup_at?: string | Date | null;
  owner_name?: string | null;
};

const words = (v: string) => {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function durationText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return [m ? `${m} min` : "", s ? `${s} sec` : ""].filter(Boolean).join(" ");
}

export function activityFacts(a: ActivityFactsRow): [label: string, value: string][] {
  const facts: [string, string][] = [["When", formatDate(a.occurred_at, "dateTime")]];
  if (a.direction) facts.push(["Direction", words(a.direction)]);
  if (a.status) facts.push(["Outcome", words(a.status)]);
  if (a.duration_sec) facts.push(["Duration", durationText(Number(a.duration_sec))]);
  if (a.location_label) facts.push(["Location", a.location_label]);
  if (a.geo_lat != null && a.geo_lng != null) facts.push(["Coordinates", `${Number(a.geo_lat)}, ${Number(a.geo_lng)}`]);
  if (a.next_followup_at) facts.push(["Next follow-up", formatDate(a.next_followup_at, "dateTime")]);
  facts.push(["Logged by", a.owner_name || "—"]);
  if (a.created_at) {
    // Worth saying only when it was written down at a different time.
    const logged = formatDate(a.created_at, "dateTime");
    if (logged !== facts[0][1]) facts.push(["Logged on", logged]);
  }
  return facts;
}
