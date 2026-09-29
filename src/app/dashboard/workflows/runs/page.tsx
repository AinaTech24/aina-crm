/**
 * Moved: the Automation Monitor is now the Run history tab of /dashboard/automations. Kept as a redirect so bookmarks,
 * emails and old links still land in the right place.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Redirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const keep = new URLSearchParams();
  for (const k of ["window"]) {
    const v = sp[k];
    if (v) keep.set(k, v);
  }
  const qs = keep.toString();
  redirect(`/dashboard/automations/history${qs ? `?${qs}` : ""}`);
}
