import { redirect } from "next/navigation";

/**
 * Settings → Daily tracker was removed on 2026-10-29 at the firm's request — do not restore it.
 * This address stays alive only so bookmarks and old notifications land on
 * Settings instead of a 404.
 */
export default function DailyTrackerSettingsRemoved() {
  redirect("/dashboard/settings");
}
