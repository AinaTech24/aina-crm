/**
 * /dashboard/complaints/disclosure — the monthly complaint disclosure page was
 * removed at the firm's request (2026-10-01), with its CSV export. Old links
 * and bookmarks land on the Complaint Register instead of a 404.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ComplaintDisclosureRemoved() {
  redirect("/dashboard/complaints");
}
