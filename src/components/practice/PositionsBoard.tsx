"use client";

/**
 * The firm's positions, one card each: the contract (purpose, results,
 * approvals), who fills it, the core processes it owns and its SOPs. A
 * manager edits the contract, picks the holders, and adds or deletes
 * positions.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { PositionEditDialog, type PositionDraft } from "./PositionEditDialog";
import { PositionHoldersDialog, type TeamMember } from "./PositionHoldersDialog";

export type BoardPosition = {
  id: string;
  key: string;
  title: string;
  purpose: string | null;
  results: string[];
  approvals: string[];
  holders: TeamMember[];
  processes: Array<{ key: string; name: string }>;
  sops: Array<{ id: string; title: string }>;
};

const safeAvatar = (u: string | null) => (u && /^(https?:\/\/|\/)/.test(u) ? u : null);

export function PositionsBoard({
  positions,
  team,
  canManage,
}: {
  positions: BoardPosition[];
  team: TeamMember[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PositionDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [holdersFor, setHoldersFor] = useState<BoardPosition | null>(null);

  async function remove(p: BoardPosition) {
    const ok = await confirmDialog({
      title: `Delete ${p.title}?`,
      message: p.processes.length
        ? `Its holders are released and ${p.processes.length} process${p.processes.length > 1 ? "es" : ""} it owns will have no owner.`
        : "Its holders are released. This cannot be undone.",
      confirmLabel: "Delete position",
      tone: "danger",
    });
    if (!ok) return;
    const r = await fetch(`/api/practice/positions/${p.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { notify.error(j.error ?? "Could not delete the position"); return; }
    notify.success("Position deleted");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add position
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {positions.map((p) => (
          <Card key={p.id} equal>
            <CardHeader
              title={p.title}
              subtitle={p.purpose ?? undefined}
              action={canManage ? (
                <>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${p.title}`} title="Edit the contract"
                    onClick={() => setEditing({ id: p.id, title: p.title, purpose: p.purpose, results: p.results, approvals: p.approvals })}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${p.title}`} title="Delete the position" onClick={() => remove(p)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </>
              ) : undefined}
            />
            <CardBody className="space-y-4">
              <section aria-label="Holders">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filled by</h4>
                  {canManage && (
                    <Button variant="link" size="sm" icon={<Users className="size-3.5" aria-hidden />} onClick={() => setHoldersFor(p)}>
                      {p.holders.length ? "Change" : "Assign"}
                    </Button>
                  )}
                </div>
                {p.holders.length ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {p.holders.map((h) => (
                      <li key={h.userId} className="inline-flex items-center gap-2 rounded-full bg-secondary/70 py-1 pl-1 pr-3 text-sm">
                        <Avatar src={safeAvatar(h.avatarUrl)} name={h.name} size={24} />
                        <span className="truncate">{h.name}</span>
                        {h.roles.includes("owner") && <Badge tone="neutral">Owner</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2"><Badge tone="warning" dot>Vacant — nobody fills this position</Badge></div>
                )}
              </section>

              <ListSection title="Results this position answers for" items={p.results} empty="No results written yet." />
              <ListSection title="May approve" items={p.approvals} empty="Approves nothing on its own." />

              {p.processes.length > 0 && (
                <section aria-label="Processes owned">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owns these processes</h4>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {p.processes.map((pr) => <li key={pr.key}><Badge tone="neutral" raw>{pr.name}</Badge></li>)}
                  </ul>
                </section>
              )}

              <section aria-label="SOPs">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SOPs</h4>
                {p.sops.length ? (
                  <ul className="mt-2 space-y-1">
                    {p.sops.map((s) => (
                      <li key={s.id}>
                        <Link href={`/dashboard/sops/${s.id}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                          <FileText className="size-3.5" aria-hidden /> {s.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No SOP linked yet.</p>
                )}
              </section>
            </CardBody>
          </Card>
        ))}
      </div>

      {(adding || editing) && (
        <PositionEditDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(null); } }}
          position={editing}
        />
      )}
      {holdersFor && (
        <PositionHoldersDialog
          key={holdersFor.id}
          open
          onOpenChange={(o) => { if (!o) setHoldersFor(null); }}
          positionId={holdersFor.id}
          positionTitle={holdersFor.title}
          current={holdersFor.holders.map((h) => h.userId)}
          team={team}
        />
      )}
    </div>
  );
}

function ListSection({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section aria-label={title}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {items.length ? (
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
          {items.map((r) => <li key={r}>{r}</li>)}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
