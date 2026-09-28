/**
 * At most N transactions in flight for ONE dashboard render.
 *
 * The desk and the branch command centre stream a dozen-plus Suspense bands,
 * and each band runs its loaders in its own `withTenant` transaction — one
 * pooled connection per band. Unbounded, a single render holds ~17 of the
 * pool's 20 connections at once; three RMs opening their desk together
 * starve every other request in the process, which then fails at the pool's
 * connect timeout. Capped, a render holds a few connections for a moment and
 * the bands still paint in page order, because they queue in the order React
 * starts them.
 */
export function runLimit(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resume) => waiting.push(resume));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
