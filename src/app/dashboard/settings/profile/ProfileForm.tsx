"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Camera, Trash2 } from "lucide-react";

export default function ProfileForm({
  initialName,
  initialPhone,
  initialAvatarUrl,
}: {
  initialName: string;
  initialPhone: string;
  initialAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string>(initialAvatarUrl ?? "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const initials =
    (name || "?")
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  async function saveAvatarUrl(url: string) {
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Could not save photo");
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return setAvatarMsg({ kind: "err", text: "Please choose an image file." });
    }
    if (file.size > 5 * 1024 * 1024) {
      return setAvatarMsg({ kind: "err", text: "Image must be under 5 MB." });
    }
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      // 1. presigned PUT URL (S3 or local fallback)
      const presign = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/png",
          kind: "general",
        }),
      });
      const pj = await presign.json();
      if (!presign.ok) throw new Error(pj.error ?? "Could not start upload");

      // 2. upload the bytes
      const put = await fetch(pj.url, {
        method: "PUT",
        headers: { "content-type": file.type || "image/png" },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed");

      // 3. derive the URL to store/display (local app path or S3/CDN)
      const isLocal = pj.url.startsWith("/");
      const base = (process.env.NEXT_PUBLIC_S3_PUBLIC_URL ?? "").replace(/\/+$/, "");
      const publicUrl = isLocal
        ? pj.url.split("?")[0]
        : base
          ? `${base}/${pj.key}`
          : pj.url.split("?")[0];

      await saveAvatarUrl(publicUrl);
      setAvatarUrl(publicUrl);
      setAvatarMsg({ kind: "ok", text: "Photo updated." });
      router.refresh(); // refresh the navbar avatar
    } catch (err: any) {
      setAvatarMsg({ kind: "err", text: err.message ?? "Upload failed" });
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    setUploadingAvatar(true);
    setAvatarMsg(null);
    try {
      await saveAvatarUrl("");
      setAvatarUrl("");
      setAvatarMsg({ kind: "ok", text: "Photo removed." });
      router.refresh();
    } catch (err: any) {
      setAvatarMsg({ kind: "err", text: err.message ?? "Could not remove" });
    } finally {
      setUploadingAvatar(false);
    }
  }

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
      else {
        setProfileMsg({ kind: "ok", text: "Profile updated." });
        router.refresh();
      }
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
    <div className="space-y-6">
      {/* Profile photo */}
      <div className="border rounded-lg bg-card p-5">
        <h3 className="font-semibold text-sm mb-3">Profile photo</h3>
        <div className="flex items-center gap-5">
          <div className="relative">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Profile photo"
                className="size-20 rounded-full object-cover ring-2 ring-border shadow-sm"
              />
            ) : (
              <div className="size-20 rounded-full brand-gradient text-white grid place-items-center text-2xl font-bold ring-2 ring-white shadow-sm">
                {initials}
              </div>
            )}
            {uploadingAvatar && (
              <div className="absolute inset-0 rounded-full bg-black/40 grid place-items-center">
                <Loader2 className="size-5 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingAvatar}
                className="text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Camera className="size-3.5" /> {avatarUrl ? "Change photo" : "Upload photo"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  disabled={uploadingAvatar}
                  className="text-sm px-3 py-2 rounded-md border hover:bg-accent disabled:opacity-50 inline-flex items-center gap-2 text-muted-foreground"
                >
                  <Trash2 className="size-3.5" /> Remove
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">JPG, PNG or GIF · up to 5 MB · shown in the top-right menu.</p>
            {avatarMsg && (
              <p className={`text-xs ${avatarMsg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
                {avatarMsg.kind === "ok" && <Check className="size-3 inline mr-1" />}{avatarMsg.text}
              </p>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
        </div>
      </div>

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
    </div>
  );
}
