"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [firmName, setFirmName] = useState("");
  const [arn, setArn] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firmName, arn, ownerName, ownerEmail, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.detail ? `${j.error ?? "Signup failed"} — ${j.detail}` : j.error ?? "Signup failed");
        return;
      }
      router.push("/dashboard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-2 font-semibold mb-8">
          <div className="size-7 rounded bg-primary text-primary-foreground grid place-items-center">M</div>
          <span>MFD Platform</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Create your firm's workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">14-day free trial. No card required.</p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <Row label="Firm name" value={firmName} setValue={setFirmName} />
          <Row label="ARN" value={arn} setValue={setArn} placeholder="ARN-12345" />
          <Row label="Your name" value={ownerName} setValue={setOwnerName} />
          <Row label="Work email" value={ownerEmail} setValue={setOwnerEmail} type="email" autoComplete="email" />
          <Row label="Password (8+ chars)" value={password} setValue={setPassword} type="password" autoComplete="new-password" />
          {err && <div className="text-sm text-rose-600">{err}</div>}
          <button
            disabled={busy}
            className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  setValue,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      />
    </div>
  );
}
