"use client";

/**
 * "KYC Validated" on a client's onboarding journey: which KYC does the client
 * want — Online (e-KYC via Aadhaar OTP / DigiLocker) or Physical (in-person
 * verification)? The choice becomes a high-priority task in the Tasks module,
 * assigned to the person picked here and linked to the client.
 *
 * Lead-backed journeys ask the same in GuidedStageActions (KYC_MODES) when the
 * step is entered; this dialog is the entry point for every other client — a
 * direct entry or an import, whose journey bar is otherwise read-only.
 */

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";

export const KYC_ROUTES = {
  online: { label: "Online KYC", hint: "e-KYC via Aadhaar OTP / DigiLocker" },
  physical: { label: "Physical KYC", hint: "In-person verification (IPV) with documents" },
} as const;
export type KycRoute = keyof typeof KYC_ROUTES;

type Staff = { id: string; name: string };

export function KycRouteDialog({ investorId, investorName, onClose }: { investorId: string; investorName: string; onClose: () => void }) {
  const uid = useId();
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const [route, setRoute] = useState<KycRoute | "">("");
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState(tomorrow);
  const [busy, setBusy] = useState(false);

  // The team (same list the onboarding pop-up uses); the viewer is the default.
  useEffect(() => {
    let alive = true;
    (async () => {
      type EmpResponse = { employees?: Staff[]; rows?: Staff[]; data?: Staff[] };
      type OppResponse = { me?: string | null };
      const getJson = async <T,>(url: string): Promise<T> => {
        try {
          const r = await fetch(url, { cache: "no-store" });
          return (r.ok ? await r.json() : {}) as T;
        } catch {
          return {} as T;
        }
      };
      const [emp, opp] = await Promise.all([
        getJson<EmpResponse>("/api/employees?limit=200"),
        getJson<OppResponse>(`/api/investors/${investorId}/opportunities`),
      ]);
      if (!alive) return;
      const raw: Array<{ id: string; name?: string | null }> = emp.employees ?? emp.rows ?? emp.data ?? [];
      const list: Staff[] = raw.map((u) => ({ id: u.id, name: u.name ?? "—" }));
      setStaff(list);
      const me: string | null = opp.me ?? null;
      setAssigneeId(list.some((s) => s.id === me) ? me! : list[0]?.id ?? "");
    })();
    return () => {
      alive = false;
    };
  }, [investorId]);

  async function save() {
    if (!route) return notify.error("Choose Online KYC or Physical KYC.");
    if (!assigneeId) return notify.error("Choose who will do it.");
    if (!dueOn) return notify.error("Pick a due date.");
    setBusy(true);
    try {
      const r = KYC_ROUTES[route];
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${r.label} — ${investorName}`,
          description: `${r.label} chosen at "KYC Validated" (${r.hint}).`,
          type: "kyc_renewal",
          department: "compliance",
          priority: "high",
          subjectType: "investor",
          subjectId: investorId,
          relatedInvestorId: investorId,
          assigneeId,
          // 10:00 India time on the day picked.
          dueAt: new Date(`${dueOn}T10:00:00+05:30`).toISOString(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Could not create the task");
        return;
      }
      notify.success(`${r.label} task created${staff?.find((s) => s.id === assigneeId) ? ` for ${staff.find((s) => s.id === assigneeId)!.name}` : ""}.`);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>KYC Validated — which KYC?</DialogTitle>
          <DialogDescription>
            Choose how {investorName} will complete KYC. A task is created in the Tasks module for the person you pick.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">KYC type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(KYC_ROUTES) as KycRoute[]).map((k) => (
                <label
                  key={k}
                  className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
                    route === k ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-secondary/50"
                  }`}
                >
                  <input type="radio" name={`${uid}-route`} value={k} checked={route === k} onChange={() => setRoute(k)} className="sr-only" />
                  <span className="block font-semibold text-foreground">{KYC_ROUTES[k].label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{KYC_ROUTES[k].hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <label htmlFor={`${uid}-assignee`} className="text-sm font-medium text-foreground">Assign to</label>
            <select id={`${uid}-assignee`} className="input-base w-full" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {!staff && <option value="">Loading team…</option>}
              {staff?.length === 0 && <option value="">No team member available</option>}
              {staff?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${uid}-due`} className="text-sm font-medium text-foreground">Due on</label>
            <DateField id={`${uid}-due`} value={dueOn} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueOn(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!route || !assigneeId} onClick={save}>Create task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
