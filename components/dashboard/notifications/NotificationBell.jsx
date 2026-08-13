"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useNotificationRealtime } from "@/lib/realtime/use-notification-realtime";
import NotificationItem from "./NotificationItem";
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotificationAction,
} from "@/actions/notifications/notifications";

function UnreadBadge({ count }) {
  if (!count || count <= 0) return null;
  const display = count > 99 ? "99+" : String(count);
  return (
    <span className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white shadow-sm ring-2 ring-white dark:ring-gray-900">
      {display}
    </span>
  );
}

export default function NotificationBell({ user }) {
  const userId = user?.id;
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState([]);
  const [hasNext, setHasNext] = useState(false);
  const [endCursor, setEndCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);

  const containerRef = useRef(null);
  useClickOutside(containerRef, () => open && setOpen(false));

  const fetchUnreadCount = useCallback(async () => {
    const res = await getUnreadCount();
    if (res?.success && typeof res.data?.count === "number") {
      setUnreadCount(res.data.count);
    }
  }, []);

  const fetchLatestPage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUserNotifications({ pageSize: 8 });
      if (res?.success) {
        setItems(res.data.items ?? []);
        setHasNext(res.data.pageInfo?.hasNextPage ?? false);
        setEndCursor(res.data.pageInfo?.endCursor ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount().catch(() => {});
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (open) fetchLatestPage().catch(() => {});
  }, [open, fetchLatestPage]);

  const handleToggle = () => {
    setOpen((prev) => !prev);
  };

  const handleLoadMore = async () => {
    if (!endCursor || pageLoading) return;
    setPageLoading(true);
    try {
      const res = await getUserNotifications({ cursor: endCursor, pageSize: 8 });
      if (res?.success) {
        setItems((prev) => [...prev, ...(res.data.items ?? [])]);
        setHasNext(res.data.pageInfo?.hasNextPage ?? false);
        setEndCursor(res.data.pageInfo?.endCursor ?? null);
      }
    } finally {
      setPageLoading(false);
    }
  };

  const handleMarkRead = async (id) => {
    const res = await markAsRead({ notificationId: id });
    if (res?.success) {
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  };

  const handleDelete = async (id) => {
    const res = await deleteNotificationAction({ notificationId: id });
    if (res?.success) {
      setItems((prev) => {
        const item = prev.find((n) => n.id === id);
        if (item && !item.isRead) setUnreadCount((c) => Math.max(0, c - 1));
        return prev.filter((n) => n.id !== id);
      });
    }
  };

  const handleMarkAll = async () => {
    const res = await markAllAsRead();
    if (res?.success) {
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    }
  };

  const realtimeHandlers = useMemo(
    () => ({
      onCreated: ({ notification }) => {
        if (!notification) return;
        setUnreadCount((c) => c + (notification.isRead ? 0 : 1));
        setItems((prev) => {
          if (prev.some((n) => n.id === notification.id)) return prev;
          return [notification, ...prev].slice(0, 8);
        });
      },
      onRead: ({ notificationId, notification }) => {
        if (!notificationId) return;
        setItems((prev) => prev.map((n) => (n.id === notificationId ? { ...n, ...(notification ?? {}), isRead: true } : n)));
        setUnreadCount((c) => Math.max(0, c - 1));
      },
      onAllRead: () => {
        setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
      },
      onDeleted: ({ notificationId }) => {
        if (!notificationId) return;
        setItems((prev) => {
          const item = prev.find((n) => n.id === notificationId);
          if (item && !item.isRead) setUnreadCount((c) => Math.max(0, c - 1));
          return prev.filter((n) => n.id !== notificationId);
        });
      },
    }),
    []
  );

  useNotificationRealtime(userId, realtimeHandlers);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unreadCount > 0 ? `Notifications — ${unreadCount} non lues` : "Notifications"}
        className={[
          "relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900",
          "dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white",
          open
            ? "bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-white"
            : "",
        ].join(" ")}
      >
        <Bell className="h-4.5 w-4.5" strokeWidth={1.8} />
        <UnreadBadge count={unreadCount} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed left-3 right-3 top-[76px] z-50 flex max-h-[calc(100vh-92px)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-gray-900 dark:ring-white/5 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[400px] sm:max-w-[calc(100vw-2rem)]"
        >
          <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/5 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                Notifications
              </h2>
              {unreadCount > 0 && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                  {unreadCount} nouvelle{unreadCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="self-start text-[12px] font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 min-[420px]:self-auto"
              >
                Tout marquer lu
              </button>
            )}
          </div>

          <div className="min-h-[120px] flex-1 overflow-y-auto sm:max-h-[60vh]">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <div className="flex items-center gap-2 text-[13px] text-gray-500 dark:text-gray-400">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Chargement…
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5">
                  <Bell
                    className="h-6 w-6 text-gray-400 dark:text-gray-500"
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-[14px] font-medium text-gray-700 dark:text-gray-300">
                  Aucune notification
                </p>
                <p className="mt-1 text-[12.5px] text-gray-500 dark:text-gray-400">
                  Vous serez prévenu ici des nouveaux rendez-vous et mises à jour.
                </p>
              </div>
            ) : (
              <div className="py-1.5">
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    compact
                    onMarkedRead={handleMarkRead}
                    onDeleted={handleDelete}
                  />
                ))}

                {hasNext && (
                  <div className="flex items-center justify-center px-3 py-2">
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={pageLoading}
                      className="w-full rounded-lg border border-dashed border-gray-200 py-2 text-[12.5px] font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800 disabled:opacity-60 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
                    >
                      {pageLoading ? "Chargement…" : "Charger plus"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 px-3 py-2 text-center dark:border-white/5">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="block w-full rounded-lg px-3 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Voir toutes les notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
