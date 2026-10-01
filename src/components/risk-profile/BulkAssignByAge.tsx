"use client";

/**
 * Bulk provisional risk profiling, in three steps the user can stop at any time:
 *
 *   1. Bands   — edit the age → category ladder (defaults shown; editable, and
 *                optionally saved as the firm's own).
 *   2. Preview — how many clients each band would label, who is skipped and
 *                why. Nothing is written until "Assign".
 *   3. Notify  — email exactly the clients just labelled, with their personal
 *                confirm-or-change link.
 *
 * The wording throughout says "suggested" rather than "profiled", because that
 * is what a category derived from age actually is.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2, X, ChevronRight, Mail, AlertTriangle, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { CATEGORY_LABEL, type AgeBand } from "@/lib/risk-profile/age-bands";
import { RISK_CATEGORIES } from "@/lib/risk-profile/apply";

type Preview = {
  counts: { active: number; assign: number; no_dob: number; already_profiled: number; unchanged: number };
  byCategory: Record<string, number>;
  capped: boolean;
  limit: number;
  sample: Array<{ name: string; age: number | null; next: string | null }>;
  noDobSample: string[];
};

const CATEGORY_OPTS = RISK_CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]] as [string, string]);

export function BulkAssignByAge({ initialBands }: { initialBands: AgeBand[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [bands, setBands] = useState<AgeBand[]>(initialBands);
  const [saveBands, setSaveBands] = useState(true);
  const [refreshProvisional, setRefreshProvisional] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [assigned, setAssigned] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "assign" | "notify">(null);
  const [err, setErr] = useState<string | null>(null);
  /** Clients done so far while Assign works through a large book in batches. */
  const [progress, setProgress] = useState<number | null>(null);

  function reset() {
    setPreview(null);
    setAssigned(null);
    setErr(null);
  }

  function setBand(i: number, patch: Partial<AgeBand>) {
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
    reset();
  }

  async function call(body: Record<string, unknown>) {
    const res = await fetch("/api/risk-profiles/bulk-assign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error ?? `Request failed (${res.status})`);
    return j;
  }

  async function doPreview() {
    setBusy("preview");
    setErr(null);
    try {
      const j = await call({ dryRun: true, bands, refreshProvisional });
      setPreview(j);
      setAssigned(null);
    } catch (e: any) {
      setErr(e?.message ?? "Could not build the preview");
    } finally {
      setBusy(null);
    }
  }

  async function doAssign() {
    setBusy("assign");
    setErr(null);
    // The route applies at most 500 per call. A large book used to need the
    // button pressed again for every 500; carry on until nothing is left.
    // Safe to repeat: a client already at the ladder's category is skipped, so
    // each round only sees what the last one did not reach.
    const all: string[] = [];
    try {
      let remaining = 0;
      for (let round = 0; round < 100; round++) {
        const j = await call({ bands, refreshProvisional, saveBands: saveBands && round === 0 });
        all.push(...(j.assigned ?? []));
        remaining = j.remaining ?? 0;
        setAssigned([...all]);
        if (!remaining || !j.assignedCount) break;
        setProgress(all.length);
      }
      toast.success(
        `Suggested a profile for ${all.length} client${all.length === 1 ? "" : "s"}` +
          (remaining ? ` · ${remaining} could not be assigned` : "")
      );
      router.refresh();
    } catch (e: any) {
      const done = all.length ? ` ${all.length} were assigned before it stopped — press Assign again to continue.` : "";
      setErr((e?.message ?? "Assignment failed") + done);
    } finally {
      setProgress(null);
      setBusy(null);
    }
  }

  async function doNotify() {
    if (!assigned?.length) return;
    setBusy("notify");
    setErr(null);
    try {
      // The route sends at most 300 per call, so send in slices of 300 —
      // each slice is a different set of clients, so nobody is emailed twice.
      const j = { sent: 0, skipped: 0, noEmail: 0, failed: [] as unknown[] };
      for (let i = 0; i < assigned.length; i += 300) {
        const res = await fetch("/api/risk-profiles/bulk-notify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ investorIds: assigned.slice(i, i + 300) }),
        });
        const r = await res.json().catch(() => ({}));
        if (!res.ok || r.error) {
          const done = j.sent ? ` (${j.sent} already sent)` : "";
          throw new Error((r.error ?? `Send failed (${res.status})`) + done);
        }
        j.sent += r.sent ?? 0;
        j.skipped += r.skipped ?? 0;
        j.noEmail += r.noEmail ?? 0;
        j.failed.push(...(r.failed ?? []));
      }
      const bits = [`${j.sent} email${j.sent === 1 ? "" : "s"} sent`];
      if (j.skipped) bits.push(`${j.skipped} skipped (consent / compliance)`);
      if (j.noEmail) bits.push(`${j.noEmail} have no email`);
      if (j.failed?.length) bits.push(`${j.failed.length} failed`);
      toast.success(bits.join(" · "));
      setOpen(false);
      reset();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Could not send the emails");
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary inline-flex items-center gap-1.5">
        <Wand2 className="size-4" /> Bulk assign by age
      </button>
    );
  }

  const from = (i: number) => (i === 0 ? 18 : (bands[i - 1].upTo ?? 0) + 1);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-semibold">Suggest risk profiles from age</h2>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">
              Age stands in for investment horizon, not for risk appetite — so these are saved as{" "}
              <strong>suggestions</strong>, marked provisional, and replaced the moment the client answers their own
              questionnaire.
            </p>
          </div>
          <button type="button" onClick={() => { setOpen(false); reset(); }} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* 1 — bands */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Age bands</div>
            <div className="mt-2 space-y-1.5">
              {bands.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-16 tabular-nums text-muted-foreground">{from(i)}</span>
                  <span className="text-muted-foreground">to</span>
                  {b.upTo === null ? (
                    <span className="w-20 text-muted-foreground italic">and above</span>
                  ) : (
                    <input
                      type="number"
                      min={from(i)}
                      max={120}
                      value={b.upTo}
                      onChange={(e) => setBand(i, { upTo: Number(e.target.value) || 0 })}
                      className="input-base h-8 w-20 text-sm tabular-nums"
                      aria-label={`Upper age for band ${i + 1}`}
                    />
                  )}
                  <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                  <ThemeSelect
                    value={b.category}
                    onChange={(v) => setBand(i, { category: v as AgeBand["category"] })}
                    options={CATEGORY_OPTS}
                    wrapperClassName="flex-1 min-w-0"
                    className="text-sm py-1"
                  />
                </div>
              ))}
            </div>
            <label className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={refreshProvisional} onChange={(e) => { setRefreshProvisional(e.target.checked); reset(); }} className="size-3.5" />
              Also re-derive clients who already have a suggested profile
            </label>
          </div>

          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 mt-0.5 shrink-0" /> {err}
            </div>
          )}

          {/* 2 — preview */}
          {preview && !assigned && (
            <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2 text-xs">
              <div className="font-semibold text-sm text-foreground">
                {preview.counts.assign} of {preview.counts.active} clients would get a suggested profile
              </div>
              {preview.counts.assign > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(preview.byCategory).map(([cat, n]) => (
                    <span key={cat} className="chip bg-card border border-border">
                      {CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat}: <strong className="ml-1">{n}</strong>
                    </span>
                  ))}
                </div>
              )}
              <ul className="space-y-0.5 text-muted-foreground">
                {preview.counts.already_profiled > 0 && (
                  <li>· {preview.counts.already_profiled} already answered their own questionnaire — left untouched</li>
                )}
                {preview.counts.no_dob > 0 && (
                  <li>
                    · {preview.counts.no_dob} have no date of birth — skipped
                    {preview.noDobSample.length > 0 && <span className="opacity-70"> ({preview.noDobSample.slice(0, 3).join(", ")}{preview.counts.no_dob > 3 ? "…" : ""})</span>}
                  </li>
                )}
                {preview.counts.unchanged > 0 && <li>· {preview.counts.unchanged} already carry this category — nothing to change</li>}
              </ul>
              {preview.sample.length > 0 && (
                <div className="pt-1 border-t border-border/60 text-muted-foreground">
                  e.g. {preview.sample.slice(0, 3).map((s) => `${s.name} (${s.age ?? "?"}) → ${CATEGORY_LABEL[s.next as keyof typeof CATEGORY_LABEL] ?? s.next}`).join(" · ")}
                </div>
              )}
              {preview.capped && <div className="text-amber-700">Only the first {preview.limit} are written per run — run it again for the rest.</div>}
            </div>
          )}

          {/* 3 — notify */}
          {assigned && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-2">
              <div className="font-semibold text-sm inline-flex items-center gap-1.5">
                <Check className="size-4" /> {assigned.length} client{assigned.length === 1 ? "" : "s"} now have a suggested profile
              </div>
              <p>
                Next, email them: each gets their own confirm-or-change link. Clients with no email address are reported
                and skipped.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={() => { setOpen(false); reset(); }} className="btn-secondary text-sm">
            {assigned ? "Done" : "Cancel"}
          </button>
          {!assigned && (
            <>
              <button type="button" onClick={doPreview} disabled={!!busy} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : null} Preview
              </button>
              <button
                type="button"
                onClick={doAssign}
                disabled={!!busy || !preview || preview.counts.assign === 0}
                className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                title={!preview ? "Preview first" : undefined}
              >
                {busy === "assign" ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {busy === "assign" && progress
                  ? `Assigning… ${progress} of ${preview?.counts.assign ?? "?"}`
                  : `Assign ${preview ? preview.counts.assign : ""}`}
              </button>
            </>
          )}
          {assigned && assigned.length > 0 && (
            <button type="button" onClick={doNotify} disabled={!!busy} className="btn-primary text-sm inline-flex items-center gap-1.5">
              {busy === "notify" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Email these clients
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
