"use client";

import { useState } from "react";
import { Bot, Send, Loader2, Sparkles, FileText, Save, CheckCircle2, Megaphone, UserSearch, ShieldCheck, ClipboardList, ArrowRight } from "lucide-react";
import Link from "next/link";
import { InvestorLookup } from "@/components/common/InvestorLookup";

type Result =
  | { kind: "ask"; question: string; answer: string }
  | { kind: "filter"; query: string; ast: any; explanation: string; preview?: any }
  | { kind: "draft"; intent: string; channel: string; text: string }
  | { kind: "error"; message: string };

const STARTERS = [
  "What's my total AUM?",
  "How many clients are KYC-pending?",
  "Top 10 clients by AUM",
  "AUM by RM",
  "How many new clients this month?",
];

// Existing AI-powered features elsewhere in the app — surfaced so the firm
// discovers what Aina AI can do beyond this hub.
const TOOLS: Array<{ label: string; desc: string; href: string; icon: any }> = [
  { label: "Client brief", desc: "AI 360° summary on any client", href: "/dashboard/investors", icon: UserSearch },
  { label: "Lead scoring", desc: "AI-rank leads by conversion likelihood", href: "/dashboard/leads", icon: ClipboardList },
  { label: "Campaign ideas", desc: "AI-suggested marketing campaigns", href: "/dashboard/campaigns/new", icon: Megaphone },
  { label: "DDQ draft", desc: "AI-assisted compliance answers", href: "/dashboard/compliance", icon: ShieldCheck },
];

export default function AiAssistantPage() {
  const [mode, setMode] = useState<"ask" | "filter" | "draft">("ask");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email" | "sms">("whatsapp");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(q?: string) {
    const question = (q ?? query).trim();
    if (!question) return;
    setBusy(true);
    try {
      if (mode === "ask") {
        // Pass prior Q&A as history for multi-turn follow-ups.
        const history = results
          .filter((r): r is Extract<Result, { kind: "ask" }> => r.kind === "ask")
          .slice(0, 6)
          .reverse()
          .flatMap((r) => [
            { role: "user" as const, content: r.question },
            { role: "assistant" as const, content: r.answer },
          ]);
        const res = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, history }),
        });
        const j = await res.json();
        if (j.error || !j.answer) setResults((r) => [{ kind: "error", message: j.error ?? "Couldn't answer that." }, ...r]);
        else setResults((r) => [{ kind: "ask", question, answer: j.answer }, ...r]);
      } else if (mode === "filter") {
        const res = await fetch("/api/ai/nl-to-filter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: question, subject: "investor" }),
        });
        const j = await res.json();
        if (j.error || !j.ast) {
          setResults((r) => [{ kind: "error", message: j.error ?? "The AI couldn't build a filter for that. Try rephrasing." }, ...r]);
        } else {
          const preview = await fetch("/api/segments/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subject: "investor", ast: j.ast }),
          }).then((r) => r.json());
          setResults((r) => [{ kind: "filter", query: question, ast: j.ast, explanation: j.explanation, preview }, ...r]);
        }
      } else {
        const res = await fetch("/api/ai/draft-message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel, intent: question }),
        });
        const j = await res.json();
        if (j.error) setResults((r) => [{ kind: "error", message: j.error }, ...r]);
        else setResults((r) => [{ kind: "draft", intent: question, channel, text: j.text }, ...r]);
      }
      setQuery("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="size-6 ai-icon-animated" /> AI Assistant
        </h1>
        <p className="text-muted-foreground text-sm">
          Smart search and message drafting. Powered by Aina AI. All drafts re-pass the compliance gate before they can be sent.
        </p>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <div className="flex gap-2 mb-3">
          <ModeBtn active={mode === "ask"} onClick={() => setMode("ask")} icon={Bot} label="Ask data" />
          <ModeBtn active={mode === "filter"} onClick={() => setMode("filter")} icon={Sparkles} label="Smart search" />
          <ModeBtn active={mode === "draft"} onClick={() => setMode("draft")} icon={FileText} label="Draft message" />
        </div>

        {mode === "draft" && (
          <div className="mb-2">
            <select value={channel} onChange={(e) => setChannel(e.target.value as any)} className="text-sm border rounded px-2 py-1 bg-background">
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
            placeholder={
              mode === "ask"
                ? "e.g. What's my total AUM? · How many clients are KYC-pending? · Top 10 clients by AUM"
                : mode === "filter"
                  ? "e.g. HNI clients in Mumbai with no contact in 60 days"
                  : "e.g. Friendly WhatsApp message for SIP rejection — low balance reason"
            }
            className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
          />
          <button onClick={() => run()} disabled={busy || !query.trim()} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>

        {mode === "ask" && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {STARTERS.map((s) => (
              <button key={s} onClick={() => run(s)} disabled={busy} className="text-[11px] rounded-full border px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {results.length === 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {TOOLS.map((t) => (
                <Link key={t.label} href={t.href} className="border rounded-lg bg-card p-3 hover:border-brand-cyan/50 hover:bg-accent/30 transition-colors">
                  <t.icon className="size-4 text-brand-cyan" />
                  <div className="text-sm font-medium mt-1.5">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground">{t.desc}</div>
                </Link>
              ))}
            </div>
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Bot className="size-8 mx-auto" />
              <div className="mt-2">Ask me anything about your client base or to draft a message.</div>
            </div>
          </>
        )}

        {results.map((r, i) => (
          <div key={i} className="border rounded-lg bg-card p-4">
            {r.kind === "ask" && (
              <>
                <div className="text-xs text-muted-foreground flex items-center gap-1"><Bot className="size-3.5" /> Answer from your live data</div>
                <div className="font-medium mt-1">{r.question}</div>
                <div className="mt-2 border-t pt-2 text-sm whitespace-pre-wrap leading-relaxed">{r.answer}</div>
              </>
            )}
            {r.kind === "filter" && (
              <>
                <div className="text-xs text-muted-foreground">Smart search</div>
                <div className="font-medium mt-1">{r.query}</div>
                <div className="text-sm text-muted-foreground mt-2">{r.explanation}</div>
                {r.preview && (
                  <div className="mt-3 border-t pt-3">
                    <div className="text-sm font-medium">{r.preview.count ?? 0} matching investor{r.preview.count === 1 ? "" : "s"}</div>
                    {r.preview.sample?.length > 0 && (
                      <ul className="mt-2 text-xs space-y-0.5">
                        {r.preview.sample.slice(0, 10).map((s: any) => (
                          <li key={s.id}><Link href={`/dashboard/investors/${s.id}`} className="hover:underline">{s.name ?? s.id}</Link></li>
                        ))}
                      </ul>
                    )}
                    <SaveSegmentAction ast={r.ast} query={r.query} count={r.preview.count ?? 0} />
                  </div>
                )}
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">View AST</summary>
                  <pre className="mt-2 bg-muted p-2 rounded text-[10px] overflow-x-auto">{JSON.stringify(r.ast, null, 2)}</pre>
                </details>
              </>
            )}
            {r.kind === "draft" && (
              <>
                <div className="text-xs text-muted-foreground">AI-drafted {r.channel} message · compliance is re-checked on send</div>
                <div className="font-medium mt-1 italic text-muted-foreground">&ldquo;{r.intent}&rdquo;</div>
                <div className="mt-3 border-t pt-3 text-sm whitespace-pre-wrap">{r.text}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => navigator.clipboard.writeText(r.text)} className="text-xs rounded border px-2 py-1 hover:bg-accent">Copy</button>
                  <Link href="/dashboard/templates/new" className="text-xs rounded border px-2 py-1 hover:bg-accent">Save as template →</Link>
                </div>
                {r.channel === "email" && <SendDraftAction body={r.text} intent={r.intent} />}
                {r.channel !== "email" && (
                  <p className="text-[11px] text-muted-foreground mt-2">WhatsApp/SMS free-form sends need an approved template + open session window — save this as a template to send via a campaign or workflow.</p>
                )}
              </>
            )}
            {r.kind === "error" && <div className="text-sm text-rose-600">⚠ {r.message}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick} className={`text-sm px-3 py-1.5 rounded-md ${active ? "bg-primary text-primary-foreground" : "border"}`}>
      <Icon className="size-3.5 inline mr-1" /> {label}
    </button>
  );
}

/** Save a smart-search AST as a reusable segment, then offer to message it. */
function SaveSegmentAction({ ast, query, count }: { ast: any; query: string; count: number }) {
  const [name, setName] = useState(query.slice(0, 60));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setState("saving");
    setErr(null);
    try {
      const res = await fetch("/api/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), subjectType: "investor", ast }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Could not save"); setState("error"); return; }
      setSegmentId(j.id ?? null);
      setState("saved");
    } catch {
      setErr("Network error"); setState("error");
    }
  }

  if (state === "saved") {
    return (
      <div className="mt-3 text-xs text-emerald-700 flex items-center flex-wrap gap-2">
        <CheckCircle2 className="size-3.5" /> Saved as segment.
        <Link href={`/dashboard/campaigns/new${segmentId ? `?segmentId=${segmentId}` : ""}`} className="inline-flex items-center gap-1 underline font-medium text-brand-cyan">
          Create campaign to these {count} <ArrowRight className="size-3" />
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" className="text-xs border rounded px-2 py-1 bg-background flex-1 min-w-[160px]" />
      <button onClick={save} disabled={state === "saving" || !name.trim()} className="text-xs rounded border px-2 py-1 inline-flex items-center gap-1 hover:bg-accent disabled:opacity-50">
        {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} Save as segment
      </button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </div>
  );
}

/** Send an email draft to a chosen client through the real compose pipeline. */
function SendDraftAction({ body, intent }: { body: string; intent: string }) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [subject, setSubject] = useState(intent.slice(0, 80));
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    if (!client || !subject.trim()) return;
    setState("sending");
    setMsg(null);
    try {
      const res = await fetch("/api/communications/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investorId: client.id, subject: subject.trim(), body, category: "marketing" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 422 && j.findings) setMsg({ ok: false, text: "Blocked by compliance — adjust the message and retry." });
      else if (!res.ok) setMsg({ ok: false, text: j.error ?? "Send failed" });
      else if (j.status === "skipped") setMsg({ ok: false, text: `Not sent — ${String(j.reason ?? "").replace(/_/g, " ")}` });
      else setMsg({ ok: true, text: `Sent to ${client.name}.` });
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setState("idle");
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs rounded border px-2 py-1 inline-flex items-center gap-1 hover:bg-accent">
        <Send className="size-3" /> Send to a client
      </button>
    );
  }
  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <div className="text-[11px] text-muted-foreground">Sends via the firm&apos;s email + the compliance gate. Audited like any other send.</div>
      <InvestorLookup value={client?.id} displayName={client?.name} onSelect={(id, name) => setClient({ id, name })} onClear={() => setClient(null)} placeholder="Pick a client…" />
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" className="w-full text-xs border rounded px-2 py-1.5 bg-background" />
      <div className="flex items-center gap-2">
        <button onClick={send} disabled={state === "sending" || !client || !subject.trim()} className="text-xs rounded-md bg-primary text-primary-foreground px-3 py-1.5 inline-flex items-center gap-1 disabled:opacity-50">
          {state === "sending" ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} Send
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground">Cancel</button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
