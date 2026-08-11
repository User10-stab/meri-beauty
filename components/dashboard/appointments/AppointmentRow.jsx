"use client";

import { useState, useRef, useEffect } from "react";
import {
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Eye,
  Loader2,
} from "lucide-react";

// ─── Status badge config ───────────────────────────────────────────────────────

const STATUS_CONFIG = {
  PENDING: {
    label: "En attente",
    className: "bg-amber-50 text-amber-700 border border-amber-100",
    dot: "bg-amber-500",
  },
  CONFIRMED: {
    label: "Confirmé",
    className: "bg-emerald-50 text-emerald-700 border border-emerald-100",
    dot: "bg-emerald-500",
  },
  CANCELLED: {
    label: "Annulé",
    className: "bg-red-50 text-red-700 border border-red-100",
    dot: "bg-red-500",
  },
  COMPLETED: {
    label: "Terminé",
    className: "bg-blue-50 text-blue-700 border border-blue-100",
    dot: "bg-blue-500",
  },
  NO_SHOW: {
    label: "Absent",
    className: "bg-gray-100 text-gray-600 border border-gray-200",
    dot: "bg-gray-400",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status ?? "—",
    className: "bg-gray-100 text-gray-600 border border-gray-200",
    dot: "bg-gray-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${config.dot}`}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}

// ─── Appointment-specific kebab menu ──────────────────────────────────────────

/**
 * Menu items are derived from the row's status.
 *
 * PENDING   → Confirm, Divider, Cancel
 * CONFIRMED → View details, Reschedule, Divider, Cancel
 * Others    → View details  (always something in the menu)
 */
function getMenuItems(status, handlers) {
  const { onConfirm, onCancel, onView, onReschedule } = handlers;

  switch (status) {
    case "PENDING":
      return [
        {
          key: "confirm",
          label: "Confirmer",
          icon: CheckCircle2,
          onClick: onConfirm,
          variant: "success",
        },
        { key: "divider-1", divider: true },
        {
          key: "cancel",
          label: "Annuler",
          icon: XCircle,
          onClick: onCancel,
          variant: "danger",
        },
      ];

    case "CONFIRMED":
      return [
        {
          key: "view",
          label: "Voir les détails",
          icon: Eye,
          onClick: onView,
          variant: "default",
        },
      ];

    default:
      // CANCELLED, COMPLETED, NO_SHOW — view only
      return [
        {
          key: "view",
          label: "Voir les détails",
          icon: Eye,
          onClick: onView,
          variant: "default",
        },
      ];
  }
}

const VARIANT_CLASSES = {
  default: "text-gray-700 hover:bg-gray-50",
  success: "text-emerald-700 hover:bg-emerald-50",
  danger: "text-red-500 hover:bg-red-50",
};

/**
 * Compact kebab (⋮) menu — same shell as the shared RowActions but driven
 * by appointment-specific status logic and with per-item loading states.
 */
function AppointmentRowActions({ row, onConfirm, onCancel, onView }) {
  const [open, setOpen] = useState(false);
  const [loadingKey, setLoadingKey] = useState(null); // key of the item currently running
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // ── Close on Escape ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const menuItems = getMenuItems(row.status, {
    onConfirm,
    onCancel,
    onView,
  });

  async function handleItemClick(item) {
    if (!item.onClick || loadingKey) return;
    setOpen(false);
    setLoadingKey(item.key);
    try {
      await item.onClick(row);
    } finally {
      setLoadingKey(null);
    }
  }

  const isBusy = loadingKey !== null;

  return (
    <div ref={containerRef} className="relative flex justify-end">
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={isBusy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Actions du rendez-vous"
        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-wait disabled:opacity-60"
      >
        {isBusy ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <MoreHorizontal size={15} />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          aria-label="Actions du rendez-vous"
          className="absolute right-0 top-full z-40 mt-1 w-44 origin-top-right rounded-lg border border-gray-100 bg-white py-1 shadow-lg shadow-gray-200/60 animate-in fade-in-0 zoom-in-95"
        >
          {menuItems.map((item) => {
            // Divider
            if (item.divider) {
              return (
                <div
                  key={item.key}
                  className="my-1 border-t border-gray-100"
                  role="separator"
                />
              );
            }

            const Icon = item.icon;
            const variantCls =
              VARIANT_CLASSES[item.variant] ?? VARIANT_CLASSES.default;
            // Dim items that have no handler wired up yet
            const isAvailable = !!item.onClick;

            return (
              <button
                key={item.key}
                role="menuitem"
                type="button"
                onClick={() => handleItemClick(item)}
                disabled={!isAvailable}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors focus-visible:bg-gray-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${variantCls}`}
              >
                <Icon size={14} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

/**
 * Single row in the appointments table.
 *
 * The Actions cell always renders the same kebab trigger regardless of status.
 * The dropdown content adapts to the row's status — no empty cells, no
 * row-height variation.
 *
 * @param {{
 *   row: object,
 *   onConfirm?: (row: object) => Promise<void>,
 *   onCancel?:  (row: object) => Promise<void>,
 *   onView?:    (row: object) => void,
 * }} props
 */
export function AppointmentRow({ row, onConfirm, onCancel, onView }) {
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Customer */}
      <td className="px-4 py-3 pl-5 align-middle">
        <div>
          <p className="font-medium text-gray-800">{row.customerName}</p>
          <p className="mt-0.5 text-xs text-gray-400">{row.customerEmail}</p>
        </div>
      </td>

      {/* Service */}
      <td className="px-4 py-3 align-middle">
        <span className="text-sm text-gray-700">{row.serviceName}</span>
      </td>

      {/* Staff */}
      <td className="px-4 py-3 align-middle">
        <span className="text-sm text-gray-700">{row.staffName}</span>
      </td>

      {/* Date */}
      <td className="px-4 py-3 align-middle">
        <span className="whitespace-nowrap text-sm text-gray-700">
          {formatDate(row.date)}
        </span>
      </td>

      {/* Time slot */}
      <td className="px-4 py-3 align-middle">
        <span className="whitespace-nowrap text-sm text-gray-600">
          {formatTime(row.startTime)}
          {row.endTime ? ` – ${formatTime(row.endTime)}` : ""}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3 align-middle">
        <StatusBadge status={row.status} />
      </td>

      {/* Actions — always present, content varies by status */}
      <td className="w-12 px-4 py-3 pr-5 align-middle">
        <AppointmentRowActions
          row={row}
          onConfirm={onConfirm}
          onCancel={onCancel}
          onView={onView}
        />
      </td>
    </tr>
  );
}
