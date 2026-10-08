"use client";

/**
 * "Send mail" and "Send WhatsApp" for the top of a client or lead page.
 *
 * Each opens one dialog: pick a template, fill only the custom fields the
 * record cannot supply, send. Both go through the existing per-record send
 * routes (/api/comms/email-thread, /api/comms/whatsapp-thread), so every send
 * passes the same consent + compliance gate and lands an audited
 * communications row, exactly as the Emails / WhatsApp sections below do.
 *
 * Variable rules are those sections' own:
 * - email: namespaced fields (investor.*, tenant.*, lead.* …) fill themselves
 *   from the record; only a bare custom field ({{promo_code}}) is asked for,
 *   and a blank one is not sent, so the pipeline's auto-fill still applies.
 * - WhatsApp: every template parameter is asked for (a name one pre-filled).
 *   A CRM-authored WhatsApp template goes as free text and delivers only
 *   inside the 24-hour window the client opened by messaging you; a
 *   Meta-approved template delivers any time.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Send, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";

type Channel = "email" | "whatsapp";
type TemplateVar = { key: string; type?: string; required?: boolean };
type TemplateInfo = {
  key: string;
  name: string;
  description: string | null;
  status?: string;
  variables: TemplateVar[] | null;
  isMetaTemplate?: boolean;
  mediaBroken?: boolean;
};

const NO_SEND_PERMISSION =
  "You don’t have permission to send messages to clients. Ask your firm admin to enable “Send messages to clients” for you under Team → your profile → Customize Access Permissions.";

const prettyVarLabel = (key: string) =>
  (key.includes(".") ? key.split(".").slice(1).join(" ") : key).replace(/_/g, " ");

export function SendTemplateButtons({
  type,
  id,
  name,
  email,
  phone,
}: {
  type: "investor" | "lead";
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}) {
  const [channel, setChannel] = useState<Channel | null>(null);
  return (
    <>
      <Button icon={<Mail className="size-4" />} onClick={() => setChannel("email")}>Send mail</Button>
      <Button icon={<MessageCircle className="size-4" />} onClick={() => setChannel("whatsapp")}>Send WhatsApp</Button>
      {channel && (
        <SendDialog
          channel={channel}
          type={type}
          id={id}
          name={name}
          to={channel === "email" ? email : phone}
          onClose={() => setChannel(null)}
        />
      )}
    </>
  );
}

function SendDialog({
  channel, type, id, name, to, onClose,
}: {
  channel: Channel;
  type: "investor" | "lead";
  id: string;
  name: string;
  to?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const isMail = channel === "email";
  const api = isMail ? "/api/comms/email-thread" : "/api/comms/whatsapp-thread";
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Bumped by "refresh this list" after a template was created in another tab.
  const [loadTick, setLoadTick] = useState(0);
  function reload() {
    setTemplates(null);
    setLoadErr(null);
    setLoadTick((n) => n + 1);
  }

  useEffect(() => {
    let live = true;
    fetch(`${api}?type=${type}&id=${id}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "Could not load templates");
        return j;
      })
      .then((j) => {
        if (!live) return;
        setTemplates(Array.isArray(j.templates) ? j.templates : []);
        setSessionActive(!!j.sessionActive);
      })
      .catch((e) => live && setLoadErr(e.message));
    return () => { live = false; };
  }, [api, type, id, loadTick]);

  const selected = useMemo(() => templates?.find((t) => t.key === key) ?? null, [templates, key]);
  // Email asks only for bare custom fields; WhatsApp for every parameter.
  const asked = useMemo(
    () => (selected?.variables ?? []).filter((v) => (isMail ? !v.key.includes(".") : true)),
    [selected, isMail],
  );
  // A CRM-authored WhatsApp template outside the 24h window would be refused.
  const outsideWindow = !isMail && !!selected && !selected.isMetaTemplate && !sessionActive;

  useEffect(() => {
    const init: Record<string, string> = {};
    // A bare "name" field almost always means the recipient's name.
    for (const v of asked) init[v.key] = /name/i.test(v.key) ? name : "";
    setVars(init);
    setErr(null);
  }, [asked, isMail, name]);

  const missing = asked.filter((v) => v.required && !String(vars[v.key] ?? "").trim());

  async function send() {
    if (!selected) { setErr("Pick a template first."); return; }
    if (missing.length) { setErr(`Fill in: ${missing.map((v) => prettyVarLabel(v.key)).join(", ")}.`); return; }
    setBusy(true);
    setErr(null);
    try {
      // A blank override would win over the record's own value — drop blanks.
      const filled = Object.fromEntries(Object.entries(vars).filter(([, v]) => String(v ?? "").trim() !== ""));
      const res = await fetch(api, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isMail
          ? { mode: "template", type, id, templateKey: selected.key, variables: filled }
          : { type, id, templateKey: selected.key, variables: filled }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(res.status === 403 ? NO_SEND_PERMISSION : (j.error ?? "Could not send")); return; }
      if (j.status === "skipped") {
        setErr(`Not sent: ${j.skipped?.detail ?? j.skipped?.reason ?? "the consent or compliance check stopped it"}.`);
        return;
      }
      notify.success(isMail
        ? (j.status === "queued" ? "Email queued for sending" : "Email sent")
        : "WhatsApp sent");
      onClose();
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  const noRecipient = !to;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isMail ? <Mail className="size-4 text-muted-foreground" /> : <MessageCircle className="size-4 text-muted-foreground" />}
            {isMail ? "Send mail" : "Send WhatsApp"} · {name}
          </DialogTitle>
          <DialogDescription>
            To: <span className="font-medium text-foreground">{to || (isMail ? "no email on file" : "no mobile number on file")}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {noRecipient && (
            <p className="rounded-lg border border-warning/50 bg-warning/5 px-3 py-2 text-sm">
              Add {isMail ? "an email address" : "a mobile number"} to this {type === "investor" ? "client" : "lead"} before sending.
            </p>
          )}

          <div>
            <label htmlFor="send-template" className="mb-1.5 block text-xs font-medium">Template</label>
            {loadErr ? (
              <p className="text-sm text-destructive">{loadErr}</p>
            ) : templates === null ? (
              <div className="h-9 animate-pulse rounded-lg bg-secondary/60" aria-label="Loading templates" />
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {isMail ? "email" : "WhatsApp"} templates yet.
              </p>
            ) : (
              <SelectField
                id="send-template"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full"
                searchable={templates.length > 8}
                searchPlaceholder="Search templates…"
              >
                <option value="">Select a template…</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}{!isMail && t.isMetaTemplate ? " · Meta approved" : ""}
                  </option>
                ))}
              </SelectField>
            )}
            {selected?.description && <p className="mt-1.5 text-xs text-muted-foreground">{selected.description}</p>}
            {!loadErr && templates !== null && (
              <div className="mt-2 rounded-lg bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span>{templates.length ? "Can't find the template you need?" : "Write one now."}</span>
                  <a
                    href={`/dashboard/templates/new?channel=${channel}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <Plus className="size-3.5" /> Create new template
                  </a>
                </div>
                <p className="mt-1">
                  It opens in a new tab. Once you have saved it,{" "}
                  <button type="button" onClick={reload} className="font-medium text-foreground underline">
                    refresh this list
                  </button>{" "}
                  to pick it.
                </p>
              </div>
            )}
          </div>

          {outsideWindow && (
            <p className="rounded-lg border border-warning/50 bg-warning/5 px-3 py-2 text-sm">
              This template is not Meta-approved, so WhatsApp delivers it only within 24 hours of the
              {type === "investor" ? " client's" : " lead's"} last message to you — and there is none. Pick a
              Meta-approved template to start the conversation.
            </p>
          )}
          {!isMail && selected?.mediaBroken && (
            <p className="rounded-lg border border-warning/50 bg-warning/5 px-3 py-2 text-sm">
              This template's header image link has expired, so WhatsApp may refuse it. Re-upload the image in Message Templates.
            </p>
          )}

          {selected && asked.length > 0 && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium">Fill in</div>
                <p className="text-xs text-muted-foreground">
                  {isMail
                    ? "Client, firm and transaction details fill in by themselves. Only these need a value."
                    : "The values WhatsApp puts into the template's blanks."}
                </p>
              </div>
              {asked.map((v) => (
                <div key={v.key}>
                  <label htmlFor={`var-${v.key}`} className="mb-1 block text-xs font-medium capitalize">
                    {prettyVarLabel(v.key)}{v.required && <span className="text-destructive"> *</span>}
                  </label>
                  <input
                    id={`var-${v.key}`}
                    value={vars[v.key] ?? ""}
                    onChange={(e) => setVars((s) => ({ ...s, [v.key]: e.target.value }))}
                    className="input-base w-full"
                  />
                </div>
              ))}
            </div>
          )}

          {err && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={send}
            disabled={busy || !selected || noRecipient || outsideWindow}
            icon={busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          >
            {busy ? "Sending…" : isMail ? "Send mail" : "Send WhatsApp"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
