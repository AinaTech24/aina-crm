"use client";

/**
 * "My attendance — today": clock in and out as often as the day needs. Every
 * punch is logged (attendance_punches) and listed here; worked time is the sum
 * of the day's in → out sessions. POST /api/attendance/clock.
 */

import { useState } from "react";
import { notify } from "@/components/ui/Toast";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { fmtMinutes } from "@/lib/attendance/policy";

type Punch = { kind: "in" | "out"; at: string };
type Today = {
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  status: string | null;
  punches?: Punch[];
} | null;

function hhmm(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function ClockWidget({ today }: { today: Today }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // The punch log; a day punched before the log existed falls back to its one pair.
  const punches: Punch[] = today?.punches?.length
    ? today.punches
    : [
        ...(today?.clock_in_at ? [{ kind: "in" as const, at: today.clock_in_at }] : []),
        ...(today?.clock_out_at ? [{ kind: "out" as const, at: today.clock_out_at }] : []),
      ];
  const clockedIn = punches.length > 0 && punches[punches.length - 1].kind === "in";
  const sessions: Array<{ in: string | null; out: string | null }> = [];
  for (const p of punches) {
    if (p.kind === "in") sessions.push({ in: p.at, out: null });
    else if (sessions.length && !sessions[sessions.length - 1].out) sessions[sessions.length - 1].out = p.at;
    else sessions.push({ in: null, out: p.at });
  }

  /** Best-effort browser geolocation (3s timeout); resolves null if denied. */
  function getGeo(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 }
      );
    });
  }

  async function punch(action: "in" | "out") {
    setBusy(true);
    try {
      const geo = await getGeo();
      const res = await fetch("/api/attendance/clock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(geo ? { lat: geo.lat, lng: geo.lng } : {}) }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); notify.error(j.error ?? "Punch failed"); return; }
      notify.success(action === "in" ? "Clocked in" : "Clocked out");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span className="font-semibold">My attendance — today</span>
          {today?.total_minutes != null && today.total_minutes > 0 && (
            <span className="text-muted-foreground">Worked <b className="text-foreground">{fmtMinutes(today.total_minutes)}</b></span>
          )}
          {clockedIn && <span className="chip bg-emerald-50 text-emerald-700">Clocked in</span>}
        </div>
        {clockedIn ? (
          <button onClick={() => punch("out")} disabled={busy} className="btn-accent text-sm inline-flex items-center gap-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} Clock out
          </button>
        ) : (
          <button onClick={() => punch("in")} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} Clock in
          </button>
        )}
      </div>
      {sessions.length > 0 && (
        <ol className="flex flex-wrap gap-2 text-xs tabular-nums" aria-label="Today's clock-ins and clock-outs">
          {sessions.map((s, i) => (
            <li key={i} className="rounded-md bg-secondary/70 px-2.5 py-1">
              <span className="text-muted-foreground">In</span> <b>{hhmm(s.in)}</b>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className="text-muted-foreground">Out</span>{" "}
              {s.out ? <b>{hhmm(s.out)}</b> : <span className="text-emerald-700 font-medium">now</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
