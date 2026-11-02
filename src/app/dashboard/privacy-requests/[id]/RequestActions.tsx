"use client";

/**
 * What the compliance officer does with an open request, in order: check who
 * is asking, act (open the data summary, correct the record, erase), then
 * close it with what was done. Erasing is irreversible, so it asks first and
 * says what the law makes the firm keep.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { buttonClass } from "@/components/ui/button-class";
import { Card, CardHeader } from "@/components/ui/Card";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

type Verdict = { kind: "erase" } | { kind: "blocked"; reason: string } | { kind: "retain"; reason: string } | null;

export function RequestActions({
  id,
  type,
  canEdit,
  verified,
  hasSubject,
  erasureResult,
  verdict,
}: {
  id: string;
  type: string;
  canEdit: boolean;
  verified: boolean;
  hasSubject: boolean;
  erasureResult: string | null;
  verdict: Verdict;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");

  async function call(label: string, url: string, init: RequestInit, done: string) {
    setBusy(label);
    try {
      const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not do that");
      notify.success(done);
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not do that");
    } finally {
      setBusy(null);
    }
  }

  async function erase() {
    const keep = verdict?.kind === "retain";
    const ok = await confirmDialog({
      title: keep ? "Stop marketing and keep the regulated records?" : "Erase this person's data?",
      message: keep
        ? "The law requires the firm to keep their KYC and transaction records for now. Marketing to them stops today; erase the rest when the retention period ends."
        : "Their details, messages, notes and documents are removed for good. This cannot be undone.",
      confirmLabel: keep ? "Stop marketing" : "Erase",
      tone: "danger",
    });
    if (!ok) return;
    await call("erase", `/api/privacy-requests/${id}/erase`, { method: "POST" }, keep ? "Marketing stopped; records kept as the law requires." : "Erased.");
  }

  if (!canEdit) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Check who is asking" />
        <div className="px-5 pb-5 text-sm space-y-3">
          {verified ? (
            <p>Identity checked.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                Before sharing or erasing anything, confirm the request comes from the person — for example a call back on the mobile number on record, or a match on PAN and date of birth.
              </p>
              <Button variant="secondary" onClick={() => call("verify", `/api/privacy-requests/${id}`, { method: "PATCH", body: JSON.stringify({ action: "verify" }) }, "Identity marked as checked.")} disabled={!!busy}>
                {busy === "verify" ? "Saving…" : "Identity checked"}
              </Button>
            </>
          )}
        </div>
      </Card>

      {hasSubject && (
        <Card>
          <CardHeader title="2. Act on it" />
          <div className="px-5 pb-5 text-sm space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/dashboard/privacy-requests/${id}/summary`} className={buttonClass("secondary")}>
                Data summary
              </Link>
              <span className="text-muted-foreground">What the firm holds about them — print or save it as a PDF to send.</span>
            </div>
            {type === "erasure" && (
              <div className="rounded-lg border border-border p-4 space-y-3">
                {erasureResult?.startsWith("retained_until:") ? (
                  <p>Marketing stopped. Their regulated records are kept until {erasureResult.replace("retained_until:", "")}.</p>
                ) : verdict?.kind === "blocked" ? (
                  <p className="text-destructive">{verdict.reason}</p>
                ) : (
                  <>
                    <p className={verdict?.kind === "retain" ? "" : "text-muted-foreground"}>
                      {verdict?.kind === "retain" ? verdict.reason : "Nothing the law requires the firm to keep — their data can be erased."}
                    </p>
                    <Button variant="secondary" onClick={erase} disabled={!verified || !!busy} title={verified ? undefined : "Check their identity first"}>
                      {busy === "erase" ? "Working…" : verdict?.kind === "retain" ? "Stop marketing, keep records" : "Erase their data"}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={hasSubject ? "3. Close the request" : "Close the request"} />
        <div className="px-5 pb-5 space-y-3">
          <label htmlFor="pr-outcome" className="block text-sm font-medium">What was done</label>
          <textarea
            id="pr-outcome"
            rows={4}
            className="input-base w-full"
            maxLength={4000}
            placeholder="e.g. Sent the data summary to their registered email on 3 Nov."
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!!busy || outcome.trim().length < 5}
              onClick={() => call("close", `/api/privacy-requests/${id}`, { method: "PATCH", body: JSON.stringify({ action: "close", status: "completed", outcome }) }, "Request closed.")}
            >
              {busy === "close" ? "Saving…" : "Mark answered"}
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy || outcome.trim().length < 5}
              onClick={() => call("close", `/api/privacy-requests/${id}`, { method: "PATCH", body: JSON.stringify({ action: "close", status: "rejected", outcome }) }, "Request closed as refused.")}
            >
              Refuse with reason
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
