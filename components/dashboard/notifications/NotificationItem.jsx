"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { formatMessageTime } from "@/lib/format-message-time";
import {
  CalendarPlus2,
  CalendarCheck,
  CalendarX2,
  BellRing,
} from "lucide-react";

function getIconForType(type) {
  switch (type) {
    case "APPOINTMENT_CREATED":
      return CalendarPlus2;
    case "APPOINTMENT_CONFIRMED":
      return CalendarCheck;
    case "APPOINTMENT_CANCELLED":
      return CalendarX2;
    default:
      return BellRing;
  }
}

function getAccentForType(type) {
  switch (type) {
    case "APPOINTMENT_CREATED":
      return "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300";
    case "APPOINTMENT_CONFIRMED":
      return "bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300";
    case "APPOINTMENT_CANCELLED":
      return "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300";
  }
}

export default function NotificationItem({
  notification,
  onMarkedRead,
  onDeleted,
  compact = false,
}) {
  const Icon = getIconForType(notification.type);
  const accentClass = getAccentForType(notification.type);
  const isUnread = !notification.isRead;

  const handleRowClick = async (e) => {
    if (e.target.closest("[data-notif-action]")) return;
    if (isUnread && onMarkedRead) {
      await onMarkedRead(notification.id);
    }
    if (notification.actionUrl) {
      // navigation handled via Link wrapping
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onDeleted) {
      await onDeleted(notification.id);
    }
  };

  const handleMarkReadClick = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isUnread && onMarkedRead) {
      await onMarkedRead(notification.id);
    }
  };

  const content = (
    <div
      onClick={handleRowClick}
      className={[
        "group relative flex items-start gap-3 px-3 py-3 transition-colors",
        isUnread
          ? "bg-sky-50/50 hover:bg-sky-50 dark:bg-sky-500/5 dark:hover:bg-sky-500/10"
          : "hover:bg-gray-50 dark:hover:bg-white/5",
        compact ? "rounded-lg cursor-pointer" : "cursor-pointer",
      ].join(" ")}
      data-testid={`notification-row-${notification.id}`}
    >
      <div
        className={[
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          accentClass,
        ].join(" ")}
        aria-hidden
      >
        <Icon className="h-4.5 w-4.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={[
              "truncate text-[13px] leading-tight",
              isUnread
                ? "font-semibold text-gray-900 dark:text-gray-100"
                : "font-medium text-gray-700 dark:text-gray-300",
            ].join(" ")}
          >
            {notification.title}
            {isUnread && (
              <span className="ml-2 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-500 align-middle" />
            )}
          </p>
          <time
            dateTime={notification.createdAt}
            className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400"
          >
            {formatMessageTime(notification.createdAt)}
          </time>
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-gray-600 dark:text-gray-400 line-clamp-2">
          {notification.message}
        </p>
        {!compact && notification.actionUrl && (
          <span
            className="mt-1.5 inline-flex items-center text-[12px] font-medium text-sky-600 dark:text-sky-400"
          >
            Voir le rendez-vous →
          </span>
        )}
      </div>

      <div
        className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        data-notif-action
      >
        {isUnread && (
          <button
            type="button"
            onClick={handleMarkReadClick}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-200/60 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-300"
            title="Marquer comme lu"
            aria-label="Marquer comme lu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-md p-1 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
          title="Supprimer"
          aria-label="Supprimer la notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  if (notification.actionUrl) {
    return (
      <Link
        href={notification.actionUrl}
        className="block text-inherit no-underline focus:outline-none"
      >
        {content}
      </Link>
    );
  }

  return content;
}
