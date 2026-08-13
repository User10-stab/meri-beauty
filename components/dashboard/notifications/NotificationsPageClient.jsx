"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Inbox, CheckSquare2, Loader2 } from "lucide-react";
import { useNotificationRealtime } from "@/lib/realtime/use-notification-realtime";
import NotificationItem from "./NotificationItem";
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotificationAction,
} from "@/actions/notifications/notifications";
import { useTranslations } from "next-intl";

function formatGroupHeader(dateIso, t) {
  const d = new Date(dateIso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const diffDays = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);

  if (diffDays === 0) return t("groupHeaders.today");
  if (diffDays === 1) return t("groupHeaders.yesterday");
  if (diffDays < 7) {
    return d.toLocaleDateString("fr-FR", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase());
  }
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).replace(/^./, (c) => c.toUpperCase());
}

function groupByDay(items) {
  const groups = [];
  let lastKey = null;
  let buffer = [];
  for (const it of items) {
    const day = new Date(it.createdAt).toISOString().slice(0, 10);
    if (day !== lastKey) {
      if (buffer.length) groups.push({ key: lastKey, items: buffer });
      lastKey = day;
      buffer = [it];
    } else {
      buffer.push(it);
    }
  }
  if (buffer.length) groups.push({ key: lastKey, items: buffer });
  return groups;
}

export default function NotificationsPageClient({ userId, initialItems, initialPageInfo }) {
  const t = useTranslations("notifications");
  const [activeFilter, setActiveFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [hasNext, setHasNext] = useState(false);
  const [endCursor, setEndCursor] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);

  const FILTERS = useMemo(
    () => [
      { key: "all", label: t("filters.all"), filterIsRead: null },
      { key: "unread", label: t("filters.unread"), filterIsRead: false },
      { key: "read", label: t("filters.read"), filterIsRead: true },
    ],
    [t]
  );

  const activeConfig = useMemo(
    () => FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0],
    [activeFilter, FILTERS]
  );

  const loadPage = useCallback(
    async ({ cursor = null, replace = false } = {}) => {
      if (replace) setInitialLoading(true);
      else setPageLoading(true);
      try {
        const res = await getUserNotifications({
          cursor,
          pageSize: 20,
          filterIsRead: activeConfig.filterIsRead,
        });
        if (res?.success) {
          const next = res.data.items ?? [];
          setItems((prev) => (replace ? next : [...prev, ...next]));
          setHasNext(res.data.pageInfo?.hasNextPage ?? false);
          setEndCursor(res.data.pageInfo?.endCursor ?? null);
        }
      } finally {
        setInitialLoading(false);
        setPageLoading(false);
      }
    },
    [activeConfig.filterIsRead]
  );

  useEffect(() => {
    loadPage({ replace: true }).catch(() => {});
  }, [loadPage]);

  const unreadCount = useMemo(
    () => items.reduce((acc, it) => acc + (it.isRead ? 0 : 1), 0),
    [items]
  );

  const handleMarkRead = async (id) => {
    const res = await markAsRead({ notificationId: id });
    if (res?.success) {
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    }
  };

  const handleDelete = async (id) => {
    const res = await deleteNotificationAction({ notificationId: id });
    if (res?.success) {
      setItems((prev) => prev.filter((n) => n.id !== id));
    }
  };

  const handleMarkAll = async () => {
    const res = await markAllAsRead();
    if (res?.success) {
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    }
  };

  const groups = useMemo(() => groupByDay(items), [items]);

  const formatGroupHeaderWithLocale = useCallback(
    (dateIso) => formatGroupHeader(dateIso, t),
    [t]
  );

  const realtimeHandlers = useMemo(
    () => ({
      onCreated: ({ notification }) => {
        if (!notification) return;
        const matchesFilter =
          activeConfig.filterIsRead === null ||
          activeConfig.filterIsRead === notification.isRead;
        if (!matchesFilter) return;
        setItems((prev) => (prev.some((n) => n.id === notification.id) ? prev : [notification, ...prev]));
      },
      onRead: ({ notificationId, notification }) => {
        if (!notificationId) return;
        setItems((prev) => {
          if (activeConfig.filterIsRead === false) {
            return prev.filter((n) => n.id !== notificationId);
          }
          return prev.map((n) => (n.id === notificationId ? { ...n, ...(notification ?? {}), isRead: true } : n));
        });
      },
      onAllRead: () => {
        setItems((prev) => {
          if (activeConfig.filterIsRead === false) return [];
          return prev.map((n) => ({ ...n, isRead: true }));
        });
      },
      onDeleted: ({ notificationId }) => {
        if (!notificationId) return;
        setItems((prev) => prev.filter((n) => n.id !== notificationId));
      },
    }),
    [activeConfig.filterIsRead]
  );

  useNotificationRealtime(userId, realtimeHandlers);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
            <Bell className="h-6 w-6 text-gray-500 dark:text-gray-400" />
            {t("title")}
          </h1>
          <p className="mt-1 text-[13.5px] text-gray-500 dark:text-gray-400">
            Suivez l'activité du salon : nouveaux rendez-vous, confirmations et annulations.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
          >
            <CheckSquare2 className="h-4 w-4" />
            {t("markAllRead")}
          </button>
        )}
      </header>

      <div className="mb-4 inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 text-[13px] dark:border-white/10 dark:bg-white/5">
        {FILTERS.map((f) => {
          const active = f.key === activeFilter;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className={[
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors",
                active
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                  : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white",
              ].join(" ")}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900">
        {initialLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex items-center gap-2 text-[13.5px] text-gray-500 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState filter={activeConfig.label} />
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.key} className="border-b border-gray-100 last:border-b-0 dark:border-white/5">
                <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50/80 px-5 py-2 text-[11.5px] font-semibold uppercase tracking-wider text-gray-500 backdrop-blur dark:border-white/5 dark:bg-gray-900/80 dark:text-gray-400">
                  {formatGroupHeaderWithLocale(group.key)}
                </div>
                <div className="py-1.5">
                  {group.items.map((n) => (
                    <NotificationItem
                      key={n.id}
                      notification={n}
                      onMarkedRead={handleMarkRead}
                      onDeleted={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="border-t border-gray-100 px-4 py-3 dark:border-white/5">
              {hasNext ? (
                <button
                  type="button"
                  onClick={() => loadPage({ cursor: endCursor })}
                  disabled={pageLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800 disabled:opacity-60 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
                >
                  {pageLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("loading")}
                    </>
                  ) : (
                    t("loadMore")
                  )}
                </button>
              ) : (
                <p className="py-1 text-center text-[12.5px] text-gray-400 dark:text-gray-500">
                  {t("endOfHistory")}
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function EmptyState({ filter }) {
  const t = useTranslations("notifications");
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/5">
        <Inbox className="h-8 w-8 text-gray-400 dark:text-gray-500" strokeWidth={1.6} />
      </div>
      <h3 className="text-[16px] font-semibold text-gray-800 dark:text-gray-200">
        {t("empty")}
      </h3>
      <p className="mt-1.5 max-w-md text-[13.5px] text-gray-500 dark:text-gray-400">
        Lorsque de nouveaux événements liés aux rendez-vous surviendront (création, confirmation, annulation), ils apparaîtront ici.
      </p>
    </div>
  );
}
