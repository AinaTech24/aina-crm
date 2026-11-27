/**
 * Uploading several files to a task in one go (flag `taskAttachmentsMulti`):
 * the New task form after the task is created, and the task's Attachments
 * panel. Each file is its own POST /api/tasks/[id]/attachments — three at a
 * time — so one bad file never loses the others. Browser-only.
 */

/** The attachments route's own limit. */
export const TASK_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** How many files one pick may add. */
export const TASK_FILES_MAX = 20;

export const TASK_ATTACHMENTS_FLAG = "taskAttachmentsMulti";

export type UploadResult = { uploaded: Array<{ file: File; attachment: unknown }>; failed: Array<{ file: File; error: string }> };

export async function uploadTaskFiles(taskId: string, files: File[], concurrency = 3): Promise<UploadResult> {
  const out: UploadResult = { uploaded: [], failed: [] };
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      if (file.size > TASK_FILE_MAX_BYTES) {
        out.failed.push({ file, error: "larger than 25 MB" });
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) out.failed.push({ file, error: typeof j?.error === "string" ? j.error : `upload failed (${res.status})` });
        else out.uploaded.push({ file, attachment: j.attachment });
      } catch {
        out.failed.push({ file, error: "network error" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return out;
}

/** Add picked files to a list: no duplicates (same name, size and date), at most TASK_FILES_MAX. */
export function addFiles(current: File[], picked: File[]): { files: File[]; skipped: string[] } {
  const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
  const seen = new Set(current.map(key));
  const files = [...current];
  const skipped: string[] = [];
  for (const f of picked) {
    if (seen.has(key(f))) continue;
    if (f.size > TASK_FILE_MAX_BYTES) { skipped.push(`${f.name} (over 25 MB)`); continue; }
    if (files.length >= TASK_FILES_MAX) { skipped.push(`${f.name} (${TASK_FILES_MAX} files at most)`); continue; }
    seen.add(key(f));
    files.push(f);
  }
  return { files, skipped };
}

export function fileSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
