"use client";

/**
 * A member's relationship, editable in place on the family page. Picking
 * "Self / Head" makes that member the head of the family (the API moves the
 * head role off whoever held it). Read-only for someone who cannot edit the
 * family.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { isHeadRole, roleLabel } from "@/lib/families/roles";
import { useRelationshipOptions } from "./useRelationshipOptions";

export function MemberRoleSelect({
  familyId,
  investorId,
  investorName,
  role,
  isHead,
  canEdit,
}: {
  familyId: string;
  investorId: string;
  investorName: string;
  role: string | null;
  isHead: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const options = useRelationshipOptions({ includeHead: true });
  const current = isHead || isHeadRole(role) ? "self" : role ?? "";
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return <span>{isHead ? "Head of family" : roleLabel(role, options.map(([key, label]) => ({ key, label })))}</span>;
  }

  // A stored role the firm's list no longer has still shows as itself.
  const opts: [string, string][] =
    value && !options.some(([k]) => k === value) ? [[value, roleLabel(value)], ...options] : options;

  async function change(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/families/${familyId}/members`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId, familyRole: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setValue(prev);
        toast.error(j.error ?? "Could not change the relationship.", "Not saved");
        return;
      }
      if (next === "self") toast.success(`${investorName} is now the head of the family`);
      router.refresh();
    } catch {
      setValue(prev);
      toast.error("Could not reach the server. Try again.", "Not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <ThemeSelect
        value={value}
        onChange={change}
        disabled={busy}
        aria-label={`Relationship of ${investorName}`}
        options={value ? opts : [["", "Not set"], ...opts]}
        wrapperClassName="min-w-36"
        className="h-8 py-0 text-xs"
      />
      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
    </span>
  );
}
