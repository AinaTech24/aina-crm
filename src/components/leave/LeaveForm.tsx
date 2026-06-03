"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, CalendarDays, AlertTriangle } from "lucide-react";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_DURATION_LABELS,
  LEAVE_ENTITLEMENTS,
  computeDays,
} from "@/lib/leave/policy";

type Emp = { id: string; name: string };
type Usage = { employee_user_id: string; leave_type: string; used: number };

export function LeaveForm({
  employees,
  usage,
  currentUserId,
  isManager,
}: {
  employees: Emp[];
  usage: Usage[];
  currentUserId: string;
  isManager: boolean;
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(currentUserId);
  const [leaveType, setLeaveType] = useState("casual");
  const [duration, setDuration] = useState<"full_day" | "half_day">("full_day");
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const usageMap = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const u of usage) {
      (m[u.employee_user_id] ??= {})[u.leave_type] = Number(u.used);
    }
    return m;
  }, [usage]);

  const days = duration === "half_day" ? 0.5 : computeDays(fromDate, toDate, "full_day");
  const entitlement = LEAVE_ENTITLEMENTS[leaveType];
  const used = usageMap[employeeId]?.[leaveType] ?? 0;
  const remaining = entitlement === null ? null : Math.max(0, entitlement - used);
  const overBalance = remaining !== null && days > remaining;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/leave-applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeUserId: employeeId,
          leaveType,
          duration,
          fromDate,
          toDate: duration === "half_day" ? fromDate : toDate,
          reason: reason || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Save failed (${res.status})`); return; }
      router.push("/dashboard/leave-applications");
    } finally {
      setBusy(false);
    }
  }

  const canSave = !!employeeId && !!fromDate && days > 0 && (duration === "half_day" || toDate >= fromDate);

  return (
    <div className="card-surface p-5 space-y-4 max-w-3xl">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Employee">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            disabled={!isManager}
            className="input-base"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.id === currentUserId ? " (me)" : ""}</option>
            ))}
          </select>
          {!isManager && <p className="text-[11px] text-muted-foreground mt-1">You can only file leave for yourself.</p>}
        </Field>
        <Field label="Leave type">
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)} className="input-base">
            {Object.entries(LEAVE_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>

        <Field label="Duration">
          <select value={duration} onChange={(e) => setDuration(e.target.value as any)} className="input-base">
            {Object.entries(LEAVE_DURATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={duration === "half_day" ? "Date" : "From date"}>
          <input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value); }} className="input-base" />
        </Field>

        {duration === "full_day" && (
          <Field label="To date">
            <input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} className="input-base" />
          </Field>
        )}
        <Field label="No. of days">
          <div className="input-base flex items-center gap-2 bg-secondary/40">
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="font-bold tabular-nums">{days}</span>
            <span className="text-xs text-muted-foreground">auto-computed</span>
          </div>
        </Field>
      </div>

      {/* Balance */}
      <div className={`rounded-md border px-3 py-2 text-sm ${overBalance ? "border-rose-200 bg-rose-50 text-rose-700" : "border-border bg-secondary/30"}`}>
        {entitlement === null ? (
          <span className="text-muted-foreground">{LEAVE_TYPE_LABELS[leaveType]} is uncapped — no annual limit.</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {overBalance && <AlertTriangle className="size-4" />}
            {LEAVE_TYPE_LABELS[leaveType]} balance: <b>{remaining}</b> of {entitlement} left this FY ({used} used)
            {overBalance && <span className="font-medium"> · this request ({days}) exceeds the balance</span>}
          </span>
        )}
      </div>

      <Field label="Reason">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for leave…" className="input-base" />
      </Field>

      {err && <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">{err}</div>}

      <div className="flex justify-end pt-2 border-t border-border">
        <button onClick={save} disabled={!canSave || busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} File leave request
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-foreground/80 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
