/**
 * The gate every Couriers page opens with. Called in each page, not in a layout:
 * Next renders a page alongside its layout, so a layout check alone would not
 * stop the page from loading its data.
 */

import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { canEditCouriers, couriersEnabled } from "./access";

export async function requireCourierPage() {
  const session = await requirePageSession();
  if (!(await couriersEnabled(session))) notFound();
  return {
    session,
    canEdit: canEditCouriers(session),
    context: { userId: session.userId, branchId: session.branchId, roles: session.roles },
  };
}
