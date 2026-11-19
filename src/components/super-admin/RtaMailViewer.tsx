"use client";

/**
 * The whole inbound mail, as a mail client shows it: subject, from / to / cc /
 * date, the attachments (each downloadable, plus the .eml), then the body.
 *
 * The HTML body arrives from the server already wrapped in a page whose
 * Content-Security-Policy blocks scripts and every remote load, and is shown
 * in an iframe sandboxed with no scripts and no same-origin — a registrar's
 * mail can never run code in Aina Admin or call home.
 */

import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Paperclip, X } from "lucide-react";
import { DownloadButton } from "@/components/common/SecureLinkButtons";
import type { MailAddress, MailView } from "@/lib/rta/inbound-archive";

const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const who = (list: MailAddress[]) => list.map((a) => (a.name && a.address ? `${a.name} <${a.address}>` : a.address ?? a.name ?? "")).join(", ");
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export function RtaMailViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; mail?: MailView; reason?: string; error?: string }>({ loading: true });

  useEffect(() => {
    let live = true;
    fetch(`/api/super-admin/rta-inbound-mail/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) setState({ loading: false, error: j.error ?? "Could not open the mail" });
        else if (!j.available) setState({ loading: false, reason: j.reason });
        else setState({ loading: false, mail: j.mail });
      })
      .catch(() => live && setState({ loading: false, error: "Could not open the mail" }));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const m = state.mail;
  const files = m?.attachments.filter((a) => !a.inline) ?? [];
  const base = `/api/super-admin/rta-inbound-mail/${id}/download`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Mail" onClick={onClose}>
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <h2 className="min-w-0 flex-1 text-lg font-semibold break-words">{m?.subject || (state.loading ? "Opening…" : "(no subject)")}</h2>
          {m && (
            <DownloadButton url={`${base}?eml=1`} className="btn-secondary" title="The whole mail as an .eml file — opens in Outlook or Thunderbird">
              <Download className="size-4" /> .eml
            </DownloadButton>
          )}
          <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>

        {state.loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Opening the mail…
          </div>
        )}
        {!state.loading && !m && (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">{state.reason ?? state.error}</div>
        )}

        {m && (
          <>
            <dl className="space-y-1 border-b px-5 py-3 text-sm">
              {([
                ["From", who(m.from) || "—"],
                ["To", who(m.to) || "—"],
                ...(m.cc.length ? [["Cc", who(m.cc)]] : []),
                ["Date", when(m.date)],
              ] as Array<[string, string]>).map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="w-12 shrink-0 text-muted-foreground">{k}</dt>
                  <dd className={`min-w-0 break-words ${k === "From" ? "font-medium" : ""}`}>{v}</dd>
                </div>
              ))}
            </dl>

            {files.length > 0 && (
              <div className="border-b px-5 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Paperclip className="size-3.5" /> {files.length} attachment{files.length === 1 ? "" : "s"}
                </div>
                <ul className="flex flex-wrap gap-2">
                  {files.map((a) => (
                    <li key={a.index}>
                      <DownloadButton
                        url={`${base}?i=${a.index}`}
                        filename={a.filename}
                        className="flex max-w-xs items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-accent"
                        title={`Download ${a.filename}`}
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{a.filename}</span>
                          <span className="block text-2xs text-muted-foreground">{fmtSize(a.size)}</span>
                        </span>
                        <Download className="size-4 shrink-0 text-muted-foreground" />
                      </DownloadButton>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {m.blockedRemote && (
              <div className="border-b bg-secondary/60 px-5 py-2 text-xs text-muted-foreground">Remote images in this mail are not loaded.</div>
            )}

            <div className="min-h-0 flex-1 overflow-auto bg-white">
              {m.htmlDoc ? (
                <iframe title="Mail body" srcDoc={m.htmlDoc} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-full min-h-96 w-full border-0" />
              ) : (
                <pre className="whitespace-pre-wrap break-words p-5 text-sm text-gray-800">{m.text || "(empty message)"}</pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
