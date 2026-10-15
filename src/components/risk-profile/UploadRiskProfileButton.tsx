"use client";

/**
 * "Upload Risk Profile" — record a risk profile the client already holds (done
 * with another distributor, or a signed paper form) instead of making them
 * answer the questionnaire again.
 *
 * Fields: the client, the profile's category and score, when it was assessed,
 * when it expires, and the PDF. The firm's own questionnaire is not involved,
 * so the score is whatever the document says.
 *
 * Picking a client shows what they have now and what this will do to it: it
 * becomes their current profile (the old one stays in the history), a profile
 * older than the current one is filed in the history only, and a minor is sent
 * to their guardian (a minor's profile is the guardian's).
 *
 * Used on the Risk Profiles page (header, and a row action with the client
 * already chosen) and on the client's page.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Upload, X, FileText, AlertTriangle, Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { buttonClass } from "@/components/ui/button-class";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

type Client = { id: string; name: string; pan?: string | null };
type Current = { category: string | null; score: number | null; signedAt: string | null; expiresOn: string | null; provisional: boolean };
type Info = { id: string; name: string; minorOf: string | null; current: Current | null };

const CATEGORIES: Array<[string, string]> = [
  ["", "Select…"],
  ["conservative", "Conservative"],
  ["moderate", "Moderate"],
  ["aggressive", "Aggressive"],
  ["very_aggressive", "Very aggressive"],
];
const label = (c: string | null) => CATEGORIES.find(([k]) => k === c)?.[1] ?? (c ?? "—");
const MAX_MB = 10;

/** A real PAN, masked; an importer's key (NOPAN:…, MINOR:…) is not shown. */
const maskPan = (pan?: string | null) => (pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan.trim()) ? `${pan.slice(0, 2)}•••••${pan.slice(-2)}` : "");

const todayIso = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plusYear = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

export function UploadRiskProfileButton({
  initialClient,
  appearance = "button",
}: {
  /** Open with this client already chosen (a table row, the client's own page). */
  initialClient?: Client;
  appearance?: "button" | "row" | "link";
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const [client, setClient] = useState<Client | null>(initialClient ?? null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);

  const [category, setCategory] = useState("");
  const [score, setScore] = useState("");
  const [assessedOn, setAssessedOn] = useState(todayIso());
  const [expiresOn, setExpiresOn] = useState(plusYear(todayIso()));
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [assessedBy, setAssessedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setClient(initialClient ?? null);
    setSearch(""); setResults([]); setInfo(null);
    setCategory(""); setScore(""); setAssessedOn(todayIso()); setExpiresOn(plusYear(todayIso()));
    setExpiryTouched(false); setAssessedBy(""); setRemarks(""); setFile(null); setErr(null);
  }
  function close() { setOpen(false); reset(); }

  // Find a client as you type.
  useEffect(() => {
    if (!open || client) return;
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/investors?limit=8&q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j) => { if (!cancelled) setResults((j.rows ?? []).map((r: any) => ({ id: r.id, name: r.name, pan: r.pan }))); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, client, search]);

  // What the chosen client has now.
  useEffect(() => {
    if (!open || !client) { setInfo(null); return; }
    let cancelled = false;
    fetch(`/api/risk-profiles/upload?investorId=${client.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setInfo(j); })
      .catch(() => { if (!cancelled) setInfo(null); });
    return () => { cancelled = true; };
  }, [open, client]);

  // Expire On follows Assessed On (a year later) until the person sets it themselves.
  function changeAssessed(v: string) {
    setAssessedOn(v);
    if (!expiryTouched) setExpiresOn(plusYear(v));
  }

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!client) p.push("Choose the client.");
    if (info?.minorOf) p.push(`A minor's risk profile is the guardian's — upload it on ${info.minorOf}'s record.`);
    if (!category) p.push("Choose the risk profile.");
    if (score.trim() === "" || !/^\d+$/.test(score.trim())) p.push("Enter the risk score as a whole number.");
    if (!assessedOn) p.push("Enter the date it was assessed.");
    else if (assessedOn > todayIso()) p.push("The profile cannot have been assessed in the future.");
    if (!expiresOn) p.push("Enter the Expire On date.");
    else if (assessedOn && expiresOn <= assessedOn) p.push("Expire On must be after the assessed date.");
    if (!file) p.push("Attach the risk profile PDF.");
    return p;
  }, [client, info, category, score, assessedOn, expiresOn, file]);

  function pickFile(f: File | null) {
    setErr(null);
    if (!f) { setFile(null); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setErr(`That file is larger than ${MAX_MB} MB.`); return; }
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) { setErr("Only a PDF can be uploaded."); return; }
    setFile(f);
  }

  async function submit() {
    if (problems.length || !client || !file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("investorId", client.id);
      fd.set("category", category);
      fd.set("score", score.trim());
      fd.set("assessedOn", assessedOn);
      fd.set("expiresOn", expiresOn);
      if (assessedBy.trim()) fd.set("assessedBy", assessedBy.trim());
      if (remarks.trim()) fd.set("remarks", remarks.trim());
      const res = await fetch("/api/risk-profiles/upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Upload failed (${res.status})`); return; }
      toast.success(
        j.becameCurrent
          ? `${client.name}'s risk profile is recorded${j.alreadyExpired ? " — it has already expired" : ""}.`
          : `Saved to ${client.name}'s history — a newer profile is already current.`,
        "Risk profile uploaded",
      );
      close();
      router.refresh();
    } catch {
      setErr("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const trigger =
    appearance === "row" ? (
      <button type="button" onClick={() => setOpen(true)} className="btn-icon" title="Upload this client's existing risk profile (PDF)" aria-label="Upload risk profile">
        <Upload className="size-4" />
      </button>
    ) : appearance === "link" ? (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-primary hover:underline">
        Upload risk profile
      </button>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary")}>
        <Upload className="size-4" /> Upload Risk Profile
      </button>
    );

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Risk Profile</DialogTitle>
            <DialogDescription>The client already has a risk profile — record it from its PDF instead of asking again.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            {/* Client */}
            <div>
              <div className="mb-1 text-xs font-medium">Client</div>
              {client ? (
                <div className="flex items-center justify-between rounded-md border bg-secondary/40 px-3 py-2 text-sm">
                  <span className="font-medium">{client.name} <span className="font-mono text-xs text-muted-foreground">{maskPan(client.pan)}</span></span>
                  {!initialClient && (
                    <button type="button" onClick={() => { setClient(null); setInfo(null); }} className="text-muted-foreground hover:text-foreground" aria-label="Choose another client">
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name, PAN, mobile or email…"
                      aria-label="Search clients"
                      className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
                      autoFocus
                    />
                  </div>
                  {(searching || results.length > 0 || search.trim().length >= 2) && (
                    <div className="mt-1 max-h-44 overflow-y-auto rounded-md border">
                      {searching ? (
                        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Searching…</div>
                      ) : results.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground">No client matches that.</div>
                      ) : results.map((r) => (
                        <button key={r.id} type="button" onClick={() => { setClient(r); setSearch(""); setResults([]); }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-secondary/60">
                          <span>{r.name}</span>
                          <span className="font-mono text-2xs text-muted-foreground">{maskPan(r.pan)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* What they have now, and what this does */}
            {info?.minorOf && (
              <div className="flex gap-2 rounded-md border border-warning/50 bg-warning/5 p-3 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>{info.name} is a minor: their risk profile is the guardian's. Upload it on <strong>{info.minorOf}</strong>'s record.</span>
              </div>
            )}
            {info && !info.minorOf && (
              <div className="flex gap-2 rounded-md bg-secondary/60 p-3 text-xs">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                {info.current ? (
                  <span>
                    Now: <strong>{label(info.current.category)}</strong>
                    {info.current.score != null ? ` · score ${info.current.score}` : ""}
                    {info.current.provisional ? " · suggested from age, not confirmed" : info.current.signedAt ? ` · signed ${formatDate(info.current.signedAt)}` : ""}
                    {info.current.expiresOn && !info.current.provisional ? ` · expires ${formatDate(info.current.expiresOn)}` : ""}.
                    {" "}This upload becomes the current profile; the earlier one stays in the history.
                  </span>
                ) : (
                  <span>No risk profile on record yet — this will be the client's current one.</span>
                )}
              </div>
            )}

            {/* The profile */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="mb-1 text-xs font-medium">Risk Profile</div>
                <ThemeSelect value={category} onChange={setCategory} options={CATEGORIES} aria-label="Risk profile" />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-medium">Risk Score</div>
                <input value={score} onChange={(e) => setScore(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="e.g. 22" className="input-base w-full" aria-label="Risk score" />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-medium">Assessed On</div>
                <DateField value={assessedOn} onChange={(e) => changeAssessed(e.target.value)} className="input-base w-full" />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-medium">Expire On</div>
                <DateField value={expiresOn} onChange={(e) => { setExpiryTouched(true); setExpiresOn(e.target.value); }} className="input-base w-full" />
              </label>
            </div>

            {/* The PDF */}
            <div>
              <div className="mb-1 text-xs font-medium">Risk profile PDF</div>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm hover:bg-secondary/40">
                <FileText className="size-4 text-muted-foreground" />
                <span className={file ? "font-medium" : "text-muted-foreground"}>{file ? file.name : `Choose a PDF (up to ${MAX_MB} MB)`}</span>
                <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <div className="mb-1 text-xs font-medium">Assessed by / source <span className="font-normal text-muted-foreground">(optional)</span></div>
                <input value={assessedBy} onChange={(e) => setAssessedBy(e.target.value)} maxLength={120} placeholder="e.g. previous distributor" className="input-base w-full" />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-medium">Remarks <span className="font-normal text-muted-foreground">(optional)</span></div>
                <input value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} className="input-base w-full" />
              </label>
            </div>

            {err && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{err}</div>}
          </div>

          <DialogFooter>
            <button type="button" onClick={close} className={buttonClass("ghost")} disabled={busy}>Cancel</button>
            <button type="button" onClick={submit} disabled={busy || problems.length > 0} title={problems[0]} className={buttonClass("primary")}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload Risk Profile
            </button>
          </DialogFooter>
          {problems.length > 0 && client && (category || score || file) && (
            <p className="mt-2 text-2xs text-muted-foreground">{problems[0]}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
