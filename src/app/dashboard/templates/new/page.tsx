"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronDown, Eye, ShieldCheck, AlertCircle, Save, Send, Plus, Trash, Paperclip } from "lucide-react";
import { runComplianceChecks, missingMandatoryLines } from "@/lib/comms/compliance";
import { MergeFieldInserter, type VarDecl } from "@/components/templates/MergeFieldInserter";
import { SelectField } from "@/components/ui/SelectField";
import type { EmailDesignerBody } from "@/lib/email-designer/types";
import { STARTER_TEMPLATES, applyStarter } from "@/lib/email-designer/starters";

// Code-split the block-based email designer (847 lines + its editor deps) so
// it loads only when the email channel is actually edited, not on page open.
const EmailDesigner = dynamic(
  () => import("@/components/email-designer/EmailDesigner").then((m) => m.EmailDesigner),
  { ssr: false, loading: () => <div className="skeleton h-[60vh] min-h-[400px] w-full rounded-xl" /> }
);

type Channel = "whatsapp" | "email" | "sms";
type Category = "transactional" | "utility" | "marketing" | "authentication";

const defaultEmailBody: EmailDesignerBody = {
  subject: "Welcome to {{tenant.displayName}}",
  preheader: "Your wealth-management partner",
  mode: "designer",
  blocks: [],
  footer: { includeArn: true, includeAddress: true, includeUnsubscribe: true },
  theme: {
    brandColor: "#0ea5e9",
    accentColor: "#0e2557",
    pageBackground: "#f5f7fb",
    cardBackground: "#ffffff",
    textColor: "#111827",
    mutedColor: "#6b7280",
    fontFamily: "sans",
    baseFontSize: 15,
    containerWidth: 600,
    cornerRadius: 12,
    logoHeight: 40,
    logoAlign: "center",
  },
};

function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.slice(2, -2).trim())));
}

export default function NewTemplatePage() {
  const router = useRouter();
  const [name, setName] = useState("New template");
  const [key, setKey] = useState("new_template");
  // Auto-derive the key from the name until the user edits the key directly, so
  // two templates never collide on the static default "new_template".
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [category, setCategory] = useState<Category>("transactional");
  const [locale, setLocale] = useState("en-IN");
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string }>>([]);
  const waRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);

  // Dynamic tenant details loaded from API
  const [tenant, setTenant] = useState<{
    legalName?: string;
    displayName?: string;
    arn?: string;
    principalEuin?: string;
    riaRegistered?: boolean;
    logoUrl?: string;
    brandColor?: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/tenant")
      .then((r) => r.json())
      .then((data) => {
        if (data?.tenant) {
          setTenant({
            legalName: data.tenant.legalName ?? "",
            displayName: data.tenant.displayName ?? "",
            arn: data.tenant.arn ?? "",
            principalEuin: data.tenant.principalEuin ?? undefined,
            riaRegistered: !!data.tenant.riaRegistered,
            logoUrl: data.tenant.logoUrl ?? "",
            brandColor: data.tenant.primaryColor ?? data.tenant.brandColor ?? undefined,
          });
        }
      })
      .catch((err) => console.error("Failed to load tenant details:", err));
  }, []);

  // Keep `key` a slug of `name` until the user hand-edits the key field.
  useEffect(() => {
    if (keyEdited) return;
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
    setKey(slug.length >= 2 ? slug : "new_template");
  }, [name, keyEdited]);

  // Email body (block designer / HTML mode)
  const [emailBody, setEmailBody] = useState<EmailDesignerBody>(defaultEmailBody);

  // Plain-text channels (WA / SMS) keep the old simple textarea editor
  const [waText, setWaText] = useState(
    "Hi {{investor.name}}, your SIP for {{transaction.scheme_name}} of ₹{{transaction.amount}} on {{transaction.transaction_date}} did not go through. We'll be in touch shortly.\n\n— {{tenant.displayName}} · ARN-{{tenant.arn}}"
  );
  const [smsText, setSmsText] = useState(
    "Dear {{investor.name}}, your SIP for {{transaction.scheme_name}} of Rs.{{transaction.amount}} failed. We will be in touch. - {{tenant.displayName}}"
  );
  const [dltId, setDltId] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compliance score against rendered text (for any channel)
  const previewText = useMemo(() => {
    if (channel === "email") {
      if (emailBody.mode === "html") return emailBody.html ?? "";
      return [
        emailBody.subject,
        emailBody.preheader,
        ...(emailBody.blocks ?? []).map((b: any) => b.text || b.title || b.subtitle || b.html || b.label || ""),
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (channel === "whatsapp") return waText;
    return smsText;
  }, [channel, emailBody, waText, smsText]);

  // Declared variables schema state
  const [declaredVars, setDeclaredVars] = useState<
    Array<{
      key: string;
      type: "string" | "number" | "currency" | "date" | "boolean" | "url";
      source?: string;
      required?: boolean;
      fallback?: unknown;
      format?: string;
    }>
  >([]);

  // Automatically extract variables from text blocks
  const parsedKeys = useMemo(() => {
    return extractVariables(previewText);
  }, [previewText]);

  useEffect(() => {
    setDeclaredVars((prev) => {
      return parsedKeys.map((vkey) => {
        const existing = prev.find((v) => v.key === vkey);
        if (existing) return existing;

        let guessedType: "string" | "number" | "currency" | "date" | "boolean" | "url" = "string";
        if (vkey.includes("amount") || vkey.includes("balance") || vkey.includes("value") || vkey.includes("aum") || vkey.includes("price")) {
          guessedType = "currency";
        } else if (vkey.includes("date") || vkey.includes("at") || vkey.includes("expiry") || vkey.includes("time")) {
          guessedType = "date";
        } else if (vkey.includes("url") || vkey.includes("link") || vkey.includes("href") || vkey.includes("site")) {
          guessedType = "url";
        } else if (vkey.includes("count") || vkey.includes("number") || vkey.includes("units") || vkey.includes("id")) {
          guessedType = "number";
        } else if (vkey.includes("is_") || vkey.includes("has_") || vkey.includes("active")) {
          guessedType = "boolean";
        }

        return {
          key: vkey,
          type: guessedType,
          source: vkey,
          required: true,
        };
      });
    });
  }, [parsedKeys]);

  const activeTenant = useMemo(
    () =>
      tenant ?? {
        legalName: "Demo Wealth Advisors",
        arn: "123456",
        principalEuin: "E123456",
        riaRegistered: false,
      },
    [tenant]
  );

  const compliance = useMemo(() => {
    return runComplianceChecks({
      channel,
      category,
      tenant: activeTenant,
      text: previewText,
      subject: channel === "email" ? emailBody.subject : undefined,
      dltTemplateId: channel === "sms" ? dltId : undefined,
      whatsappSessionActive: false,
      hasMarketingConsent: true,
    });
  }, [previewText, emailBody.subject, channel, category, dltId, activeTenant]);

  // Mandatory footer lines (disclaimer / ARN / firm name) missing from the body.
  // Offered for plain-text channels; email carries them via the designer footer.
  const fixLines = useMemo(() => {
    if (channel === "email") return [];
    return missingMandatoryLines({ category, text: previewText, tenant: activeTenant });
  }, [channel, category, previewText, activeTenant]);

  function applyComplianceFix() {
    if (!fixLines.length) return;
    const append = (t: string) => `${t.replace(/\s+$/, "")}\n\n${fixLines.join("\n")}`;
    if (channel === "whatsapp") setWaText((t) => append(t));
    else if (channel === "sms") setSmsText((t) => append(t));
  }

  /** Insert a merge token: into WA/SMS at the cursor, or into the email subject;
   *  and upsert a precise variable declaration so the schema is correct. */
  function insertMergeField(token: string, decl: VarDecl) {
    setDeclaredVars((prev) => {
      const i = prev.findIndex((v) => v.key === decl.key);
      if (i === -1) return [...prev, decl];
      const next = [...prev];
      next[i] = { ...next[i], type: decl.type, source: decl.source };
      return next;
    });
    if (channel === "whatsapp") setWaText((t) => spliceAtCursor(waRef.current, t, token));
    else if (channel === "sms") setSmsText((t) => spliceAtCursor(smsRef.current, t, token));
    else setEmailBody((b) => ({ ...b, subject: `${b.subject ?? ""}${token}` }));
  }

  async function save(opts: { submitForApproval?: boolean }) {
    setSaving(true);
    setError(null);
    try {
      const body =
        channel === "email"
          ? emailBody
          : channel === "whatsapp"
            ? { body: { text: waText } }
            : { dltTemplateId: dltId, text: smsText };

      const payload = {
        key,
        name,
        description: description || undefined,
        channel,
        category,
        locale,
        body,
        variables: declaredVars,
        attachments,
      };
      const r = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      if (opts.submitForApproval) {
        await fetch(`/api/templates/${data.id}/submit`, { method: "POST" });
      }
      router.push(`/dashboard/templates/${data.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      <Link
        href="/dashboard/templates"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to templates
      </Link>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[300px]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-2xl font-bold tracking-tight bg-transparent border-none outline-none w-full"
            placeholder="Template name"
          />
          <input
            value={key}
            onChange={(e) => { setKeyEdited(true); setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")); }}
            className="text-xs font-mono text-muted-foreground bg-transparent border-none outline-none mt-1"
            placeholder="template_key"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={() => save({ submitForApproval: false })} disabled={saving} className="btn-secondary text-sm flex items-center gap-1">
            <Save className="size-4" /> Save draft
          </button>
          <button
            disabled={compliance.blocked || saving}
            onClick={() => save({ submitForApproval: true })}
            className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1"
          >
            <Send className="size-4" /> Submit for approval
          </button>
        </div>
      </div>

      {error && (
        <div className="card-surface p-3 text-sm text-rose-700 bg-rose-50/40">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="Channel">
          <SelectField value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="w-full">
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
          </SelectField>
        </Field>
        <Field label="Category">
          <SelectField value={category} onChange={(e) => setCategory(e.target.value as Category)} className="w-full">
            <option value="transactional">Transactional</option>
            <option value="utility">Utility</option>
            <option value="marketing">Marketing</option>
            <option value="authentication">Authentication</option>
          </SelectField>
        </Field>
        <Field label="Locale">
          <SelectField value={locale} onChange={(e) => setLocale(e.target.value)} className="w-full">
            <option value="en-IN">English (India)</option>
            <option value="hi-IN">Hindi</option>
            <option value="gu-IN">Gujarati</option>
            <option value="mr-IN">Marathi</option>
          </SelectField>
        </Field>
      </div>

      <Field label="Description / summary">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this template for? e.g. Sent when a SIP bounces — low-balance variant"
          className="input-base w-full"
        />
      </Field>

      {/* Compliance score strip */}
      <div className="card-surface p-3 flex items-center gap-3">
        <ShieldCheck className={`size-4 ${compliance.blocked ? "text-rose-600" : "text-emerald-600"}`} />
        <div className="text-sm font-medium">Compliance score</div>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${
              compliance.blocked ? "bg-rose-500" : compliance.score >= 90 ? "bg-emerald-500" : "bg-amber-500"
            }`}
            style={{ width: `${compliance.score}%` }}
          />
        </div>
        <div className="font-mono text-xs">{compliance.score}/100</div>
        {fixLines.length > 0 && (
          <button
            type="button"
            onClick={applyComplianceFix}
            className="text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 px-2.5 py-1 flex items-center gap-1"
            title={`Insert the mandatory ${fixLines.join(" + ")}`}
          >
            <ShieldCheck className="size-3.5" /> Apply suggested fix
          </button>
        )}
        {compliance.findings.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{compliance.findings.length} finding(s)</summary>
            <ul className="mt-2 space-y-1 max-w-md">
              {compliance.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertCircle
                    className={`size-3 mt-0.5 ${
                      f.severity === "block" ? "text-rose-600" : f.severity === "warn" ? "text-amber-600" : "text-blue-600"
                    }`}
                  />
                  <span>{f.message}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Variable Configuration Panel — collapsed by default so it doesn't crowd the editor */}
      {declaredVars.length > 0 && (
        <details className="card-surface p-4 bg-slate-50/50 group">
          <summary className="flex items-center justify-between cursor-pointer list-none select-none">
            <h3 className="font-semibold text-xs text-slate-800 flex items-center gap-1.5">
              <ChevronDown className="size-3.5 -rotate-90 group-open:rotate-0 transition-transform" />
              Auto-Detected Variables ({declaredVars.length})
            </h3>
            <span className="text-[10px] text-muted-foreground font-mono">Use {"{{variable_name}}"} in text to add more</span>
          </summary>
          <div className="border rounded-md divide-y bg-background overflow-hidden mt-3">
            {declaredVars.map((v, idx) => (
              <div key={v.key} className="p-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-center text-xs">
                <div className="font-mono font-semibold text-slate-700 truncate">{v.key}</div>
                <div>
                  <label className="text-[9px] text-muted-foreground block font-medium uppercase tracking-wider mb-0.5">Type</label>
                  <SelectField
                    value={v.type}
                    onChange={(e) => {
                      const next = [...declaredVars];
                      next[idx].type = e.target.value as any;
                      setDeclaredVars(next);
                    }}
                    size="sm"
                    className="w-full"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency (INR)</option>
                    <option value="date">Date</option>
                    <option value="boolean">Boolean</option>
                    <option value="url">URL</option>
                  </SelectField>
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground block font-medium uppercase tracking-wider mb-0.5">Source path</label>
                  <input
                    value={v.source ?? ""}
                    onChange={(e) => {
                      const next = [...declaredVars];
                      next[idx].source = e.target.value;
                      setDeclaredVars(next);
                    }}
                    placeholder="e.g. investor.name"
                    className="input-base py-1 px-2 text-xs w-full font-mono bg-background"
                  />
                </div>
                <div className="flex items-center gap-2 md:pt-3">
                  <input
                    type="checkbox"
                    id={`req-${v.key}`}
                    checked={!!v.required}
                    onChange={(e) => {
                      const next = [...declaredVars];
                      next[idx].required = e.target.checked;
                      setDeclaredVars(next);
                    }}
                    className="rounded border-gray-300 text-primary focus:ring-primary size-3.5"
                  />
                  <label htmlFor={`req-${v.key}`} className="cursor-pointer text-xs text-slate-600 select-none">
                    Required Variable
                  </label>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Merge-field inserter (Sanchay-style target module + field picker) */}
      <MergeFieldInserter onInsert={insertMergeField} />
      {channel === "email" && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          For email, the field is added to the <strong>subject</strong> + declared as a variable; type{" "}
          <code className="bg-muted px-1 rounded">{`{{investor.name}}`}</code> directly into body blocks too.
        </p>
      )}

      {/* Body editor — per channel */}
      {channel === "email" && (
        <div className="pt-3 mt-1 border-t border-border/60">
          <h2 className="text-base font-bold tracking-tight">Design your email</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Start from a ready-made template, then customise it in the editor below.
          </p>
        </div>
      )}
      {channel === "email" && (
        <div className="rounded-xl border border-border bg-secondary/30 p-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Start from a template
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto scrollbar-thin pr-1">
            {([
              { key: "client-transactional", label: "Client · Transactional", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience !== "internal" && s.category === "transactional" },
              { key: "client-utility", label: "Client · Utility / Service", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience !== "internal" && s.category === "utility" },
              { key: "client-marketing", label: "Client · Marketing", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience !== "internal" && s.category === "marketing" },
              { key: "internal", label: "Team & Internal · Alerts / Status / Reports", match: (s: (typeof STARTER_TEMPLATES)[number]) => s.audience === "internal" },
            ] as const).map((group) => {
              const items = STARTER_TEMPLATES.filter(group.match);
              if (!items.length) return null;
              return (
                <div key={group.key}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">{group.label}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {items.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => {
                          const body = applyStarter(s.key);
                          if (body) {
                            setEmailBody(body);
                            setCategory(s.category);
                            // Give the new template a meaningful, unique-ish name +
                            // key so it doesn't collide on the static default.
                            setName(s.name);
                            setKeyEdited(false);
                          }
                        }}
                        className="text-left rounded-lg border border-border bg-card px-3 py-2.5 hover:border-brand-cyan/60 hover:shadow-sm transition-all"
                      >
                        <div className="text-sm font-semibold truncate">{s.name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{s.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">Pick one to pre-fill the designer, then customise. Or start from scratch below.</p>
        </div>
      )}
      {channel === "email" && (
        <EmailDesigner value={emailBody} onChange={setEmailBody} tenant={tenant ?? undefined} />
      )}

      {channel === "whatsapp" && (
        <div className="card-surface p-5 space-y-3">
          <Field label="Body">
            <textarea
              ref={waRef}
              value={waText}
              onChange={(e) => setWaText(e.target.value)}
              rows={10}
              className="input-base font-mono w-full"
            />
          </Field>
          <div className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">{`{{name}}`}</code>,{" "}
            <code className="bg-muted px-1 rounded">{`{{amount}}`}</code> etc. for personalization. Variables resolve
            from subject + tenant + run context at send time.
          </div>
        </div>
      )}

      {channel === "sms" && (
        <div className="card-surface p-5 space-y-3">
          <Field label="DLT Template ID">
            <input value={dltId} onChange={(e) => setDltId(e.target.value)} className="input-base w-full font-mono" placeholder="1107171234567" />
          </Field>
          <Field label="SMS body (max ~160 chars per part)">
            <textarea
              ref={smsRef}
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              rows={5}
              className="input-base font-mono w-full"
            />
          </Field>
          <div className="text-xs text-muted-foreground">{smsText.length} characters · {Math.ceil(smsText.length / 160)} SMS part(s)</div>
        </div>
      )}

      {/* Attachments (auto-attach on email send) */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Paperclip className="size-4 text-brand-cyan" /> Attachments ({attachments.length})
          </h3>
          <button
            type="button"
            onClick={() => setAttachments((a) => [...a, { name: "", url: "" }])}
            className="btn-ghost text-xs"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Attach a hosted file (fund factsheet, KYC form, brochure) — auto-attached on every <strong>email</strong> send.
          </p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={a.name}
                  onChange={(e) => setAttachments((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Display name"
                  className="input-base text-sm w-1/3"
                />
                <input
                  value={a.url}
                  onChange={(e) => setAttachments((arr) => arr.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
                  placeholder="https://… (hosted file URL)"
                  className="input-base text-sm flex-1 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setAttachments((arr) => arr.filter((_, idx) => idx !== i))}
                  className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                >
                  <Trash className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

/** Insert `token` at the textarea's caret (or append if no caret). */
function spliceAtCursor(el: HTMLTextAreaElement | null, value: string, token: string): string {
  if (!el) return value + token;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  requestAnimationFrame(() => {
    try {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    } catch {}
  });
  return next;
}
