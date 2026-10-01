import { redirect } from "next/navigation";

/**
 * My Day was removed on 2026-10-01 at the firm's request. This address stays
 * alive only so bookmarks, old notifications and morning-briefing emails land
 * on the viewer's own dashboard instead of a 404.
 */
export default function MyDayRemoved() {
  redirect("/dashboard");
}
