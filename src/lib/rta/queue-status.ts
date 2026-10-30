/**
 * How busy the RTA import worker is, for the RTA File Imports page.
 *
 * One worker reads ONE file at a time for every firm (the files are huge and the
 * parse is memory-heavy). A firm's upload therefore waits in a line shared with
 * every other firm's, and with the automatic mailbox imports — and from the
 * firm's side a file in that line looks exactly like one that never uploaded.
 * The page now says so, with the numbers.
 */

import { Q } from "@/workers/queues";

export type RtaQueueDepth = {
  /** Files being read right now (0 or 1). */
  active: number;
  /** Jobs waiting for their turn, all firms, manual and automatic. */
  waiting: number;
};

/** Null when the queue cannot be read quickly: the page just leaves the line out. */
export async function rtaQueueDepth(timeoutMs = 1500): Promise<RtaQueueDepth | null> {
  try {
    const counts = await Promise.race([
      Q.rtaImport().getJobCounts("active", "wait", "prioritized", "delayed"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("queue timeout")), timeoutMs)),
    ]);
    return {
      active: Number(counts.active ?? 0),
      // A delayed job is a re-run waiting out its pause; it is not ahead of anyone.
      waiting: Number(counts.wait ?? 0) + Number(counts.prioritized ?? 0),
    };
  } catch {
    return null;
  }
}
