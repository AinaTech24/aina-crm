/**
 * SOP links — an SOP attached to where the work happens (lib/practice/sop-links.ts).
 *
 *   GET    ?sopId=<uuid>            → { links: [{ id, targetKind, targetKey, label }] }
 *   GET    ?kind=<kind>&key=<key>   → { sops: LinkedSop[] }   (SOPs for one target)
 *   POST   { sopId, targetKind, targetKey } → { id }   (idempotent on the unique key)
 *   DELETE ?id=<uuid>               → { ok: true }
 *
 * Reads: any signed-in member of staff (the manual is for everyone).
 * Writes: practice managers (canManagePractice), else `sop.manage`.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";
import { SOP_LINK_KINDS, type SopLinkKind } from "@/db/schema/practice";
import { canManagePractice } from "@/lib/practice/access";
import { PROCESS_BY_KEY } from "@/lib/practice/catalog";
import {
  isSopLinkKind, isUuid, linkTargetLabel, linkedSopsFor, loadLinkLabelNames, parseBlueprintStageKey,
} from "@/lib/practice/sop-links";
import type { SessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function requireWrite(session: SessionUser) {
  if (!canManagePractice(session)) requireCap(session.roles, "sop.manage", session.permissions);
}

const opts = (s: SessionUser) => ({ userId: s.userId, branchId: s.branchId, roles: s.roles });

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const sp = req.nextUrl.searchParams;
    const sopId = sp.get("sopId");
    const kind = sp.get("kind");
    const key = sp.get("key");

    if (sopId) {
      if (!isUuid(sopId)) return NextResponse.json({ error: "invalid sopId" }, { status: 400 });
      const links = await withTenant(session.tenantId, async (tx) => {
        const r = await tx.execute(sql`
          SELECT id, target_kind, target_key FROM sop_links
           WHERE tenant_id = ${session.tenantId}::uuid AND sop_id = ${sopId}::uuid
           ORDER BY target_kind, created_at
        `);
        const names = await loadLinkLabelNames(tx, session.tenantId);
        return (r.rows as Array<{ id: string; target_kind: SopLinkKind; target_key: string }>).map((row) => ({
          id: row.id,
          targetKind: row.target_kind,
          targetKey: row.target_key,
          label: linkTargetLabel(row.target_kind, row.target_key, names),
        }));
      }, opts(session));
      return NextResponse.json({ links });
    }

    if (kind && key) {
      if (!isSopLinkKind(kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });
      const sops = await withTenant(session.tenantId, (tx) => linkedSopsFor(tx, session.tenantId, [{ kind, key }]), opts(session));
      return NextResponse.json({ sops });
    }

    return NextResponse.json({ error: "pass sopId, or kind and key" }, { status: 400 });
  } catch (err) {
    return handleApiError(err);
  }
}

const Body = z.object({
  sopId: z.string().uuid(),
  targetKind: z.enum(SOP_LINK_KINDS),
  targetKey: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireWrite(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    const { sopId, targetKind, targetKey } = parse.data;
    const meta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const sop = await tx.execute(sql`
        SELECT id, title FROM sops WHERE id = ${sopId}::uuid AND tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL
      `);
      if (!sop.rows.length) return { error: "SOP not found", status: 404 } as const;

      // The target must be one this firm actually has.
      let ok = true;
      if (targetKind === "process") ok = PROCESS_BY_KEY.has(targetKey);
      else if (targetKind === "position") {
        ok = isUuid(targetKey) && (await tx.execute(sql`
          SELECT 1 FROM practice_positions WHERE id = ${targetKey}::uuid AND tenant_id = ${session.tenantId}::uuid
        `)).rows.length > 0;
      } else if (targetKind === "task_template") {
        ok = isUuid(targetKey) && (await tx.execute(sql`
          SELECT 1 FROM task_templates WHERE id = ${targetKey}::uuid AND tenant_id = ${session.tenantId}::uuid
        `)).rows.length > 0;
      } else if (targetKind === "blueprint_stage") ok = !!parseBlueprintStageKey(targetKey);
      else ok = /^[a-z0-9_]+$/.test(targetKey); // task_type, sr_type: stored type keys
      if (!ok) return { error: "unknown target", status: 400 } as const;

      const ins = await tx.execute(sql`
        INSERT INTO sop_links (tenant_id, sop_id, target_kind, target_key)
        VALUES (${session.tenantId}::uuid, ${sopId}::uuid, ${targetKind}, ${targetKey})
        ON CONFLICT (tenant_id, sop_id, target_kind, target_key) DO NOTHING
        RETURNING id
      `);
      if (ins.rows.length) {
        const id = (ins.rows[0] as { id: string }).id;
        await recordAudit(tx, {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "sop.link",
          entityType: "sop",
          entityId: sopId,
          after: { linkId: id, targetKind, targetKey },
          ...meta,
        });
        return { id, created: true };
      }
      const existing = await tx.execute(sql`
        SELECT id FROM sop_links
         WHERE tenant_id = ${session.tenantId}::uuid AND sop_id = ${sopId}::uuid
           AND target_kind = ${targetKind} AND target_key = ${targetKey}
      `);
      return { id: (existing.rows[0] as { id: string }).id, created: false };
    }, opts(session));

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ id: result.id }, { status: result.created ? 201 : 200 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireWrite(session);
    await assertActiveLicense(session.tenantId, session.roles);
    const id = req.nextUrl.searchParams.get("id");
    if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const meta = clientMetaFromHeaders(req.headers);
    const removed = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        DELETE FROM sop_links WHERE id = ${id}::uuid AND tenant_id = ${session.tenantId}::uuid
        RETURNING sop_id, target_kind, target_key
      `);
      const row = r.rows[0] as { sop_id: string; target_kind: string; target_key: string } | undefined;
      if (!row) return false;
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "sop.unlink",
        entityType: "sop",
        entityId: row.sop_id,
        before: { linkId: id, targetKind: row.target_kind, targetKey: row.target_key },
        ...meta,
      });
      return true;
    }, opts(session));
    if (!removed) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
