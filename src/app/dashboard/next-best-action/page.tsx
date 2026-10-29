import { redirect } from "next/navigation";

/**
 * Next Best Action was removed on 2026-10-29 at the firm's request — do not restore it.
 * This address stays alive only so bookmarks and old notifications land on
 * the viewer's own dashboard instead of a 404.
 */
export default function NextBestActionRemoved() {
  redirect("/dashboard");
}
