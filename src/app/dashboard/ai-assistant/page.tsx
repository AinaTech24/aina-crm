"use client";

import { useState } from "react";
import { Bot, Send, Loader2, Sparkles, FileText } from "lucide-react";
import Link from "next/link";

type Result =
  | { kind: "filter"; query: string; ast: any; explanation: string; preview?: any }
  | { kind: "draft"; intent: string; channel: string; text: string }
  | { kind: "error"; message: string };

export default function AiAssistantPage() {
  const [mode, setMode] = useState<"filter" | "draft">("filter");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email" | "sms">("whatsapp");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    try {
      if (mode === "filter") {
        const res = await fetch("/api/ai/nl-to-filter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, subject: "investor" }),
        });
        const j = await res.json();
        if (j.error) {
          setResults((r) => [{ kind: "error", message: j.error }, ...r]);
        } else {
          // Then run the AST against the data
          const preview = await fetch("/api/segments/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subject: "investor", ast: j.ast }),
          }).then((r) => r.json());
          setResults((r) => [
            { kind: "filter", query, ast: j.ast, explanation: j.explanation, preview },
            ...r,
          ]);
        }
      } else {
        const res = await fetch("/api/ai/draft-message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channel, intent: query }),
        });
        const j = await res.json();
        if (j.error) {
          setResults((r) => [{ kind: "error", message: j.error }, ...r]);
        } else {
          setResults((r) => [{ kind: "draft", intent: query, channel, text: j.text }, ...r]);
        }
      }
      setQuery("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
        <p className="text-muted-foreground text-sm">
          Smart search and message drafting. Powered by Claude. All drafts re-pass the compliance
          gate before they can be sent.
        </p>
      </div>

      <div className="border rounded-lg bg-card p-5">
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setMode("filter")}
            className={`text-sm px-3 py-1.5 rounded-md ${
              mode === "filter" ? "bg-primary text-primary-foreground" : "border"
            }`}
          >
            <Sparkles className="size-3.5 inline mr-1" /> Smart search
          </button>
          <button
            onClick={() => setMode("draft")}
            className={`text-sm px-3 py-1.5 rounded-md ${
              mode === "draft" ? "bg-primary text-primary-foreground" : "border"
            }`}
          >
            <FileText className="size-3.5 inline mr-1" /> Draft message
          </button>
        </div>

        {mode === "draft" && (
          <div className="mb-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
              className="text-sm border rounded px-2 py-1 bg-background"
            >
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run();
              }
            }}
            placeholder={
              mode === "filter"
                ? "e.g. HNI clients in Mumbai with no contact in 60 days"
                : "e.g. Friendly WhatsApp message for SIP rejection — low balance reason"
            }
            className="flex-1 border rounded-md px-3 py-2 text-sm bg-background"
          />
          <button
            onClick={run}
            disabled={busy || !query.trim()}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {results.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            <Bot className="size-8 mx-auto" />
            <div className="mt-2">Ask me anything about your client base or to draft a message.</div>
          </div>
        )}

        {results.map((r, i) => (
          <div key={i} className="border rounded-lg bg-card p-4">
            {r.kind === "filter" && (
              <>
                <div className="text-xs text-muted-foreground">Smart search</div>
                <div className="font-medium mt-1">{r.query}</div>
                <div className="text-sm text-muted-foreground mt-2">{r.explanation}</div>
                {r.preview && (
                  <div className="mt-3 border-t pt-3">
                    <div className="text-sm font-medium">
                      {r.preview.count ?? 0} matching investor{r.preview.count === 1 ? "" : "s"}
                    </div>
                    {r.preview.sample?.length > 0 && (
                      <ul className="mt-2 text-xs space-y-0.5">
                        {r.preview.sample.slice(0, 10).map((s: any) => (
                          <li key={s.id} className="flex items-center gap-2">
                            <Link href={`/dashboard/investors/${s.id}`} className="hover:underline">
                              {s.name ?? s.id}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">View AST</summary>
                  <pre className="mt-2 bg-muted p-2 rounded text-[10px] overflow-x-auto">
                    {JSON.stringify(r.ast, null, 2)}
                  </pre>
                </details>
              </>
            )}
            {r.kind === "draft" && (
              <>
                <div className="text-xs text-muted-foreground">
                  AI-drafted {r.channel} message · re-run compliance check before sending
                </div>
                <div className="font-medium mt-1 italic text-muted-foreground">"{r.intent}"</div>
                <div className="mt-3 border-t pt-3 text-sm whitespace-pre-wrap">{r.text}</div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(r.text)}
                    className="text-xs rounded border px-2 py-1"
                  >
                    Copy
                  </button>
                  <Link
                    href="/dashboard/templates/new"
                    className="text-xs rounded border px-2 py-1 hover:bg-accent"
                  >
                    Save as template →
                  </Link>
                </div>
              </>
            )}
            {r.kind === "error" && (
              <div className="text-sm text-rose-600">⚠ {r.message}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
