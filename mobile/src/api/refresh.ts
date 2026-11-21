/**
 * One in-flight session renewal per token. The cold start renews in the
 * background (state/session.ts) while the first screens already make requests,
 * and a 401 on any of them renews too (api/client.ts) — both go through here so
 * the server sees a single /api/auth/refresh for the same token.
 */

import { refreshToken } from "../api";

const inflight = new Map<string, Promise<string | null>>();

export function sharedRefresh(token: string): Promise<string | null> {
  let p = inflight.get(token);
  if (!p) {
    p = refreshToken(token).finally(() => inflight.delete(token));
    inflight.set(token, p);
  }
  return p;
}
