import { api } from "@/api/client";
import type { Notification, UnreadCount } from "@/api/types";

/**
 * Notification endpoints. All four are authorised server-side: the handler
 * compares req.auth.userId with :userId and answers 403 otherwise, so the
 * caller's own id is the only id that ever works.
 *
 *   GET   /api/notifications/:userId               → Notification[] (limit 50)
 *   GET   /api/notifications/:userId/unread-count  → { count }
 *   PATCH /api/notifications/:id/read              → { ok: true }
 *   PATCH /api/notifications/user/:userId/read-all → { ok: true }
 *
 * Unlike GET /api/messages/:fromId/:toId, none of these mutate read state as a
 * side effect of reading — the list can be fetched freely.
 */

export function fetchNotifications(userId: number, signal?: AbortSignal) {
  return api.get<Notification[]>(`/api/notifications/${userId}`, { signal });
}

export function fetchUnreadCount(userId: number, signal?: AbortSignal) {
  return api.get<UnreadCount>(`/api/notifications/${userId}/unread-count`, { signal });
}

export function markNotificationRead(notificationId: number) {
  return api.patch<{ ok: boolean }>(`/api/notifications/${notificationId}/read`);
}

export function markAllNotificationsRead(userId: number) {
  return api.patch<{ ok: boolean }>(`/api/notifications/user/${userId}/read-all`);
}
