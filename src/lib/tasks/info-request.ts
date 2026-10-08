/**
 * "Need information" on a task — the assignee asks someone (by default whoever
 * assigned the task) a question they need answered to finish it.
 *
 * While a request is open the task is `blocked` and `tasks.meta.infoRequest`
 * says who is waiting on whom for what. Answering clears it, puts the task back
 * to the status it had, and keeps the exchange in `meta.infoHistory`. Both
 * sides also land in the task's comment thread, so the conversation reads in
 * one place. API: /api/tasks/[id]/info-request.
 */

export type InfoRequest = {
  question: string;
  askedById: string;
  askedByName?: string | null;
  askedToId: string;
  askedToName?: string | null;
  askedAt: string;
  /** The status to return to once answered. */
  prevStatus: string;
};

export type InfoRequestRecord = InfoRequest & { answer: string; answeredById: string; answeredAt: string };

/** The open request on a task, if any. */
export function openInfoRequest(meta: unknown): InfoRequest | null {
  const m = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null;
  const r = m?.infoRequest as InfoRequest | undefined;
  return r && typeof r.askedToId === "string" && typeof r.question === "string" ? r : null;
}
