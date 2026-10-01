"use client";

/**
 * A meeting's Attachments card: uploaded files and pasted links in one list.
 *
 * A file is stored the moment it is uploaded (POST /api/review-meetings/[id]/
 * files) and removed the moment its bin is clicked; links are edited here and
 * saved with the rest of the meeting. Files carry a `fileId` — the editor's
 * Save keeps any entry with one, so saving the meeting never drops a file.
 * Downloads go through the secure DownloadButton (no /api/ route in an href).
 */

import { useRef, useState } from "react";
import { Download, FileText, Link2, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import { useToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";

export type MeetingAttachment = { name: string; url: string; fileId?: string; size?: number; uploadedAt?: string };

const MAX_MB = 25;

function sizeText(n?: number) {
  if (!n) return null;
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function MeetingAttachments({
  meetingId,
  items,
  onChange,
}: {
  meetingId: string;
  items: MeetingAttachment[];
  onChange: (next: MeetingAttachment[]) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let next = items;
    try {
      for (const f of Array.from(files)) {
        if (f.size > MAX_MB * 1024 * 1024) {
          toast.error(`${f.name} is larger than ${MAX_MB} MB`, "Not uploaded");
          continue;
        }
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch(`/api/review-meetings/${meetingId}/files`, { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(j.error ?? `Couldn't upload ${f.name}`, "Not uploaded");
          continue;
        }
        next = [...next, j.attachment as MeetingAttachment];
        onChange(next);
      }
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function removeFile(fileId: string) {
    setRemoving(fileId);
    try {
      const res = await fetch(`/api/review-meetings/${meetingId}/files/${fileId}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't remove the file");
      onChange(items.filter((a) => a.fileId !== fileId));
      toast.success("File removed");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove the file", "Not removed");
    } finally {
      setRemoving(null);
    }
  }

  const patchLink = (i: number, k: "name" | "url", v: string) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  return (
    <div className="card-surface p-5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Attachments ({items.length})</h3>
        <div className="flex items-center gap-1">
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => upload(e.target.files)}
            aria-label="Upload files to this meeting"
          />
          <button type="button" onClick={() => input.current?.click()} disabled={uploading} className={buttonClass("ghost", "sm", "gap-1")}>
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} {uploading ? "Uploading…" : "Upload file"}
          </button>
          <button type="button" onClick={() => onChange([...items, { name: "", url: "" }])} className={buttonClass("ghost", "sm", "gap-1")}>
            <Plus className="size-3.5" /> Add link
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">
          Upload a presentation, report or signed document (up to {MAX_MB} MB each), or paste a link to one.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((a, i) =>
            a.fileId ? (
              <li key={a.fileId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  {sizeText(a.size) && <div className="text-2xs text-muted-foreground">{sizeText(a.size)}</div>}
                </div>
                <DownloadButton
                  url={`/api/review-meetings/${meetingId}/files/${a.fileId}`}
                  filename={a.name}
                  className={buttonClass("ghost", "icon")}
                  title="Download"
                  ariaLabel={`Download ${a.name}`}
                >
                  <Download className="size-3.5" />
                </DownloadButton>
                <button
                  type="button"
                  onClick={() => removeFile(a.fileId!)}
                  disabled={removing === a.fileId}
                  className={buttonClass("ghost", "icon", "hover:text-rose-600")}
                  aria-label={`Remove ${a.name}`}
                  title="Remove file"
                >
                  {removing === a.fileId ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </button>
              </li>
            ) : (
              <li key={`link-${i}`} className="flex items-center gap-2">
                <Link2 className="size-4 shrink-0 text-muted-foreground" />
                <input
                  value={a.name}
                  onChange={(e) => patchLink(i, "name", e.target.value)}
                  placeholder="Display name"
                  className="input-base w-1/3"
                />
                <input
                  value={a.url}
                  onChange={(e) => patchLink(i, "url", e.target.value)}
                  placeholder="https://…"
                  className="input-base flex-1"
                />
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                  className={buttonClass("ghost", "icon", "hover:text-rose-600")}
                  aria-label="Remove link"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
