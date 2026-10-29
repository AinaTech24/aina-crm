import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { ChevronLeft, ScrollText } from "lucide-react";
import { withTenant } from "@/db/client";
import { sops, sopVersions, sopAcknowledgements } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { formatDate } from "@/lib/utils";
import { AcknowledgeButton } from "@/components/sops/AcknowledgeButton";
import { PublishVersionForm } from "@/components/sops/PublishVersionForm";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SopLinksEditor, type SopLinkKindOptions } from "@/components/practice/SopLinksEditor";
import { SopMarkdown } from "@/components/practice/HowWeDoThisMarkdown";
import { canManagePractice } from "@/lib/practice/access";
import { SOP_LINK_KINDS, type SopLinkKind } from "@/db/schema/practice";
import { MASTER_SEEDS } from "@/lib/masters/seeds";
import {
  SOP_LINK_KIND_LABEL, blueprintStageOptions, linkTargetLabel, loadLinkLabelNames, processOptions, taskTypeOptions,
} from "@/lib/practice/sop-links";

export const dynamic = "force-dynamic";

export default async function SopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const data = await withTenant(session.tenantId, async (tx) => {
    // Tenant predicate — a foreign SOP id must resolve to not-found, not leak content.
    const sop = (
      await tx
        .select()
        .from(sops)
        .where(and(eq(sops.id, id), eq(sops.tenantId, session.tenantId), isNull(sops.deletedAt)))
        .limit(1)
    )[0];
    if (!sop) return null;
    const versions = await tx
      .select()
      .from(sopVersions)
      .where(and(eq(sopVersions.sopId, id), eq(sopVersions.tenantId, session.tenantId)))
      .orderBy(desc(sopVersions.createdAt));
    const current = versions.find((v) => v.id === sop.currentVersionId);
    
    const acks = current
      ? await tx
          .select()
          .from(sopAcknowledgements)
          .where(eq(sopAcknowledgements.sopVersionId, current.id))
      : [];

    const myAck = current
      ? (await tx
          .select()
          .from(sopAcknowledgements)
          .where(
            and(
              eq(sopAcknowledgements.sopVersionId, current.id),
              eq(sopAcknowledgements.userId, session.userId)
            )
          )
          .limit(1))[0] || null
      : null;

    // Where this applies — the SOP's links, in words, and what may be added.
    const linkRows = (await tx.execute(sql`
      SELECT id, target_kind, target_key FROM sop_links
       WHERE tenant_id = ${session.tenantId}::uuid AND sop_id = ${id}::uuid
       ORDER BY target_kind, created_at
    `)).rows as Array<{ id: string; target_kind: SopLinkKind; target_key: string }>;
    const names = await loadLinkLabelNames(tx, session.tenantId);
    const links = linkRows.map((l) => ({
      id: l.id, kind: l.target_kind, key: l.target_key, label: linkTargetLabel(l.target_kind, l.target_key, names),
    }));
    const templates = (await tx.execute(sql`
      SELECT id, name FROM task_templates WHERE tenant_id = ${session.tenantId}::uuid AND is_active ORDER BY name
    `)).rows as Array<{ id: string; name: string }>;
    const positions = (await tx.execute(sql`
      SELECT id, title FROM practice_positions WHERE tenant_id = ${session.tenantId}::uuid ORDER BY sort, title
    `)).rows as Array<{ id: string; title: string }>;
    const srMaster = (await tx.execute(sql`
      SELECT key, label FROM master_values
       WHERE tenant_id = ${session.tenantId}::uuid AND master_type = 'service_request_type' AND is_active
       ORDER BY sort_order, label
    `)).rows as Array<{ key: string; label: string }>;

    // Acknowledged by N of M holders of the positions this SOP is linked to.
    const positionIds = linkRows.filter((l) => l.target_kind === "position").map((l) => l.target_key);
    let holders: Array<{ name: string; acked: boolean }> = [];
    if (positionIds.length && current) {
      holders = ((await tx.execute(sql`
        SELECT u.name, bool_or(a.id IS NOT NULL) AS acked
          FROM practice_position_holders h
          JOIN users u ON u.id = h.user_id AND u.tenant_id = h.tenant_id
          LEFT JOIN sop_acknowledgements a ON a.user_id = h.user_id AND a.sop_version_id = ${current.id}::uuid
         WHERE h.tenant_id = ${session.tenantId}::uuid
           AND h.position_id IN (${sql.join(positionIds.map((p) => sql`${p}::uuid`), sql`, `)})
         GROUP BY u.id, u.name
         ORDER BY u.name
      `)).rows as Array<{ name: string; acked: boolean | null }>).map((r) => ({ name: String(r.name), acked: !!r.acked }));
    }

    return { sop, versions, current, acks, myAck, links, templates, positions, srMaster, holders };
  });
  if (!data) notFound();
  const canManage = can(session.roles, "sop.manage", session.permissions);
  const canManageLinks = canManage || canManagePractice(session);
  const srOptions = (data.srMaster.length ? data.srMaster : (MASTER_SEEDS.service_request_type ?? []))
    .filter((r) => r.key !== "complaint")
    .map((r) => ({ key: r.key, label: r.label }));
  const optionsByKind: Record<SopLinkKind, Array<{ key: string; label: string }>> = {
    process: processOptions(),
    task_type: taskTypeOptions(),
    task_template: data.templates.map((t) => ({ key: t.id, label: t.name })),
    position: data.positions.map((p) => ({ key: p.id, label: p.title })),
    blueprint_stage: blueprintStageOptions(),
    sr_type: srOptions,
  };
  const linkKinds: SopLinkKindOptions[] = SOP_LINK_KINDS.map((k) => ({
    kind: k,
    label: SOP_LINK_KIND_LABEL[k],
    options: optionsByKind[k],
  })).filter((k) => k.options.length > 0);
  const holdersAcked = data.holders.filter((h) => h.acked).length;
  const notYet = data.holders.filter((h) => !h.acked).map((h) => h.name);
  const currentMarkdown =
    ((data.current?.body as any)?.markdown as string | undefined) ?? "";

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/dashboard/sops" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to SOPs
      </Link>

      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4 flex-wrap justify-between">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <ScrollText className="size-8 text-muted-foreground mt-1 shrink-0" />
            <div className="min-w-0 flex-1">
<PageHeaderCard title={<>{data.sop.title}</>} />
<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{data.sop.key}</span>
                {data.sop.category && <span>· {data.sop.category}</span>}
                {data.current && <span>· v{data.current.versionNumber}</span>}
                <span>· {data.acks.length} acknowledged</span>
              </div>
              {(data.sop.requiredRoles ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(data.sop.requiredRoles ?? []).map((r: string) => (
                    <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-muted">{r}</span>
                  ))}
                </div>
              )}
</div>
          </div>
          
          {data.current && (
            <div className="pt-2 sm:pt-0 shrink-0">
              <AcknowledgeButton
                sopId={data.sop.id}
                hasAcknowledged={!!data.myAck}
                acknowledgedAt={data.myAck?.acknowledgedAt}
              />
            </div>
          )}
        </div>
      </div>

      {data.current && (
        <div className="border rounded-lg bg-card p-6">
          <h2 className="font-semibold mb-3">Current version (v{data.current.versionNumber})</h2>
          <p className="text-xs text-muted-foreground">
            Published {data.current.publishedAt ? formatDate(data.current.publishedAt) : "—"}
          </p>
          <div className="mt-3">
            {typeof (data.current.body as { markdown?: unknown } | null)?.markdown === "string" ? (
              <SopMarkdown markdown={(data.current.body as { markdown: string }).markdown} />
            ) : (
              <div className="text-sm whitespace-pre-wrap">{JSON.stringify(data.current.body, null, 2)}</div>
            )}
          </div>
          {canManage && (
            <div className="mt-5 pt-4 border-t">
              <PublishVersionForm sopId={data.sop.id} currentMarkdown={currentMarkdown} />
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title="Where this applies"
          subtitle="The work this SOP shows up in — a task's “How we do this”, the holders' operations manual."
        />
        <CardBody className="space-y-3">
        {data.holders.length > 0 && (
          <p className="text-sm">
            Acknowledged by <span className="font-semibold">{holdersAcked} of {data.holders.length}</span>{" "}
            {data.holders.length === 1 ? "holder" : "holders"} of the linked positions
            {notYet.length > 0 && (
              <span className="text-muted-foreground">
                {" "}· not yet: {notYet.slice(0, 8).join(", ")}{notYet.length > 8 ? ` and ${notYet.length - 8} more` : ""}
              </span>
            )}
          </p>
        )}
          <SopLinksEditor sopId={data.sop.id} links={data.links} kinds={linkKinds} canManage={canManageLinks} />
        </CardBody>
      </Card>

      {data.versions.length > 1 && (
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Version history</h2>
          <ul className="divide-y text-sm">
            {data.versions.map((v) => (
              <li key={v.id} className="py-2 flex items-center justify-between">
                <span>v{v.versionNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {v.publishedAt ? formatDate(v.publishedAt) : "draft"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
