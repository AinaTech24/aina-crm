import { redirect } from "next/navigation";

/** An old board link opens the same dashboard at its new address. */
export default async function OldBoard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/${id}`);
}
