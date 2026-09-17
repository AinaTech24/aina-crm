import type { WorkflowGraph } from "./schema";

/** An explicitly selected branch can never fall through to another branch. */
export function pickNextNode(graph: WorkflowGraph, fromId: string, handle?: string | null): string | null {
  const edges = graph.edges.filter((edge) => edge.source === fromId);
  if (handle) {
    const matches = edges.filter((edge) => edge.sourceHandle === handle);
    if (matches.length !== 1) throw new Error(`Node ${fromId} requires exactly one '${handle}' edge`);
    return matches[0].target;
  }
  const edgesWithoutHandle = edges.filter((edge) => !edge.sourceHandle);
  if (edgesWithoutHandle.length > 1 || (edges.length && !edgesWithoutHandle.length)) {
    throw new Error(`Node ${fromId} has ambiguous outgoing edges`);
  }
  return edgesWithoutHandle[0]?.target ?? null;
}

export function pauseResumeHandle(waitPredicate: unknown): string {
  return waitPredicate ? "timeout" : "__continue";
}
