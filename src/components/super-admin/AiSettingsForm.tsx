"use client";

import { useState } from "react";
import { Bot, KeyRound, Loader2, CheckCircle2, XCircle, Save, Plug } from "lucide-react";

type Provider = "anthropic" | "google";
type ProviderDef = { value: Provider; label: string; fast: string; reasoning: string; keyHint: string; docsUrl: string };
type Status = {
  provider: Provider;
  fastModel: string;
  reasoningModel: string;
  keyConfigured: boolean;
  keyLast4: string | null;
  source: "db" | "env" | "none";
};

export function AiSettingsForm({ initial, providers }: { initial: Status; providers: ProviderDef[] }) {
  const [provider, setProvider] = useState<Provider>(initial.provider);
  const [apiKey, setApiKey] = useState("");
  const [fastModel, setFastModel] = useState(initial.fastModel);
  const [reasoningModel, setReasoningModel] = useState(initial.reasoningModel);
  const [keyConfigured, setKeyConfigured] = useState(initial.keyConfigured);
  const [keyLast4, setKeyLast4] = useState(initial.keyLast4);
  const [source, setSource] = useState(initial.source);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const def = providers.find((p) => p.value === provider)!;

  function switchProvider(next: Provider) {
    setProvider(next);
    const d = providers.find((p) => p.value === next)!;
    // Reset model fields to the new provider's defaults (user can still edit).
    setFastModel(d.fast);
    setReasoningModel(d.reasoning);
    setMsg(null);
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/ai-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKey || undefined, model: fastModel || undefined }),
      });
      const data = await res.json();
      if (data.ok) setMsg({ kind: "ok", text: `Connection OK${data.reply ? ` — model replied “${data.reply}”` : ""}.` });
      else setMsg({ kind: "err", text: data.error || "Connection failed." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKey || undefined, fastModel, reasoningModel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "Save failed." });
      } else {
        const s: Status = data.status;
        setKeyConfigured(s.keyConfigured);
        setKeyLast4(s.keyLast4);
        setSource(s.source);
        setApiKey("");
        setMsg({ kind: "ok", text: "Saved. New requests use this provider within ~30s." });
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Network error." });
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || testing;

  return (
    <div className="border rounded-lg bg-card p-5 space-y-5 max-w-2xl">
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-muted-foreground" />
        <div>
          <h2 className="font-semibold">AI provider & models</h2>
          <p className="text-xs text-muted-foreground">
            Switch the model engine and rotate the API key for the whole platform. The key is encrypted at rest.
          </p>
        </div>
      </div>

      {/* Current status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-1 rounded-full bg-muted">
          Active: <strong>{providers.find((p) => p.value === initial.provider)?.label ?? initial.provider}</strong>
        </span>
        <span
          className={`px-2 py-1 rounded-full ${
            keyConfigured ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {keyConfigured ? `Key set ••••${keyLast4 ?? ""}` : "No key"}
        </span>
        <span className="px-2 py-1 rounded-full bg-muted">
          Source: {source === "db" ? "Aina Admin" : source === "env" ? "env var" : "none"}
        </span>
      </div>

      {/* Provider */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Provider</label>
        <div className="grid grid-cols-2 gap-2">
          {providers.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => switchProvider(p.value)}
              className={`text-left border rounded-md px-3 py-2.5 text-sm transition ${
                provider === p.value ? "border-primary ring-1 ring-primary bg-accent" : "hover:bg-accent"
              }`}
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-[11px] text-muted-foreground">{p.keyHint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* API key */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <KeyRound className="size-3.5" /> API key
        </label>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={keyConfigured ? `•••• saved (leave blank to keep ••••${keyLast4 ?? ""})` : `Paste your ${def.label} key`}
          className="w-full rounded-md border px-3 py-2 text-sm font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          Get one from{" "}
          <a href={def.docsUrl} target="_blank" rel="noreferrer" className="underline">
            {def.label} console
          </a>
          . Stored encrypted (AES-256-GCM) — never shown again after saving.
        </p>
      </div>

      {/* Models */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Fast model</label>
          <input
            value={fastModel}
            onChange={(e) => setFastModel(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground">Classify, score, triage, translate.</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Reasoning model</label>
          <input
            value={reasoningModel}
            onChange={(e) => setReasoningModel(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground">Compose, briefs, summaries, extraction.</p>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div
          className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${
            msg.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {msg.kind === "ok" ? <CheckCircle2 className="size-4 mt-0.5" /> : <XCircle className="size-4 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save changes
        </button>
        <button
          type="button"
          onClick={test}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          Test connection
        </button>
      </div>
    </div>
  );
}
