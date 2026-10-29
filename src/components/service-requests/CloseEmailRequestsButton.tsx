"use client";

/**
 * "Close email requests" on Service Requests — closes, in one go, the tickets an
 * email once opened (before 2026-10-16) that nobody has picked up. Shown only
 * while there are some, and only to someone who may manage requests.
 * GET / POST /api/service-requests/email-intake.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MailX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";

export function CloseEmailRequestsButton() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/service-requests/email-intake", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j && Number.isFinite(j.count)) setCount(Number(j.count));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (count <= 0) return null;

  async function closeAll() {
    const yes = await confirmDialog({
      title: `Close ${count} email request${count === 1 ? "" : "s"}?`,
      message:
        "These were opened automatically from incoming email, and nobody has assigned, answered or worked on them. " +
        "They are closed, not deleted, and stay in the register under Closed. A request a person has touched is never closed here.",
      confirmLabel: "Close them",
      tone: "danger",
    });
    if (!yes) return;
    setBusy(true);
    try {
      const res = await fetch("/api/service-requests/email-intake", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Couldn't close them. Please try again.");
        return;
      }
      notify.success(`Closed ${j.closed ?? 0} email request${j.closed === 1 ? "" : "s"}.`);
      setCount(0);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" loading={busy} icon={<MailX className="size-4" aria-hidden />} onClick={closeAll}>
      Close email requests ({count})
    </Button>
  );
}
