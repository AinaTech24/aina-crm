"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Settings, ShieldCheck, Building2, HelpCircle, LogOut, ChevronDown, Loader2 } from "lucide-react";

/**
 * Header profile control. Opens on hover OR click and exposes account links +
 * Log out. Closes on outside-click or when the pointer leaves (small grace
 * delay so moving from the avatar into the menu doesn't dismiss it).
 */
export function ProfileMenu({
  name,
  email,
  roleLabel,
  initials,
}: {
  name: string;
  email?: string;
  roleLabel: string;
  initials: string;
}) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };

  async function logout() {
    if (!window.confirm("Are you sure you want to log out?")) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* clear-cookie is best-effort; still navigate away */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={ref} className="relative" onMouseEnter={openNow} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-secondary/70 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="size-9 rounded-full brand-gradient text-white grid place-items-center text-xs font-bold shadow-md ring-2 ring-white">
          {initials}
        </span>
        <ChevronDown
          className={`size-3.5 text-muted-foreground transition-transform duration-200 hidden sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 z-50 origin-top-right animate-scale-in">
          <div className="card-elevated overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-secondary/30">
              <div className="text-sm font-semibold truncate">{name}</div>
              <div className="text-xs text-muted-foreground truncate">{email || roleLabel}</div>
            </div>
            <div className="p-1.5">
              <MenuLink href="/dashboard/settings/security" icon={ShieldCheck} label="Account & security" onClick={() => setOpen(false)} />
              <MenuLink href="/dashboard/settings" icon={Settings} label="Settings" onClick={() => setOpen(false)} />
              <MenuLink href="/dashboard/settings/firm-profile" icon={Building2} label="Firm profile" onClick={() => setOpen(false)} />
              <MenuLink href="/dashboard/help" icon={HelpCircle} label="Help & glossary" onClick={() => setOpen(false)} />
            </div>
            <div className="border-t border-border p-1.5">
              <button
                type="button"
                onClick={logout}
                disabled={loggingOut}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
              >
                {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: any;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground/80 hover:bg-secondary hover:text-foreground transition-colors"
    >
      <Icon className="size-4 text-muted-foreground" /> {label}
    </Link>
  );
}
