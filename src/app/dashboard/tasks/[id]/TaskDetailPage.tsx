"use client";

import { useRouter } from "next/navigation";
import { TaskDetailDrawer } from "../TaskDetailDrawer";

/**
 * The task editor as a page. Close / Save / Cancel task return to wherever the
 * user came from (the list keeps its filters that way), or to the task list
 * when the page was opened directly from a link.
 */
export function TaskDetailPage({
  task,
  currentUserId,
  canManageAll,
}: {
  task: React.ComponentProps<typeof TaskDetailDrawer>["task"];
  currentUserId: string;
  canManageAll: boolean;
}) {
  const router = useRouter();

  function back() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/dashboard/tasks");
  }

  return (
    <TaskDetailDrawer
      variant="page"
      task={task}
      currentUserId={currentUserId}
      canManageAll={canManageAll}
      onClose={back}
      onUpdate={() => router.refresh()}
    />
  );
}
