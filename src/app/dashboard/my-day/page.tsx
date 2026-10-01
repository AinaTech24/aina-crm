import { redirect } from "next/navigation";

/** My Day was removed (2026-10-01); the old address opens the viewer's dashboard. */
export default function MyDayRedirect() {
  redirect("/dashboard");
}
