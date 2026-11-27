"use client";

/** Edit and Delete on a courier's page. */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { useToast } from "@/components/ui/Toast";

export function CourierActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete ${name}?`,
      message: "It is removed from the Couriers list.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/couriers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not delete the courier.");
      toast.success("Courier deleted.");
      router.push("/dashboard/couriers");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the courier.");
      setDeleting(false);
    }
  };

  return (
    <>
      <Button variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} loading={deleting} onClick={remove}>Delete</Button>
      <Link href={`/dashboard/couriers/${id}/edit`} className={buttonClass("primary")}>
        <Pencil className="size-4" aria-hidden /> Edit
      </Link>
    </>
  );
}
