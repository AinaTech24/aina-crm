/**
 * The pencil on the client page's "Client details" card. It opens the
 * full-page editor (/dashboard/investors/[id]/edit) — the firm asked for a
 * full page instead of the old pop-up wizard. Plain module: a server page
 * renders it without shipping the form.
 */

import Link from "next/link";
import { Pencil } from "lucide-react";

export function EditClientDetailsLink({ investorId }: { investorId: string }) {
  return (
    <Link
      href={`/dashboard/investors/${investorId}/edit`}
      className="btn-icon border border-border bg-secondary/40 hover:bg-secondary"
      title="Edit client details"
      aria-label="Edit client details"
    >
      <Pencil className="size-4" />
    </Link>
  );
}
