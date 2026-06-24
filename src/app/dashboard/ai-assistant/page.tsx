"use client";

import { useState } from "react";
import { Bot, Send, Loader2, Sparkles, FileText, Megaphone, UserSearch, ShieldCheck, ClipboardList, ArrowRight, Users, IndianRupee, ShieldAlert, TrendingDown, Repeat, Briefcase, CalendarClock, ListChecks } from "lucide-react";
import Link from "next/link";
import { InvestorLookup } from "@/components/common/InvestorLookup";

type Metrics = Record<string, any>;

type Result =
  | { kind: "search"; question: string; answer: string; metrics?: Metrics; aiUsed?: boolean }
  | { kind: "draft"; intent: string; channel: string; theme: string; text: string }
  | { kind: "error"; message: string };

const STARTERS = [
  "What's my total AUM?",
  "How many clients are KYC-pending?",
  "Top 10 clients by AUM",
  "AUM by RM",
  "How many new clients this month?",
  "How many open tasks are overdue?",
];

const TOOLS: Array<{ label: string; desc: string; href: string; icon: any }> = [
  { label: "Client brief", desc: "AI 360° summary on any client", href: "/dashboard/investors", icon: UserSearch },
  { label: "Lead scoring", desc: "AI-rank leads by conversion likelihood", href: "/dashboard/leads", icon: ClipboardList },
  { label: "Campaign ideas", desc: "AI-suggested marketing campaigns", href: "/dashboard/campaigns/new", icon: Megaphone },
  { label: "DDQ draft", desc: "AI-assisted compliance answers", href: "/dashboard/compliance", icon: ShieldCheck },
];

// Message tones for the drafter — passed to /api/ai/draft-message as `theme`.
const THEMES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "concise", label: "Concise" },
  { value: "warm", label: "Warm / reassuring" },
  { value: "festive", label: "Festive / greeting" },
  { value: "urgent", label: "Urgent / action-needed" },
  { value: "educational", label: "Educational" },
];

const inr = (n: any) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const inrCompact = (n: any) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return inr(v);
};

/** Module-wise metric tiles with REDIRECTION — each links to the relevant module
 *  so the answer is a worklist, not just a number. */
function metricTiles(m: Metrics): Array<{ label: string; value: string; href: string; icon: any; tone?: string }> {
  return [
    { label: "Active clients", value: String(m.active_clients ?? 0), href: "/dashboard/investors", icon: Users },
    { label: "Total AUM", value: inrCompact(m.total_aum_inr), href: "/dashboard/reports/business-mis", icon: IndianRupee, tone: "emerald" },
    { label: "Monthly SIP book", value: inrCompact(m.monthly_sip_book_inr), href: "/dashboard/sips", icon: Repeat, tone: "emerald" },
    { label: "Active SIPs", value: String(m.active_sips ?? 0), href: "/dashboard/sips", icon: Repeat },
    { label: "KYC pending", value: String(m.kyc_pending_clients ?? 0), href: "/dashboard/reports/kyc-tracker", icon: ShieldAlert, tone: m.kyc_pending_clients ? "amber" : undefined },
    { label: "No nominee", value: String(m.clients_without_nominee ?? 0), href: "/dashboard/reports/nomination-tracker", icon: ShieldAlert, tone: m.clients_without_nominee ? "amber" : undefined },
    { label: "Dormant (365d)", value: String(m.dormant_clients_365d ?? 0), href: "/dashboard/reports/churn-risk", icon: TrendingDown, tone: m.dormant_clients_365d ? "rose" : undefined },
    { label: "Open leads", value: String(m.open_leads ?? 0), href: "/dashboard/leads", icon: ClipboardList },
    { label: "Open tasks", value: String(m.open_tasks ?? 0), href: "/dashboard/tasks", icon: ListChecks, tone: m.overdue_tasks ? "rose" : undefined },
    { label: "Active policies", value: String(m.active_insurance_policies ?? 0), href: "/dashboard/insurance", icon: Briefcase },
    { label: "Upcoming meetings", value: String(m.upcoming_meetings ?? 0), href: "/dashboard/review-meetings", icon: CalendarClock },
    { label: "New this month", value: String(m.new_clients_this_month ?? 0), href: "/dashboard/investors", icon: Users },
  ];
}

export default function AiAssistantPage() {
  const [mode, setMode] = useState<"search" | "draft">("search");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email" | "sms">("whatsapp");
  const [theme, setTheme] = useState("professional");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(q?: string) {
    const question = (q ?? query).trim();
    if (!question) return;
    setBusy(true);
    try {
      if (mode === "search") {
        const history = results
          .filter((r): r is Extract<Result, { kind: "search" }> => r.kind === "search")
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
        if (!res.ok && !j.answer) {
          setResults((r) => [{ kind: "error", message: j.error ?? "Couldn't answer that." }, ...r]);
        } else {
          setResults((r) => [{ kind: "search", question, answer: j.answer ?? "", metrics: j.metrics, aiUsed: j.aiUsed }, ...r]);
        }
      } else {
        const res = await fetch("/api/ai/draft-message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel, intent: question, theme }),
        });
        const j = await res.json();
        if (j.error) setResults((r) => [{ kind: "error", message: j.error }, ...r]);
        else setResults((r) => [{ kind: "draft", intent: question, channel, theme, text: j.text }, ...r]);
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
        <p className="text-muted-foreground text-sm mt-1">
          Ask anything about your live data, or draft a client message. Drafts re-pass the compliance gate before they can be sent.
        </p>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <div className="flex gap-2 mb-3">
          <ModeBtn active={mode === "search"} onClick={() => setMode("search")} icon={Sparkles} label="Smart search" />
          <ModeBtn active={mode === "draft"} onClick={() => setMode("draft")} icon={FileText} label="Draft message" />
        </div>

        {mode === "draft" && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select value={channel} onChange={(e) => setChannel(e.target.value as any)} className="text-sm border rounded px-2 py-1 bg-background">
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
            {/* Dynamic theme/tone — drives the drafted message's voice. */}
            <label className="text-xs text-muted-foreground">Theme</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value)} className="text-sm border rounded px-2 py-1 bg-background">
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
            placeholder={
              mode === "search"
                ? "e.g. What's my total AUM? · How many clients are KYC-pending? · Top 10 clients by AUM"
                : "e.g. Message for a client whose SIP bounced — low balance reason"
            }
            className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
          />
          <button onClick={() => run()} disabled={busy || !query.trim()} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>

        {mode === "search" && (
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
            {r.kind === "search" && (
              <>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Bot className="size-3.5" /> Answer from your live data
                  {r.aiUsed === false && <span className="ml-1 text-amber-600">· AI busy, showing live figures</span>}
                </div>
                <div className="font-medium mt-1">{r.question}</div>
                {r.answer && <div className="mt-2 border-t pt-2 text-sm whitespace-pre-wrap leading-relaxed">{r.answer}</div>}

                {/* Structured, module-wise tiles — each redirects to its module. */}
                {r.metrics && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {metricTiles(r.metrics).map((t) => (
                      <Link key={t.label} href={t.href} className="group border rounded-lg p-2.5 hover:border-brand-cyan/50 hover:bg-accent/30 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</span>
                          <t.icon className="size-3.5 text-muted-foreground group-hover:text-brand-cyan" />
                        </div>
                        <div className={`text-lg font-bold tabular-nums mt-0.5 ${t.tone === "emerald" ? "text-emerald-600" : t.tone === "amber" ? "text-amber-600" : t.tone === "rose" ? "text-rose-600" : ""}`}>{t.value}</div>
                      </Link>
                    ))}
                  </div>
                )}

                {/* Drill-throughs the answer references. */}
                {r.metrics && (r.metrics.top_clients_by_aum?.length ?? 0) > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Top clients by AUM</summary>
                    <ul className="mt-2 space-y-0.5">
                      {r.metrics.top_clients_by_aum.slice(0, 10).map((c: any, idx: number) => (
                        <li key={idx} className="flex justify-between text-xs"><span>{idx + 1}. {c.name}</span><span className="tabular-nums text-muted-foreground">{inr(c.aum_inr)}</span></li>
                      ))}
                    </ul>
                    <Link href="/dashboard/investors" className="text-[11px] text-brand-cyan-deep hover:underline mt-1 inline-flex items-center gap-1">Open Clients <ArrowRight className="size-3" /></Link>
                  </details>
                )}
              </>
            )}
            {r.kind === "draft" && (
              <>
                <div className="text-xs text-muted-foreground">AI-drafted {r.channel} message · {THEMES.find((t) => t.value === r.theme)?.label ?? r.theme} tone · compliance is re-checked on send</div>
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
