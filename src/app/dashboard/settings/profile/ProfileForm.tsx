"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";

export default function ProfileForm({
  initialName,
  initialPhone,
}: {
  initialName: string;
  initialPhone: string;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function saveProfile() {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setProfileMsg({ kind: "err", text: data?.error ?? "Could not save" });
      else setProfileMsg({ kind: "ok", text: "Profile updated." });
    } catch {
      setProfileMsg({ kind: "err", text: "Network error" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    setPwMsg(null);
    if (newPw.length < 8) return setPwMsg({ kind: "err", text: "New password must be at least 8 characters" });
    if (newPw !== confirmPw) return setPwMsg({ kind: "err", text: "Passwords don't match" });
    setSavingPw(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) setPwMsg({ kind: "err", text: data?.error ?? "Could not change password" });
      else {
        setPwMsg({ kind: "ok", text: "Password changed." });
        setCurPw(""); setNewPw(""); setConfirmPw("");
      }
    } catch {
      setPwMsg({ kind: "err", text: "Network error" });
    } finally {
      setSavingPw(false);
    }
  }

  const field = "mt-1 w-full rounded-md border px-3 py-2 text-sm bg-background";
  const label = "text-xs font-medium text-muted-foreground";

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {/* Profile */}
      <div className="border rounded-lg bg-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Your details</h3>
        <div>
          <label className={label}>Full name</label>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={label}>Phone</label>
          <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </div>
        <button
          onClick={saveProfile}
          disabled={savingProfile || name.trim().length < 2}
          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {savingProfile && <Loader2 className="size-3.5 animate-spin" />} Save details
        </button>
        {profileMsg && (
          <p className={`text-sm ${profileMsg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
            {profileMsg.kind === "ok" && <Check className="size-3.5 inline mr-1" />}{profileMsg.text}
          </p>
        )}
      </div>

      {/* Password */}
      <div className="border rounded-lg bg-card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Change password</h3>
        <div>
          <label className={label}>Current password</label>
          <input type="password" autoComplete="current-password" className={field} value={curPw} onChange={(e) => setCurPw(e.target.value)} />
        </div>
        <div>
          <label className={label}>New password</label>
          <input type="password" autoComplete="new-password" className={field} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </div>
        <div>
          <label className={label}>Confirm new password</label>
          <input type="password" autoComplete="new-password" className={field} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
        </div>
        <button
          onClick={changePassword}
          disabled={savingPw || !curPw || !newPw}
          className="text-sm px-4 py-2 rounded-md border hover:bg-accent disabled:opacity-50 inline-flex items-center gap-2"
        >
          {savingPw && <Loader2 className="size-3.5 animate-spin" />} Update password
        </button>
        {pwMsg && (
          <p className={`text-sm ${pwMsg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{pwMsg.text}</p>
        )}
      </div>
    </div>
  );
}
