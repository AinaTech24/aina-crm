"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function NewFamilyPage() {
  const router = useRouter();
  const [headName, setHeadName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ headName, notes }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push("/dashboard/families");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/dashboard/families" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to families
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New family</h1>
      <p className="text-sm text-muted-foreground">
        After creating, link existing investors to this family from each investor's page.
      </p>
      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">Family head name<span className="text-rose-600">*</span></div>
          <input
            value={headName}
            onChange={(e) => setHeadName(e.target.value)}
            required
            placeholder="e.g. Patel Family"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/families" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || !headName} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Creating…" : "Create family"}
          </button>
        </div>
      </form>
    </div>
  );
}
