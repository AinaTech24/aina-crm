"use client";

/**
 * The New task form's Attachments box (flag `taskAttachmentsMulti`): pick
 * several files at once or drag them in, see them listed, remove any. The
 * form uploads them to the task once it is created (lib/tasks/upload-attachments).
 */

import { useRef, useState } from "react";
import { Paperclip, Upload, X } from "lucide-react";
import { notify } from "@/components/ui/Toast";
import { TASK_FILES_MAX, addFiles, fileSize } from "@/lib/tasks/upload-attachments";

export function TaskFilePicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const add = (picked: FileList | null) => {
    if (!picked?.length) return;
    const { files: next, skipped } = addFiles(files, Array.from(picked));
    onChange(next);
    if (skipped.length) notify.warning(`Not added: ${skipped.join(", ")}`, "Some files skipped");
    if (ref.current) ref.current.value = "";
  };

  return (
    <div>
      <div className="mb-1 text-xs font-medium">
        Attachments <span className="ml-1 text-2xs font-normal text-muted-foreground">· optional, up to {TASK_FILES_MAX} files, 25 MB each</span>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) add(e.dataTransfer.files);
        }}
        className={`flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-xs transition ${
          over ? "border-primary bg-primary/5" : "border-border bg-secondary/30"
        }`}
      >
        <button type="button" className="btn-secondary text-xs" onClick={() => ref.current?.click()} disabled={disabled}>
          <Upload className="size-3.5" /> Choose files
        </button>
        <span className="text-muted-foreground">or drag them here — you can pick several at once</span>
        <input ref={ref} type="file" multiple className="hidden" aria-label="Attach files" onChange={(e) => add(e.target.files)} />
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}|${f.size}|${f.lastModified}`} className="flex items-center gap-2 rounded-md bg-secondary/60 px-2.5 py-1.5">
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-2xs text-muted-foreground">{fileSize(f.size)}</span>
              <button
                type="button"
                className="btn-icon text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${f.name}`}
                title="Remove"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
