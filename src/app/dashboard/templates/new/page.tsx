"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Eye, ShieldCheck, AlertCircle, Save, Send } from "lucide-react";
import { runComplianceChecks } from "@/lib/comms/compliance";
import { EmailDesigner } from "@/components/email-designer/EmailDesigner";
import type { EmailDesignerBody } from "@/lib/email-designer/types";

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

export default function NewTemplatePage() {
  const router = useRouter();
  const [name, setName] = useState("New template");
  const [key, setKey] = useState("new_template");
  const [channel, setChannel] = useState<Channel>("email");
  const [category, setCategory] = useState<Category>("transactional");
  const [locale, setLocale] = useState("en-IN");

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
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Compliance score against rendered text (for any channel)
  const previewText = useMemo(() => {
    if (channel === "email") {
      if (emailBody.mode === "html") return emailBody.html ?? "";
      return [emailBody.subject, emailBody.preheader, ...(emailBody.blocks ?? []).map((b: any) => (b.text || b.title || b.subtitle || b.html || b.label || ""))]
        .filter(Boolean)
        .join("\n");
    }
    if (channel === "whatsapp") return waText;
    return smsText;
  }, [channel, emailBody, waText, smsText]);

  const compliance = useMemo(
    () =>
      runComplianceChecks({
        channel,
        category,
        tenant: { legalName: "Demo Wealth Advisors", arn: "123456", principalEuin: "E123456", riaRegistered: false },
        text: previewText,
        subject: channel === "email" ? emailBody.subject : undefined,
        dltTemplateId: channel === "sms" ? dltId : undefined,
        whatsappSessionActive: false,
        hasMarketingConsent: true,
      }),
    [previewText, emailBody.subject, channel, category, dltId]
  );

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
        channel,
        category,
        locale,
        body,
        variables: [],
      };
      const r = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSavedId(data.id);
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
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
            className="text-xs font-mono text-muted-foreground bg-transparent border-none outline-none mt-1"
            placeholder="template_key"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={() => save({ submitForApproval: false })} disabled={saving} className="btn-secondary text-sm">
            <Save className="size-4" /> Save draft
          </button>
          <button
            disabled={compliance.blocked || saving}
            onClick={() => save({ submitForApproval: true })}
            className="btn-primary text-sm disabled:opacity-50"
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
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="input-base w-full">
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
          </select>
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="input-base w-full">
            <option value="transactional">Transactional</option>
            <option value="utility">Utility</option>
            <option value="marketing">Marketing</option>
            <option value="authentication">Authentication</option>
          </select>
        </Field>
        <Field label="Locale">
          <select value={locale} onChange={(e) => setLocale(e.target.value)} className="input-base w-full">
            <option value="en-IN">English (India)</option>
            <option value="hi-IN">Hindi</option>
            <option value="gu-IN">Gujarati</option>
            <option value="mr-IN">Marathi</option>
          </select>
        </Field>
      </div>

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

      {/* Body editor — per channel */}
      {channel === "email" && (
        <EmailDesigner value={emailBody} onChange={setEmailBody} tenant={undefined} />
      )}

      {channel === "whatsapp" && (
        <div className="card-surface p-5 space-y-3">
          <Field label="Body">
            <textarea
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
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              rows={5}
              className="input-base font-mono w-full"
            />
          </Field>
          <div className="text-xs text-muted-foreground">{smsText.length} characters · {Math.ceil(smsText.length / 160)} SMS part(s)</div>
        </div>
      )}
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
