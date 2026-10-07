"use client";

/**
 * New family. Picking the head fills the name (the firm's pattern, the same
 * rule the server saves with), and the family takes its RM, branch, category
 * and review schedule from that client — the form no longer asks for them,
 * nor for a family code, which is created automatically (the firm's request,
 * 2026-10-02; see lib/families/from-head and lib/families/code).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FamilyHeadPicker, type HeadCandidate } from "@/components/families/FamilyHeadPicker";
import { buttonClass } from "@/components/ui/button-class";
import { familyNameForHead } from "@/lib/families/naming";

export function NewFamilyForm({
  initialHead,
  namePattern,
}: {
  /** From `?investorId=` — the client the family is being started for. */
  initialHead: HeadCandidate | null;
  namePattern: string;
}) {
  const router = useRouter();
  const [head, setHead] = useState<HeadCandidate | null>(initialHead);
  const [name, setName] = useState(initialHead ? familyNameForHead(initialHead.name, namePattern) : "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** True once the user edits the name themselves — after that we never
   *  overwrite it, so a household named by organisation ("Sharma Trust") is not
   *  dragged back to "<person> Family" when the head is picked or changed. */
  const [nameTouched, setNameTouched] = useState(false);

  function pickHead(c: HeadCandidate | null) {
    setHead(c);
    if (c && !nameTouched) setName(familyNameForHead(c.name, namePattern));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const familyName = name.trim();
    if (!familyName) {
      setErr("Family name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // The name field IS the family's name: send it as such, so the firm's
      // naming pattern does not wrap it again.
      const payload: Record<string, unknown> = { headName: head?.name ?? familyName, familyName };
      // Link the head so the household starts attached to a real client instead
      // of being a name with members bolted on later.
      if (head) payload.primaryInvestorId = head.id;
      if (notes.trim()) payload.notes = notes.trim();

      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A raw "forbidden: missing family.create" tells the user nothing they
        // can act on — name the setting an owner has to switch on, and where.
        if (res.status === 403) {
          setErr(
            "You don’t have permission to create households. Ask your firm admin to enable “Create households” for you under Team → your profile → Customize Access Permissions."
          );
        } else if (res.status === 401) {
          setErr("Your session has expired. Please sign in again.");
        } else if (Array.isArray(j?.issues) && j.issues.length) {
          const fields = j.issues
            .map((i: any) => (Array.isArray(i?.path) ? i.path.join(".") : ""))
            .filter(Boolean)
            .join(", ");
          setErr(fields ? `Please check: ${fields}` : (j.error ?? "Create failed"));
        } else {
          setErr(j.error ?? `Create failed (HTTP ${res.status})`);
        }
        return;
      }
      // Straight into the new family, where members are added next.
      router.push(j?.id ? `/dashboard/families/${j.id}` : "/dashboard/families");
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-4">
      {/* Head of family first: picking it fills the name below, so the common
          case is one search and a Create click. Optional — a household can
          still be named up front and populated later. */}
      <div>
        <div className="text-xs font-medium mb-1">
          Head of family <span className="text-muted-foreground font-normal">· optional, fills the name below</span>
        </div>
        <FamilyHeadPicker value={head} onPick={pickHead} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Family / organisation name<span className="text-destructive">*</span>
          </div>
          <input
            value={name}
            onChange={(e) => { setNameTouched(true); setName(e.target.value); }}
            required
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <div>
          <div className="text-xs font-medium mb-1">Family code</div>
          <div className="w-full border rounded-md px-3 py-2 text-sm bg-secondary/40 text-muted-foreground">
            Created automatically
          </div>
        </div>
      </div>

      <label className="block">
        <div className="text-xs font-medium mb-1">Notes</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        />
      </label>

      {err && <div role="alert" className="text-sm text-destructive">{err}</div>}
      <div className="flex justify-end gap-2 pt-2 border-t">
        <Link href="/dashboard/families" className={buttonClass("secondary")}>Cancel</Link>
        <button type="submit" disabled={busy || name.trim().length < 2} className={buttonClass("primary")}>
          {busy ? "Creating…" : "Create family"}
        </button>
      </div>
    </form>
  );
}
