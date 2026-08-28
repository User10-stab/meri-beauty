"use client";

import { getStaffColor } from "./staffColors";

/**
 * Header for a staff column in the admin calendar.
 * Shows staff photo/initials, name, working hours, and availability badge.
 *
 * @param {{
 *   staff: { id: string, name: string, photo: string | null },
 *   workingHoursLabel: string,
 *   availability: { label: string, kind: "open" | "closed" | "unavailable" },
 *   compact?: boolean,
 * }} props
 */
export function StaffColumnHeader({ staff, workingHoursLabel, availability, compact = false }) {
  const color = getStaffColor(staff.id);

  const badgeStyles = {
    open: "bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-500/10 dark:bg-emerald-900/10 dark:text-emerald-400 dark:ring-emerald-400/20",
    closed: "bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-500/10 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-600/20",
    unavailable: "bg-red-50 text-red-500 ring-1 ring-inset ring-red-500/10 dark:bg-red-900/10 dark:text-red-400 dark:ring-red-400/20",
  };

  return (
    <div
      className={`flex items-center gap-2 border-b border-gray-100 dark:border-gray-700/50 ${
        compact ? "px-2 py-1.5" : "px-3 py-2"
      }`}
    >
      {/* Avatar */}
      {staff.photo ? (
        <img
          src={staff.photo}
          alt={staff.name}
          className={`flex-shrink-0 rounded-full object-cover ${compact ? "h-6 w-6" : "h-7 w-7"}`}
        />
      ) : (
        <span
          className={`flex flex-shrink-0 items-center justify-center rounded-full font-bold ${
            compact ? "h-6 w-6 text-[9px]" : "h-7 w-7 text-[10px]"
          }`}
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {staff.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
      )}

      {/* Name + hours */}
      <div className="min-w-0 flex-1">
        <p
          className={`truncate font-semibold leading-tight text-gray-800 dark:text-white ${
            compact ? "text-[10px]" : "text-xs"
          }`}
          title={staff.name}
        >
          {staff.name}
        </p>
        {!compact && (
          <p className="truncate text-[10px] text-gray-400 dark:text-gray-500">
            {workingHoursLabel}
          </p>
        )}
      </div>

      {/* Availability badge */}
      <span
        className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${badgeStyles[availability.kind]}`}
      >
        {availability.label}
      </span>
    </div>
  );
}
