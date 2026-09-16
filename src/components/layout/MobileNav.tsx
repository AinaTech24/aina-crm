"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

/** Radix provides the focus trap, focus restoration, scroll lock and inert background. */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const close = () => { if (wide.matches) setOpen(false); };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <button type="button" className="lg:hidden size-9 rounded-lg bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground grid place-items-center transition-colors" aria-label="Open navigation menu"><Menu className="size-5" /></button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[90] bg-foreground/40 animate-fade-in" />
      <Dialog.Content aria-describedby={undefined} className="fixed left-0 top-0 z-[91] h-dvh w-72 max-w-[85vw] bg-card border-r border-border/70 shadow-2xl flex flex-col animate-fade-in">
        <Dialog.Title className="sr-only">Main navigation</Dialog.Title>
        <Dialog.Close className="absolute top-3 right-3 z-10 size-11 rounded-lg bg-foreground/10 hover:bg-foreground/20 text-foreground grid place-items-center" aria-label="Close menu"><X className="size-4" /></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
