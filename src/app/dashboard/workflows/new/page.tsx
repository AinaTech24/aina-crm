"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function NewWorkflowPage() {
  const router = useRouter();
  const [name, setName] = useState("New workflow");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("custom");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const seedGraph = {
        startNodeId: "trigger",
        nodes: [
          { id: "trigger", type: "trigger", config: { kind: "manual" } },
          { id: "end", type: "end", config: {} },
        ],
        edges: [{ id: "e1", source: "trigger", target: "end" }],
      };
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, category, graph: seedGraph }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push(`/dashboard/workflows/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link
        href="/dashboard/workflows"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to workflows
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">New workflow</h1>
      <p className="text-sm text-muted-foreground">
        Pick a name + category. You'll lay out triggers and actions in the editor.
      </p>

      <div className="border rounded-lg bg-card p-5 space-y-4">
        <label className="block">
          <div className="text-xs font-medium mb-1">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Description</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Category</div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="operations">Operations</option>
            <option value="compliance">Compliance</option>
            <option value="retention">Retention</option>
            <option value="marketing">Marketing</option>
            <option value="service">Service</option>
            <option value="onboarding">Onboarding</option>
            <option value="internal">Internal</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/workflows" className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </Link>
          <button
            onClick={create}
            disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create + open editor"}
          </button>
        </div>
      </div>
    </div>
  );
}
