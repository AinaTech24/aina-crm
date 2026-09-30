import { redirect } from "next/navigation";

/** "My Dashboards" became Manage dashboards when dashboards got names (D7). */
export default function OldBoards() {
  redirect("/dashboard/manage");
}
