"use client";

/**
 * On the profile of a team member whose login was created with a username: add (or correct) their
 * email address, so password reset and CRM emails can reach them. The username keeps working.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function LoginEmailCard({ userId, username, email }: { userId: string; username: string; email: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const next = value.trim().toLowerCase();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${userId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? `Failed (${res.status})`, "Email not saved");
        return;
      }
      toast.success("Email saved. They can sign in with it or with their username.");
      router.refresh();
    } catch {
      toast.error("Network error. Try again.", "Email not saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card-surface p-5">
      <h2 className="section-title flex items-center gap-2">
        <Mail className="size-4 text-muted-foreground" aria-hidden /> {email ? "Sign-in email" : "Add an email address"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {email
          ? `They sign in with this address or with the username “${username}”.`
          : `They sign in with the username “${username}”. Add an email so they can reset a forgotten password and receive CRM emails — the username keeps working.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Email address"
          placeholder="name@yourfirm.com"
          maxLength={200}
          className="input-base min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" loading={busy} disabled={!next || next === (email ?? "").toLowerCase()}>
          {email ? "Change email" : "Save email"}
        </Button>
      </div>
      <p className="mt-2 text-2xs text-muted-foreground">Check the address carefully: a password reset link sent there opens this login.</p>
    </form>
  );
}
