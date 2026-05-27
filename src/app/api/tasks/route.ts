import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

const DEPARTMENTS = [
  "sales",
  "operations",
  "back_office",
  "compliance",
  "marketing",
  "advisory",
  "support",
  "leadership",
  "other",
] as const;

const Body = z.object({
  title: z.string().min(2).max(300),
  description: z.string().optional(),
  type: z.string().default("follow_up"),
  subjectType: z
    .enum(["investor", "lead", "folio", "transaction", "family", "service_request", "compliance", "internal"])
    .default("internal"),
  subjectId: z.string().uuid().optional(),
  /** Module 18 — explicit related-entity ids (any combination). */
  relatedInvestorId: z.string().uuid().optional(),
  relatedLeadId: z.string().uuid().optional(),
  relatedServiceRequestId: z.string().uuid().optional(),
  relatedMeetingId: z.string().uuid().optional(),
  department: z.enum(DEPARTMENTS).optional(),
  remarks: z.string().max(1000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => tx.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(200));
    return NextResponse.json({ tasks: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "task.edit.all");
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const body = parse.data;
    const id = uuid();
    // Derive subjectType/subjectId from the first related entity if the caller
    // didn't set one explicitly — keeps legacy queries working.
    let derivedType = body.subjectType;
    let derivedId = body.subjectId ?? null;
    if (!body.subjectId) {
      if (body.relatedInvestorId) {
        derivedType = "investor";
        derivedId = body.relatedInvestorId;
      } else if (body.relatedLeadId) {
        derivedType = "lead";
        derivedId = body.relatedLeadId;
      } else if (body.relatedServiceRequestId) {
        derivedType = "service_request";
        derivedId = body.relatedServiceRequestId;
      } else if (body.relatedMeetingId) {
        derivedType = "internal";
        derivedId = body.relatedMeetingId;
      }
    }

    await withTenant(session.tenantId, async (tx) => {
      await tx.insert(tasks).values({
        id,
        tenantId: session.tenantId,
        subjectType: derivedType,
        subjectId: derivedId,
        relatedInvestorId: body.relatedInvestorId ?? null,
        relatedLeadId: body.relatedLeadId ?? null,
        relatedServiceRequestId: body.relatedServiceRequestId ?? null,
        relatedMeetingId: body.relatedMeetingId ?? null,
        department: body.department ?? null,
        type: body.type,
        title: body.title,
        description: body.description,
        remarks: body.remarks,
        priority: body.priority,
        status: "open",
        assigneeId: body.assigneeId ?? session.userId,
        createdById: session.userId,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      } as any);
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
