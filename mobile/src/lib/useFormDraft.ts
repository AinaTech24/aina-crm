import { useEffect, useRef, useState, type SetStateAction } from "react";
import { getAccountScope } from "./accountScope";
import { bulkGet, bulkSet, bulkDelete } from "./bulkStorage";

// Serialize saves and deletion so a late write cannot resurrect a submitted draft.
const pending = new Map<string, Promise<unknown>>();
function serial<T>(key: string, work: () => Promise<T>) {
  const job = (pending.get(key) ?? Promise.resolve()).then(work, work);
  pending.set(key, job);
  void job.finally(() => { if (pending.get(key) === job) pending.delete(key); }).catch(() => {});
  return job;
}
export function useFormDraft<T extends Record<string, unknown>>(name: string, initial: () => T, enabled: boolean) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(!enabled);
  const [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const scope = useRef(getAccountScope()).current;
  const key = `form_draft_v1.${scope.owner}.${name}`;
  const active = useRef(true), writable = useRef(true), cleared = useRef(false);
  useEffect(() => {
    active.current = true;
    if (enabled && scope.owner) void serial(key, () => bulkGet(key)).then(raw => {
      if (!active.current || getAccountScope().generation !== scope.generation) return;
      if (raw) { const parsed = JSON.parse(raw); if (parsed?.__submitted === true) return; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid draft"); setValue(v => ({ ...v, ...parsed })); setStatus("Draft restored from this phone"); }
    }).catch(() => { writable.current = false; if (active.current) setStatus("Could not restore draft. Existing draft preserved; new edits are not saved on this phone."); }).finally(() => { if (active.current) setReady(true); });
    else setReady(true);
    return () => { active.current = false; };
  }, [key, enabled, scope]);
  useEffect(() => {
    if (!enabled || !ready || !revision || !writable.current || cleared.current || !scope.owner || getAccountScope().generation !== scope.generation) return;
    setStatus("Saving draft on this phone…");
    void serial(key, () => bulkSet(key, JSON.stringify(value))).then(() => { if (active.current && !cleared.current) setStatus("Draft saved on this phone · Not submitted"); }).catch(() => { if (active.current) setStatus("Draft could not be saved. Keep this screen open and try again."); });
  }, [value, revision, ready, enabled, key, scope]);
  const update = (next: SetStateAction<T>) => { cleared.current = false; setValue(next); setRevision(r => r + 1); };
  const clear = async () => { cleared.current = true; await serial(key, async () => { await bulkSet(key, JSON.stringify({ __submitted: true })); await bulkDelete(key); }); if (active.current) setStatus(""); };
  return { value, setValue: update, ready, status: enabled ? status : "", clear };
}
