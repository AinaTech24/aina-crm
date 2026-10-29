"use client";

/**
 * Super-admin editor for the help centre's tree: categories and the folders in
 * them. Each row saves on its own; deleting a category removes its folders,
 * and articles in them become unfiled (they are never deleted).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Eye, EyeOff, Save } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Cat = { id: string; slug: string; name: string; description: string | null; sortOrder: number; published: boolean };
type Folder = Cat & { categoryId: string; articleCount: number };

const input = "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 110);
}

export function KbStructureManager({ categories, folders }: { categories: Cat[]; folders: Folder[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<{ kind: "category" | "folder"; id: string; name: string } | null>(null);

  async function call(url: string, method: string, body?: unknown, key = "x") {
    setError(null);
    setBusy(key);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const create = (kind: "category" | "folder", v: Record<string, unknown>) =>
    call("/api/super-admin/kb-structure", "POST", { kind, ...v }, `new-${kind}`);
  const save = (kind: "category" | "folder", id: string, v: Record<string, unknown>) =>
    call(`/api/super-admin/kb-structure/${kind}/${id}`, "PATCH", v, id);

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      {categories.map((c) => (
        <div key={c.id} className="rounded-lg border bg-card">
          <Row item={c} kind="category" busy={busy === c.id} onSave={(v) => save("category", c.id, v)} onDelete={() => setDel({ kind: "category", id: c.id, name: c.name })} />
          <div className="border-t bg-secondary/20 px-4 py-3 space-y-2">
            {folders.filter((f) => f.categoryId === c.id).map((f) => (
              <div key={f.id} className="pl-5">
                <Row item={f} kind="folder" busy={busy === f.id} onSave={(v) => save("folder", f.id, v)} onDelete={() => setDel({ kind: "folder", id: f.id, name: f.name })} extra={`${f.articleCount} article${f.articleCount === 1 ? "" : "s"}`} />
              </div>
            ))}
            <div className="pl-5">
              <AddRow label="Add folder" busy={busy === "new-folder"} onAdd={(name, slug) => create("folder", { categoryId: c.id, name, slug })} />
            </div>
          </div>
        </div>
      ))}

      <div className="rounded-lg border border-dashed bg-card p-4">
        <AddRow label="Add category" busy={busy === "new-category"} onAdd={(name, slug) => create("category", { name, slug })} />
      </div>

      <ConfirmDialog
        open={!!del}
        title={del?.kind === "category" ? `Delete category “${del?.name}”?` : `Delete folder “${del?.name}”?`}
        message={
          del?.kind === "category"
            ? "Its folders are removed too. Articles are NOT deleted — they become unfiled and disappear from the public tree until you move them to a folder."
            : "Articles in it are NOT deleted — they become unfiled and disappear from the public tree until you move them to a folder."
        }
        confirmLabel="Delete"
        cancelLabel="Keep it"
        tone="danger"
        busy={!!busy && busy === del?.id}
        onConfirm={async () => {
          if (!del) return;
          await call(`/api/super-admin/kb-structure/${del.kind}/${del.id}`, "DELETE", undefined, del.id);
          setDel(null);
        }}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}

function Row({
  item, kind, busy, onSave, onDelete, extra,
}: {
  item: Cat; kind: "category" | "folder"; busy: boolean; extra?: string;
  onSave: (v: Record<string, unknown>) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [slug, setSlug] = useState(item.slug);
  const [description, setDescription] = useState(item.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  const [published, setPublished] = useState(item.published);
  const dirty =
    name !== item.name || slug !== item.slug || description !== (item.description ?? "") ||
    sortOrder !== String(item.sortOrder) || published !== item.published;

  return (
    <div className={kind === "category" ? "p-4 space-y-2" : "space-y-2 rounded-md border bg-card p-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} flex-1 min-w-[12rem] ${kind === "category" ? "font-semibold" : ""}`} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <input className={`${input} w-44`} value={slug} onChange={(e) => setSlug(slugify(e.target.value))} aria-label="URL slug" />
        <input className={`${input} w-16`} type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} aria-label="Order" title="Order — lowest first" />
        <button type="button" onClick={() => setPublished((p) => !p)} className="text-muted-foreground hover:text-foreground" title={published ? "Visible — click to hide" : "Hidden — click to show"}>
          {published ? <Eye className="size-4 text-emerald-600" /> : <EyeOff className="size-4" />}
        </button>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => onSave({ name: name.trim(), slug, description: description.trim() || null, sortOrder: parseInt(sortOrder, 10) || 0, published })}
          className="rounded-md bg-primary text-primary-foreground px-2.5 py-1.5 text-sm inline-flex items-center gap-1 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
        </button>
        <button type="button" onClick={onDelete} className="text-muted-foreground hover:text-rose-600" aria-label="Delete">
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description (optional)" aria-label="Description" />
        {extra && <span className="text-xs text-muted-foreground whitespace-nowrap">{extra}</span>}
      </div>
    </div>
  );
}

function AddRow({ label, busy, onAdd }: { label: string; busy: boolean; onAdd: (name: string, slug: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const slug = slugify(name);
  return (
    <div className="flex items-center gap-2">
      <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${label} — name`} aria-label={label} />
      <span className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap">/{slug || "…"}</span>
      <button
        type="button"
        disabled={busy || name.trim().length < 2 || slug.length < 2}
        onClick={async () => { if (await onAdd(name.trim(), slug)) setName(""); }}
        className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1 whitespace-nowrap hover:bg-accent disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {label}
      </button>
    </div>
  );
}
