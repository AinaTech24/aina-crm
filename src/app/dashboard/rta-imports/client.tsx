"use client";

/**
 * Client-side bits of the RTA imports page — the upload button + the
 * dialog. Kept separate so the server page stays a pure React Server
 * Component.
 */
import { useState } from "react";
import { Upload } from "lucide-react";
import { UploadDialog } from "@/components/rta/UploadDialog";

export function RtaUploadButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        <Upload className="size-4" /> Upload RTA file
      </button>
      <UploadDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
