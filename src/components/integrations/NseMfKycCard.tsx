"use client";

/**
 * Settings → Integrations: the firm's own NSE MF Invest API credentials, used
 * to fetch every client's KYC status from the KRA by PAN (lib/kyc/). The
 * secrets are write-only — the card never receives them back.
 */

import { useEffect, useState } from "react";
import { BadgeCheck, Copy } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { formatRelative } from "@/lib/utils";

type State = {
  connected: boolean;
  isActive: boolean;
  env: "live" | "uat" | null;
  memberCode: string | null;
  loginUserId: string | null;
  autoRefresh: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastRunAt: string | null;
  lastRunChecked: number | null;
  lastRunChanged: number | null;
  egressIp: string;
};

export function NseMfKycCard() {
  const toast = useToast();
  const [state, setState] = useState<State | null>(null);
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({ loginUserId: "", memberCode: "", apiSecret: "", licenseKey: "", env: "live" as "live" | "uat", autoRefresh: true });

  async function load() {
    const res = await fetch("/api/integrations/nse-mf", { cache: "no-store" });
    if (res.status === 403) {
      setDenied(true);
      return;
    }
    const j = (await res.json()) as State;
    setState(j);
    setForm((f) => ({ ...f, loginUserId: j.loginUserId ?? "", memberCode: j.memberCode ?? "", env: j.env ?? "live", autoRefresh: j.autoRefresh, apiSecret: "", licenseKey: "" }));
    if (!j.connected) setEditing(true);
  }

  useEffect(() => {
    void load();
  }, []);

  if (denied) return null;
  if (!state) return null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/nse-mf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Could not save");
        return;
      }
      toast.success("NSE credentials saved");
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/nse-mf/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (j.ok) toast.success(`Connected — NSE answered: ${j.remark ?? "OK"}${j.kra ? ` (${j.kra})` : ""}`);
      else toast.error(j.hint ? `${j.error} — ${j.hint}` : j.error ?? "Test failed");
      await load();
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    const ok = await confirmDialog({
      title: "Disconnect NSE MF Invest?",
      message: "KYC statuses stop updating from the KRA. The statuses already on your clients stay.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    await fetch("/api/integrations/nse-mf", { method: "DELETE" });
    toast.success("Disconnected");
    await load();
  }

  const status = state.connected ? (
    state.lastTestOk === false || (state.lastError && !state.lastTestOk) ? (
      <Badge tone="warning">Needs attention</Badge>
    ) : (
      <Badge tone="success">Connected</Badge>
    )
  ) : (
    <Badge tone="neutral">Not connected</Badge>
  );

  return (
    <Card>
      <CardHeader title="NSE MF Invest — KYC status" icon={<BadgeCheck className="size-4" />} action={status} />
      <CardBody>
        <div className="space-y-4 text-sm">
          <div className="rounded-md bg-secondary/70 px-3 py-2 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">IP for NSE to whitelist against your API user:</span>
            <span className="font-mono font-medium">{state.egressIp}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="size-3.5" aria-hidden />}
              onClick={() => {
                void navigator.clipboard?.writeText(state.egressIp);
                toast.info("Copied");
              }}
            >
              Copy
            </Button>
          </div>

          {state.connected && !editing && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">
              <div>
                <div className="text-xs text-muted-foreground">Login User ID</div>
                <div className="font-mono">{state.loginUserId}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Member code</div>
                <div className="font-mono">{state.memberCode}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Environment</div>
                <div>{state.env === "uat" ? "UAT (test)" : "Live"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Daily refresh</div>
                <div>{state.autoRefresh ? "On" : "Off"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last test</div>
                <div>{state.lastTestAt ? `${state.lastTestOk ? "Passed" : "Failed"} · ${formatRelative(state.lastTestAt)}` : "Not tested"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last daily run</div>
                <div>
                  {state.lastRunAt ? `${state.lastRunChecked ?? 0} checked, ${state.lastRunChanged ?? 0} updated · ${formatRelative(state.lastRunAt)}` : "Not run yet"}
                </div>
              </div>
              {state.lastError && (
                <div className="sm:col-span-3 text-destructive">
                  {state.lastError}
                  {state.lastErrorAt && <span className="text-muted-foreground"> · {formatRelative(state.lastErrorAt)}</span>}
                </div>
              )}
            </div>
          )}

          {editing && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Login User ID" required>
                {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full" value={form.loginUserId} onChange={(e) => setForm({ ...form, loginUserId: e.target.value })} autoComplete="off" />}
              </Field>
              <Field label="Member code" required>
                {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full" value={form.memberCode} onChange={(e) => setForm({ ...form, memberCode: e.target.value })} autoComplete="off" />}
              </Field>
              <Field label="API Secret" required={!state.connected} hint={state.connected ? "Leave blank to keep the saved one" : undefined}>
                {(id, d) => <PasswordInput id={id} aria-describedby={d} className="input-base w-full" value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} autoComplete="new-password" />}
              </Field>
              <Field label="API Member License Key" required={!state.connected} hint={state.connected ? "Leave blank to keep the saved one" : undefined}>
                {(id, d) => <PasswordInput id={id} aria-describedby={d} className="input-base w-full" value={form.licenseKey} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} autoComplete="new-password" />}
              </Field>
              <Field label="Environment">
                {(id) => (
                  <select id={id} className="input-base w-full" value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value as "live" | "uat" })}>
                    <option value="live">Live</option>
                    <option value="uat">UAT (test)</option>
                  </select>
                )}
              </Field>
              <label className="flex items-center gap-2 self-end pb-2">
                <input type="checkbox" checked={form.autoRefresh} onChange={(e) => setForm({ ...form, autoRefresh: e.target.checked })} />
                Refresh every client&apos;s KYC status daily
              </label>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button variant="primary" loading={saving} onClick={save}>
                  Save
                </Button>
                {state.connected && (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="primary" loading={testing} onClick={test}>
                  Test connection
                </Button>
                <Button onClick={() => setEditing(true)}>Edit</Button>
                <Button variant="ghost" onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
