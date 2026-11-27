/**
 * The gate every Visitor Register page opens with. Called in each page, not in a
 * layout: Next renders a page alongside its layout, so a layout check alone
 * would not stop the page from loading its data.
 */

import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { canEditVisitors, visitorRegisterEnabled } from "./access";

export async function requireVisitorPage() {
  const session = await requirePageSession();
  if (!(await visitorRegisterEnabled(session))) notFound();
  return {
    session,
    canEdit: canEditVisitors(session),
    context: { userId: session.userId, branchId: session.branchId, roles: session.roles },
  };
}
