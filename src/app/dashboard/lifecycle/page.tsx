import { redirect } from "next/navigation";

/**
 * The "Lead-to-client lifecycle" page was removed at the firm's request
 * (2026-10-02) — do not restore it. The Leads board and each lead's journey
 * cover the same ground. Old links and bookmarks land on Leads.
 */
export default function LifecycleRemoved() {
  redirect("/dashboard/leads");
}
