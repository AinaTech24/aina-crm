"use client";

/**
 * Author / edit a help-centre article. Everything is public.
 *
 * The instructions are Markdown with a small toolbar; uploading a screenshot
 * drops `![caption](shot:N)` into the text at the cursor, so the image appears
 * exactly where the step is. Screenshots not placed in the text show after it.
 * The KAIZEN "situation / questions" fields are optional and only for stories.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Loader2, Upload, Eye, Bold, Heading2, ListOrdered, List, Link2, ImagePlus } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { KbMarkdown } from "@/components/kb/KbMarkdown";
import type { KbFolderOption } from "@/lib/kb/admin";

export type KbShot = { storageKey: string; caption?: string | null; alt?: string | null };

export type KbInitial = {
  id: string;
  folderId: string | null;
  series: string;
  episodeNo: number | null;
  slug: string;
  title: string;
  hook: string | null;
  scenarioMd: string;
  questions: string[];
  solutionMd: string;
  screenshots: KbShot[];
  modules: string[];
  readMinutes: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
  sortOrder: number;
};

const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 110);
}

export function KbArticleForm({ initial, folders }: { initial?: KbInitial; folders: KbFolderOption[] }) {
  const router = useRouter();
  const editing = !!initial;

  const [folderId, setFolderId] = useState(initial?.folderId ?? "");
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [series, setSeries] = useState(initial?.series ?? "Guide");
  const [episodeNo, setEpisodeNo] = useState(initial?.episodeNo?.toString() ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugLocked, setSlugLocked] = useState(!!initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hook, setHook] = useState(initial?.hook ?? "");
  const [scenarioMd, setScenarioMd] = useState(initial?.scenarioMd ?? "");
  const [questions, setQuestions] = useState<string[]>(initial?.questions?.length ? initial.questions : [""]);
  const [solutionMd, setSolutionMd] = useState(initial?.solutionMd ?? "");
  const [shots, setShots] = useState<KbShot[]>(initial?.screenshots ?? []);
  const [modules, setModules] = useState<string>((initial?.modules ?? []).join(", "));
  const [readMinutes, setReadMinutes] = useState(initial?.readMinutes?.toString() ?? "");
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? "");
  const [published, setPublished] = useState(initial?.published ?? false);
  const [sortOrder, setSortOrder] = useState((initial?.sortOrder ?? 0).toString());

  const [saving, setSaving] = useState(false);
  const shotCount = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onTitle(v: string) {
    setTitle(v);
    if (!slugLocked) setSlug(slugify(v));
  }

  /** Wrap the selection (or insert) in the instructions box. */
  function edit(fn: (sel: string) => string) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? solutionMd.length;
    const end = el?.selectionEnd ?? solutionMd.length;
    const next = solutionMd.slice(0, start) + fn(solutionMd.slice(start, end)) + solutionMd.slice(end);
    setSolutionMd(next);
    requestAnimationFrame(() => el?.focus());
  }
  const insertShot = (n: number, caption = "") => edit(() => `\n\n![${caption}](shot:${n})\n\n`);

  async function uploadShots(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setError(null);
    shotCount.current = shots.length;
    // Several files at once: place each in turn from the cursor, not over each other.
    let at = bodyRef.current?.selectionStart ?? solutionMd.length;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setError(`${file.name} is over 10 MB`);
          continue;
        }
        const pres = await fetch("/api/content-library/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type || "image/png" }),
        }).then((r) => r.json());
        if (!pres?.url || !pres?.key) {
          setError(pres?.error ?? "Could not get an upload URL");
          continue;
        }
        const put = await fetch(pres.url, {
          method: "PUT",
          headers: { "content-type": file.type || "image/png" },
          body: file,
        });
        if (!put.ok) {
          setError(`Upload failed for ${file.name}`);
          continue;
        }
        const n = shotCount.current + 1;
        shotCount.current = n;
        setShots((s) => [...s, { storageKey: pres.key, caption: "", alt: "" }]);
        const chunk = `\n\n![](shot:${n})\n\n`;
        const pos = at;
        setSolutionMd((prev) => prev.slice(0, Math.min(pos, prev.length)) + chunk + prev.slice(Math.min(pos, prev.length)));
        at += chunk.length;
      }
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setError(null);
    if (!title.trim()) return setError("Title is required.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return setError("Slug must be lowercase words separated by single hyphens (e.g. sip-bounce-recovery).");
    }
    setSaving(true);
    const body = {
      folderId: folderId || null,
      series: series.trim() || "Guide",
      episodeNo: episodeNo.trim() === "" ? null : parseInt(episodeNo, 10),
      slug,
      title: title.trim(),
      hook: hook.trim() || null,
      scenarioMd,
      questions: questions.map((q) => q.trim()).filter(Boolean),
      solutionMd,
      screenshots: shots.map((s) => ({
        storageKey: s.storageKey,
        caption: (s.caption ?? "").trim() || null,
        alt: (s.alt ?? "").trim() || null,
      })),
      modules: modules.split(",").map((m) => m.trim()).filter(Boolean),
      readMinutes: readMinutes.trim() === "" ? null : parseInt(readMinutes, 10),
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
      published,
      sortOrder: Number.isFinite(parseInt(sortOrder, 10)) ? parseInt(sortOrder, 10) : 0,
    };
    try {
      const res = await fetch(editing ? `/api/super-admin/kb-articles/${initial!.id}` : "/api/super-admin/kb-articles", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      router.push("/super-admin/kb-articles");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
      setSaving(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/super-admin/kb-articles/${initial!.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.push("/super-admin/kb-articles");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed.");
      setDeleting(false);
      setConfirmDel(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/super-admin/kb-articles" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="page-title">{editing ? "Edit article" : "New article"}</h1>
            <p className="text-muted-foreground text-sm">
              A step-by-step guide with screenshots, shown on the public Knowledge Base.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing && published && (
            <Link href={`/knowledge-base/${initial!.slug}`} target="_blank" className="rounded-md border px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-accent">
              <Eye className="size-4" /> View live
            </Link>
          )}
          {editing && (
            <button type="button" onClick={() => setConfirmDel(true)} className="rounded-md border border-rose-200 text-rose-600 px-3 py-1.5 text-sm inline-flex items-center gap-1.5 hover:bg-rose-50">
              <Trash2 className="size-4" /> Delete
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      {/* Where it lives + what it is called */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <L
          label="Folder"
          hint={folders.length === 0 ? "No folders yet — create a category and a folder first." : "Where it appears on the Knowledge Base. Unfiled articles are reachable only by search or direct link."}
        >
          <div className="flex gap-2">
            <select className={input} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Unfiled</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <Link href="/super-admin/kb-articles/structure" target="_blank" className="rounded-md border px-3 text-xs whitespace-nowrap inline-flex items-center hover:bg-accent">
              Manage folders
            </Link>
          </div>
        </L>
        <L label="Title" required>
          <input className={input} value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Merging Duplicate Clients" />
        </L>
        <L label="URL slug" required hint={`crm.ainatech.in/knowledge-base/${slug || "…"}`}>
          <div className="flex gap-2">
            <input className={input} value={slug} onChange={(e) => { setSlug(slugify(e.target.value)); setSlugLocked(true); }} />
            {!editing && (
              <button type="button" onClick={() => { setSlug(slugify(title)); setSlugLocked(false); }} className="rounded-md border px-3 text-xs whitespace-nowrap hover:bg-accent">
                From title
              </button>
            )}
          </div>
        </L>
        <L label="Introduction" hint="One or two lines at the top of the article and under it in search results.">
          <textarea className={input} rows={2} value={hook} onChange={(e) => setHook(e.target.value)} />
        </L>
      </div>

      {/* The instructions */}
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">Instructions</span>
          <div className="flex items-center gap-1">
            <Tool label="Heading" onClick={() => edit((s) => `\n\n## ${s || "Heading"}\n\n`)}><Heading2 className="size-4" /></Tool>
            <Tool label="Bold" onClick={() => edit((s) => `**${s || "bold text"}**`)}><Bold className="size-4" /></Tool>
            <Tool label="Numbered step" onClick={() => edit((s) => `\n1. ${s || "Step"}\n`)}><ListOrdered className="size-4" /></Tool>
            <Tool label="Bullet" onClick={() => edit((s) => `\n- ${s || "Point"}\n`)}><List className="size-4" /></Tool>
            <Tool label="Link" onClick={() => edit((s) => `[${s || "link text"}](/dashboard/…)`)}><Link2 className="size-4" /></Tool>
            <label className={`ml-2 rounded-md border px-2.5 py-1.5 text-sm inline-flex items-center gap-1.5 cursor-pointer hover:bg-accent ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Add screenshots
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { uploadShots(e.target.files); e.target.value = ""; }} />
            </label>
            <button type="button" onClick={() => setPreview((p) => !p)} className={`rounded-md border px-2.5 py-1.5 text-sm ${preview ? "bg-accent" : "hover:bg-accent"}`}>
              {preview ? "Edit" : "Preview"}
            </button>
          </div>
        </div>
        {preview ? (
          <div className="rounded-md border bg-background p-5 min-h-[18rem]">
            <KbMarkdown text={solutionMd} articleId={initial?.id ?? "preview"} shots={shots} preview />
          </div>
        ) : (
          <textarea
            ref={bodyRef}
            className={`${input} font-mono`}
            rows={20}
            value={solutionMd}
            onChange={(e) => setSolutionMd(e.target.value)}
            placeholder={"## Introduction\n\nWhat this does and when you need it.\n\n**Path:** Dashboard > Clients\n\n1. Open the Clients page.\n2. Select the clients you want to merge.\n\n![Select the clients](shot:1)"}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Screenshots are placed where the cursor is when you upload them, as <code>![caption](shot:1)</code>. Move that line to move the image; put your words in the brackets for a caption.
        </p>

        {shots.length > 0 && (
          <div className="space-y-2">
            {shots.map((s, i) => (
              <div key={s.storageKey} className="rounded-md border bg-background p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    Screenshot {i + 1} · {s.storageKey.split("/").pop()}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button type="button" onClick={() => { setPreview(false); insertShot(i + 1); }} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                      <ImagePlus className="size-4" /> Insert at cursor
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // Removing one renumbers the rest, so take its line out and shift the later ones down.
                        setShots((x) => x.filter((_, idx) => idx !== i));
                        setSolutionMd((t) =>
                          t
                            .replace(new RegExp(`\\n*!\\[[^\\]]*\\]\\(shot:${i + 1}\\)\\n*`, "g"), "\n\n")
                            .replace(/\(shot:(\d+)\)/g, (m, d) => (Number(d) > i + 1 ? `(shot:${Number(d) - 1})` : m))
                        );
                      }}
                      className="text-muted-foreground hover:text-rose-600"
                      aria-label="Remove screenshot"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={input} value={s.caption ?? ""} placeholder="Caption (used when the text gives none)"
                    onChange={(e) => setShots((x) => x.map((y, idx) => (idx === i ? { ...y, caption: e.target.value } : y)))} />
                  <input className={input} value={s.alt ?? ""} placeholder="Alt text (accessibility)"
                    onChange={(e) => setShots((x) => x.map((y, idx) => (idx === i ? { ...y, alt: e.target.value } : y)))} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Optional KAIZEN story */}
      <details className="rounded-lg border bg-card p-5" open={!!(scenarioMd.trim() || questions.some((q) => q.trim()))}>
        <summary className="cursor-pointer text-sm font-semibold">KAIZEN story (optional)</summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <L label="Series"><input className={input} value={series} onChange={(e) => setSeries(e.target.value)} /></L>
            <L label="Episode #" hint="KAIZEN #1, #2 …"><input className={input} type="number" value={episodeNo} onChange={(e) => setEpisodeNo(e.target.value)} /></L>
            <L label="Read time (min)"><input className={input} type="number" value={readMinutes} onChange={(e) => setReadMinutes(e.target.value)} /></L>
          </div>
          <L label="The situation" hint="Shown above the instructions. Same Markdown as the instructions.">
            <textarea className={input} rows={7} value={scenarioMd} onChange={(e) => setScenarioMd(e.target.value)} placeholder={"It's the 12th. A client's SIP debit failed on the 5th…"} />
          </L>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium">The questions this raises</span>
              <button type="button" onClick={() => setQuestions((q) => [...q, ""])} className="text-sm text-primary inline-flex items-center gap-1 hover:underline">
                <Plus className="size-4" /> Add question
              </button>
            </div>
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={input} value={q} onChange={(e) => setQuestions((qs) => qs.map((x, idx) => (idx === i ? e.target.value : x)))} />
                  <button type="button" onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-rose-600 shrink-0" aria-label="Remove question">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>

      {/* SEO + publish */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="text-sm font-semibold">Search & publishing</div>
        <div className="grid grid-cols-2 gap-4">
          <L label="SEO title" hint="Blank = uses the article title."><input className={input} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} /></L>
          <L label="Order in folder" hint="Lower shows first."><input className={input} type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></L>
        </div>
        <L label="SEO description" hint="Blank = uses the hook.">
          <textarea className={input} rows={2} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} />
        </L>
        <button type="button" onClick={() => setPublished((p) => !p)} className="flex items-start gap-3 text-left">
          <span className={`mt-0.5 h-5 w-9 rounded-full transition-colors shrink-0 relative ${published ? "bg-primary" : "bg-input"}`}>
            <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${published ? "left-[1.125rem]" : "left-0.5"}`} />
          </span>
          <span>
            <span className="text-sm font-medium block">Published</span>
            <span className="text-xs text-muted-foreground">Live on the public Knowledge Base. A draft is invisible to visitors.</span>
          </span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60">
          {saving && <Loader2 className="size-4 animate-spin" />}
          {editing ? "Save changes" : "Create article"}
        </button>
        <Link href="/super-admin/kb-articles" className="text-sm text-muted-foreground hover:text-foreground">Cancel</Link>
      </div>

      <ConfirmDialog
        open={confirmDel}
        title="Delete this article?"
        message="It will disappear from the public Knowledge Base immediately. This can't be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Keep it"
        tone="danger"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
      {children}
    </button>
  );
}

function L({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label}{required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
