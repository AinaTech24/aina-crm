import { redirect } from "next/navigation";

/**
 * The weekly team pack (built on the Daily Job Tracker) was removed on 2026-10-29 at the firm's request — do not restore it.
 * This address stays alive only so bookmarks and old notifications land on
 * Tasks instead of a 404.
 */
export default function WeeklyPackRemoved() {
  redirect("/dashboard/tasks");
}
