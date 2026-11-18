/** Who is acting in the setup wizard, with the request's IP and browser for the record. */
import type { NextRequest } from "next/server";
import { clientMetaFromHeaders } from "@/lib/audit";

export function wizardActor(session: { tenantId: string; userId: string; email: string; name: string }, req: NextRequest) {
  const meta = clientMetaFromHeaders(req.headers);
  return { tenantId: session.tenantId, userId: session.userId, email: session.email, name: session.name, ip: meta.ipAddress, userAgent: meta.userAgent?.slice(0, 400) ?? null };
}
