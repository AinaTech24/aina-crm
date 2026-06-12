import { handleApiError } from "@/lib/api/error-handler";
/**
 * Packages CRUD (AINA only).
 *
 *   GET  /api/super-admin/packages   — list all packages
 *   POST /api/super-admin/packages   — create new package
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requirePlatform } from "@/lib/auth/rbac";
import { packages } from "@/db/schema";
import { ALL_MODULES } from "@/lib/platform";

export const dynamic = "force-dynamic";

const Body = z.object({
  key: z.string().min(2).max(60).regex(/^[a-z0-9_]+$/, "lowercase / underscores only"),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  monthlyPricePaise: z.number().int().nonnegative().default(0),
  yearlyPricePaise: z.number().int().nonnegative().default(0),
  setupCostPaise: z.number().int().nonnegative().default(0),
  perUserMonthlyPaise: z.number().int().nonnegative().default(0),
  perUserYearlyPaise: z.number().int().nonnegative().default(0),
  maxUsers: z.number().int().positive().default(1),
  maxInvestors: z.number().int().positive().default(100),
  storageLimitGb: z.number().int().positive().default(5),
  trialDays: z.number().int().nonnegative().default(14),
  enabledModules: z.array(z.enum(ALL_MODULES as any)),
  addonModules: z
    .array(
      z.object({
        module: z.enum(ALL_MODULES as any),
        monthlyPaise: z.number().int().nonnegative().default(0),
        yearlyPaise: z.number().int().nonnegative().default(0),
      })
    )
    .default([]),
  featureFlags: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  badge: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const rows = await withPlatformAdmin(session.userId, async (tx) => {
      return tx.select().from(packages).orderBy(asc(packages.sortOrder), asc(packages.name));
    });
    return NextResponse.json({ packages: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requirePlatform(session.roles, "platform.package.manage");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const id = uuid();
    await withPlatformAdmin(session.userId, async (tx) => {
      await tx.insert(packages).values({
        id,
        ...parse.data,
      } as any);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("packages_key_unique")) {
      return NextResponse.json({ error: "package key already exists" }, { status: 409 });
    }
    return handleApiError(err);
  }
}
