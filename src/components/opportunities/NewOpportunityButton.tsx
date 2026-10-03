"use client";

/**
 * "New opportunity" in the Opportunities module: the client-page dialog with
 * a client picker in front of it. On success it opens the new opportunity.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { NewOpportunityDialog } from "@/components/opportunities/OpportunitiesPanel";

export function NewOpportunityButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
        New opportunity
      </Button>
      {open && (
        <NewOpportunityDialog
          initialProduct=""
          onClose={() => setOpen(false)}
          onCreated={(opp) => {
            setOpen(false);
            if (opp?.id) router.push(`/dashboard/opportunities/${opp.id}`);
            else router.refresh();
          }}
        />
      )}
    </>
  );
}
