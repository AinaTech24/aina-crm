"use client";

/**
 * Choose who fills a position: any number of active team members. Saving
 * replaces the holders; choosing nobody leaves the position vacant.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";
import { InlineEmpty } from "@/components/common/EmptyState";
import { ROLE_LABELS } from "@/lib/auth/rbac";

export type TeamMember = { userId: string; name: string; avatarUrl: string | null; roles: string[] };

const safeAvatar = (u: string | null) => (u && /^(https?:\/\/|\/)/.test(u) ? u : null);

export function PositionHoldersDialog({
  open,
  onOpenChange,
  positionId,
  positionTitle,
  current,
  team,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  positionId: string;
  positionTitle: string;
  current: string[];
  team: TeamMember[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(current));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? team.filter((m) => m.name.toLowerCase().includes(needle)) : team;
  }, [q, team]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/practice/positions/${positionId}/holders`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userIds: [...picked] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { notify.error(j.error ?? "Could not save the holders"); return; }
      notify.success(picked.size ? "Holders saved" : "Position left vacant");
      onOpenChange(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Who fills {positionTitle}?</DialogTitle>
          <DialogDescription>
            Pick everyone who does this job today. One person may fill several positions.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <input
            type="search"
            aria-label="Search team members"
            placeholder="Search the team"
            className="input-base"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {shown.length === 0 ? (
            <InlineEmpty message="No team member matches." />
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {shown.map((m) => {
                const checked = picked.has(m.userId);
                return (
                  <li key={m.userId}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-secondary/60">
                      <input type="checkbox" checked={checked} onChange={() => toggle(m.userId)} />
                      <Avatar src={safeAvatar(m.avatarUrl)} name={m.name} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{m.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{picked.size} selected</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>Save holders</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
