/**
 * Notifications — the in-app bell. GET /api/notifications (user-scoped, RLS
 * limits each user to their own rows) + POST /api/notifications/mark-read.
 * The server also synthesises live ones (e.g. "3 client birthdays today").
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface AppNotification {
  id: string;
  kind: string | null;
  title: string | null;
  body: string | null;
  /** Server field is `linkUrl` (a web /dashboard/... path), not `href`. */
  linkUrl: string | null;
  severity: string | null;
  readAt: string | null;
  createdAt: string | null;
  [k: string]: any;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount?: number;
  [k: string]: any;
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ["notifications", unreadOnly],
    queryFn: () => api.get<NotificationsResponse>("/api/notifications", unreadOnly ? { unreadOnly: "1" } : undefined),
    staleTime: 60_000,
    // The bell should reflect reality without the user pulling to refresh.
    refetchInterval: 5 * 60_000,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server prepends a live, synthetic "N client birthdays today" reminder
 *  (id "birthday-today", never stored). It can't be marked read — the mark-read
 *  route only takes uuids, so tapping it used to toast "invalid body" — and it is
 *  not counted in the server's unread badge. */
export const isStored = (n: AppNotification) => typeof n.id === "string" && UUID.test(n.id);

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ids?: string[]; all?: boolean }) => {
      const ids = v.ids?.filter((id) => UUID.test(id));
      if (!v.all && !ids?.length) return Promise.resolve({ ok: true });
      return api.post("/api/notifications/mark-read", v.all ? { all: true } : { ids });
    },
    // Marking read is a background nicety; a failure must not interrupt the tap.
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/** Unread = a stored notification nobody has opened (the pinned birthday
 *  reminder is never "unread", or the badge and "Mark all read" never clear). */
export const isUnread = (n: AppNotification) => !n.readAt && isStored(n);

/** The badge figure: the server's own count (it sees past the 50-row page). */
export const unreadCount = (data?: NotificationsResponse) =>
  typeof data?.unreadCount === "number" ? data.unreadCount : (data?.notifications ?? []).filter(isUnread).length;
