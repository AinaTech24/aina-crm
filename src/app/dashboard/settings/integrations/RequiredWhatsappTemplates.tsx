"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { notify } from "@/components/ui/Toast";

type State = "missing" | "draft" | "failed" | "pending" | "approved" | "rejected" | "archived";
type Row = {
  key: string;
  name: string;
  category: "utility" | "marketing";
  useFor: string;
  state: State;
  error?: string | null;
};
type Payload = { connected: boolean; templates: Row[] };

const LABEL: Record<State, { text: string; tone: BadgeTone }> = {
  missing: { text: "Not created", tone: "neutral" },
  draft: { text: "Sending to Meta…", tone: "info" },
  pending: { text: "With Meta for approval", tone: "warning" },
  approved: { text: "Approved", tone: "success" },
  rejected: { text: "Rejected by Meta", tone: "danger" },
  failed: { text: "Could not send", tone: "danger" },
  archived: { text: "Archived", tone: "neutral" },
};

/** While anything is still being created or sent, look again every few seconds. */
const IN_FLIGHT: State[] = ["missing", "draft"];
const POLL_MS = 4000;
const POLL_FOR_MS = 3 * 60 * 1000;

/**
 * The required WhatsApp templates: created and sent to Meta for approval when
 * the firm connects Vartify. This shows where each one stands and lets the owner
 * send anything missing or failed again.
 *
 * `watchSince` — a number that changes when the firm has just connected, so the
 * panel starts watching the creation as it happens.
 */
export default function RequiredWhatsappTemplates({ canManage, watchSince }: { canManage: boolean; watchSince: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const watchUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/integrations/vartify/templates", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as Payload;
      setData(next);
      const inFlight = next.templates.some((t) => IN_FLIGHT.includes(t.state));
      if (inFlight && Date.now() < watchUntil.current) {
        timer.current = setTimeout(() => void load(), POLL_MS);
      }
    } catch {
      /* the panel is informational — a failed refresh just leaves the last view */
    }
  }, []);

  const watch = useCallback(() => {
    watchUntil.current = Date.now() + POLL_FOR_MS;
    if (timer.current) clearTimeout(timer.current);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  useEffect(() => {
    if (watchSince) {
      setOpen(true);
      watch();
    }
  }, [watchSince, watch]);

  async function sendAgain() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/integrations/vartify/templates", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(body?.error ?? "Could not start sending the templates");
        return;
      }
      notify.success("Creating the templates and sending them to Meta for approval.");
      setOpen(true);
      watch();
    } finally {
      setBusy(false);
    }
  }

  if (!data?.connected) return null;

  const rows = data.templates;
  const count = (s: State) => rows.filter((r) => r.state === s).length;
  const approved = count("approved");
  const waiting = count("pending") + count("draft");
  const problems = count("failed") + count("rejected");
  const toSend = count("missing") + count("failed");

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <FileText className="size-3.5" /> Required WhatsApp templates
        </button>
        {canManage && toSend > 0 && (
          <Button size="sm" variant="secondary" loading={busy} onClick={sendAgain}>
            {count("missing") === rows.length ? "Create and send to Meta" : "Send the rest to Meta"}
          </Button>
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {approved} approved · {waiting} with Meta · {problems} need attention · {count("missing")} not created.
        Approval is Meta’s decision and usually takes a few minutes to 24 hours; an approved template can be sent
        straight away.
      </p>

      {open && (
        <div className="mt-3 space-y-3">
          {(["utility", "marketing"] as const).map((cat) => (
            <div key={cat}>
              <div className="text-xs font-semibold text-foreground">
                {cat === "utility" ? "Utility — about something the client already has or asked for" : "Marketing — greetings and invitations (opt-in clients only)"}
              </div>
              <ul className="mt-1 divide-y divide-border rounded-md border border-border bg-card">
                {rows
                  .filter((r) => r.category === cat)
                  .map((r) => (
                    <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.useFor}
                          {(r.state === "failed" || r.state === "rejected") && r.error ? ` — ${r.error}` : ""}
                        </div>
                      </div>
                      <Badge tone={LABEL[r.state].tone} dot raw>
                        {LABEL[r.state].text}
                      </Badge>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Templates Meta rejects keep Meta’s reason here. Edit one in Templates and submit it again.
          </p>
        </div>
      )}
    </div>
  );
}
