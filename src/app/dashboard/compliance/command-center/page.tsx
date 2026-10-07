import { redirect } from "next/navigation";

/**
 * The Compliance Center was removed at the firm's request (2026-10-07) — do
 * not restore it. Old links and bookmarks land on Compliance & DDQ readiness.
 */
export default function ComplianceCenterRemoved() {
  redirect("/dashboard/compliance");
}
