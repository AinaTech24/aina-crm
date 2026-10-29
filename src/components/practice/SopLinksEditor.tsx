"use client";

/**
 * "Where this applies" — the places an SOP is attached to (sop_links), with
 * remove buttons and an Add control for people who may manage the manual.
 * The server page computes every label and option; this only posts to
 * /api/sop-links and refreshes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { notify } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { InlineEmpty } from "@/components/common/EmptyState";

export type SopLinkRow = { id: string; kind: string; key: string; label: string };
export type SopLinkKindOptions = { kind: string; label: string; options: Array<{ key: string; label: string }> };

export function SopLinksEditor({
  sopId,
  links,
  kinds,
  canManage,
}: {
  sopId: string;
  links: SopLinkRow[];
  kinds: SopLinkKindOptions[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState(kinds[0]?.kind ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const linked = new Set(links.map((l) => `${l.kind}\u0000${l.key}`));
  const options = (kinds.find((k) => k.kind === kind)?.options ?? []).filter((o) => !linked.has(`${kind}\u0000${o.key}`));

  async function add() {
    if (!kind || !key) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sop-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sopId, targetKind: kind, targetKey: key }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        notify.error(j.error ?? "Could not add the link.");
        return;
      }
      setKey("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(link: SopLinkRow) {
    const ok = await confirmDialog({
      title: "Remove this link?",
      message: `${link.label} will no longer show this SOP.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setRemoving(link.id);
    try {
      const res = await fetch(`/api/sop-links?id=${encodeURIComponent(link.id)}`, { method: "DELETE" });
      if (!res.ok) {
        notify.error("Could not remove the link.");
        return;
      }
      router.refresh();
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-3">
      {links.length === 0 ? (
        <InlineEmpty message="This SOP is not attached to any work yet, so it shows only in the library." />
      ) : (
        <ul className="divide-y divide-border">
          {links.map((l) => (
            <li key={l.id} className="flex min-h-10 items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0">{l.label}</span>
              {canManage && (
                <button
                  type="button"
                  className="btn-icon shrink-0"
                  onClick={() => remove(l)}
                  disabled={removing === l.id}
                  aria-label={`Remove ${l.label}`}
                  title="Remove"
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
            Attach to
            <SelectField
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setKey("");
              }}
              className="w-44"
            >
              {kinds.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Which
            <SelectField value={key} onChange={(e) => setKey(e.target.value)} className="w-full">
              <option value="">{options.length ? "Choose…" : "Nothing left to attach"}</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </SelectField>
          </label>
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={add} loading={busy} disabled={!key || busy}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
