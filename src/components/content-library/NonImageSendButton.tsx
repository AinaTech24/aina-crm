"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { SendToClientDrawer } from "./SendToClientDrawer";

export function NonImageSendButton({
  assetId,
  assetTitle,
  assetType,
  assetFileUrl,
}: {
  assetId: string;
  assetTitle: string;
  assetType: string;
  assetFileUrl: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-secondary hover:bg-secondary/80 border text-secondary-foreground px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
      >
        <Send className="size-4" /> Send to Client
      </button>
      <SendToClientDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        assetId={assetId}
        assetTitle={assetTitle}
        assetType={assetType}
        assetFileUrl={assetFileUrl}
      />
    </>
  );
}
