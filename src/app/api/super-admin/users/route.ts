import { handleApiError } from "@/lib/api/error-handler";
/**
 * AINA platform-staff CRUD.
 * Only platform_admin can create new platform users.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { PLATFORM_TENANT_ID } from "@/lib/platform";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["platform_admin", "platform_support"]),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.staff.manage");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const body = parse.data;
    const id = uuid();
    const hash = await bcrypt.hash(body.password, 12);

    await withPlatformAdmin(session.userId, async (tx) => {
      const rolesLiteral = sql.raw(`ARRAY['${body.role}']::text[]`);
      await tx.execute(sql`
        INSERT INTO users (id, tenant_id, email, name, password_hash, roles, status, activated_at, created_at, updated_at)
        VALUES (${id}, ${PLATFORM_TENANT_ID}::uuid, ${body.email.toLowerCase()}, ${body.name},
                ${hash}, ${rolesLiteral}, 'active', now(), now(), now())
      `);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("users_tenant_email_unique")) {
      return NextResponse.json({ error: "email already used by another platform user" }, { status: 409 });
    }
    return handleApiError(err);
  }
}
