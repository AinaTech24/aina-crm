import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { contentPosts, campaigns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { EditContentPostForm } from "./EditContentPostForm";

export const dynamic = "force-dynamic";

export default async function EditContentPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const post = (await tx.select().from(contentPosts).where(eq(contentPosts.id, id)).limit(1))[0];
    if (!post) return null;

    const campaignsList = await tx.select().from(campaigns).orderBy(desc(campaigns.name));

    return { post, campaigns: campaignsList };
  });

  if (!data) {
    notFound();
  }

  return (
    <div className="max-w-4xl mx-auto py-2">
      <EditContentPostForm initialPost={data.post} campaigns={data.campaigns} />
    </div>
  );
}
