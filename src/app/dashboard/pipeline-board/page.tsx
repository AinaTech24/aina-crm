import { redirect } from "next/navigation";

/**
 * The Pipeline Board was removed at the firm's request (2026-10-02). Old
 * links and bookmarks land on the Leads page. Do not restore it.
 */
export default function PipelineBoardRemoved() {
  redirect("/dashboard/leads");
}
