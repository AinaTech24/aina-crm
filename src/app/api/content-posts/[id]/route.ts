/**
 * Single content-post endpoints.
 *
 *   GET    /api/content-posts/[id]
 *   PATCH  /api/content-posts/[id]
 *   DELETE /api/content-posts/[id]   (soft cancel)
 *
 * Posting guard: setting postedStatus='posted' requires both
 *   - complianceChecked = true
 *   - approvalStatus    = 'approved'
 * Either gate open ⇒ 409 with `blockedBy` payload so the UI can show why.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import {
  contentPosts,
  POST_APPROVAL_STATUSES,
  POST_CONTENT_TYPES,
  POST_PLATFORMS,
  POST_POSTING_STATUSES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    contentDate: z.string().optional(),
    platform: z.enum(POST_PLATFORMS).optional(),
    contentType: z.enum(POST_CONTENT_TYPES).optional(),
    topic: z.string().min(1).max(200).optional(),
    caption: z.string().max(5000).optional(),
    creativeFiles: z
      .array(
        z.object({
          name: z.string(),
          url: z.string(),
          kind: z.enum(["image", "video", "doc"]).optional(),
        })
      )
      .optional(),
    complianceChecked: z.boolean().optional(),
    complianceNotes: z.string().max(1000).optional(),
    approvalStatus: z.enum(POST_APPROVAL_STATUSES).optional(),
    rejectionReason: z.string().max(500).optional(),
    postedStatus: z.enum(POST_POSTING_STATUSES).optional(),
    postLink: z.string().max(500).optional(),
    campaignId: z.string().uuid().optional(),
    remarks: z.string().max(1000).optional(),
  })
  .strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const row = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(contentPosts).where(eq(contentPosts.id, id)).limit(1))[0] ?? null
    );
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parse.error.issues },
        { status: 400 }
      );
    }
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx.select().from(contentPosts).where(eq(contentPosts.id, id)).limit(1)
      )[0];
      if (!before) return { row: null as any };

      // Effective values (merge of incoming patch onto existing row)
      const eff = {
        complianceChecked:
          parse.data.complianceChecked ?? before.complianceChecked,
        approvalStatus: parse.data.approvalStatus ?? before.approvalStatus,
        postedStatus: parse.data.postedStatus ?? before.postedStatus,
      };

      // ── Spec automation ─────────────────────────────────────────────
      // Content cannot be marked as posted unless compliance check is
      // completed and approved.
      if (eff.postedStatus === "posted") {
        if (!eff.complianceChecked || eff.approvalStatus !== "approved") {
          return {
            row: null as any,
            guard: {
              error:
                "Cannot mark as posted: compliance check must be completed and the post must be approved.",
              blockedBy: {
                compliance: !eff.complianceChecked,
                approval: eff.approvalStatus !== "approved",
              },
            },
          };
        }
      }

      const patch: any = { ...parse.data, updatedAt: new Date() };
      const now = new Date();

      // Auto-stamp side effects of status transitions
      if (parse.data.complianceChecked === true && !before.complianceChecked) {
        patch.complianceCheckedAt = now;
        patch.complianceCheckedByUserId = session.userId;
      }
      if (parse.data.complianceChecked === false && before.complianceChecked) {
        patch.complianceCheckedAt = null;
        patch.complianceCheckedByUserId = null;
      }
      if (parse.data.approvalStatus === "approved" && before.approvalStatus !== "approved") {
        patch.approvedByUserId = session.userId;
        patch.approvedAt = now;
      }
      if (parse.data.postedStatus === "posted" && before.postedStatus !== "posted") {
        patch.postedAt = now;
      }

      const r = await tx
        .update(contentPosts)
        .set(patch)
        .where(eq(contentPosts.id, id))
        .returning();

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "content_post.update",
        entityType: "content_post",
        entityId: id,
        before: {
          postedStatus: before.postedStatus,
          approvalStatus: before.approvalStatus,
          complianceChecked: before.complianceChecked,
        } as any,
        after: parse.data as any,
        ...clientMeta,
      });

      return { row: r[0] };
    });

    if ((result as any).guard) {
      return NextResponse.json((result as any).guard, { status: 409 });
    }
    if (!(result as any).row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json((result as any).row);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      const before = (
        await tx.select().from(contentPosts).where(eq(contentPosts.id, id)).limit(1)
      )[0];
      if (!before) return;
      await tx
        .update(contentPosts)
        .set({ postedStatus: "cancelled", updatedAt: new Date() } as any)
        .where(eq(contentPosts.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "content_post.delete",
        entityType: "content_post",
        entityId: id,
        before: { topic: before.topic, platform: before.platform, postedStatus: before.postedStatus },
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
