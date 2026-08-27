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
    open: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    closed: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
    unavailable: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };

  return (
    <div
      className={`flex flex-col items-center gap-1 border-b border-gray-200 dark:border-gray-700 ${
        compact ? "px-1 py-1.5" : "px-2 py-2"
      }`}
      style={{ borderTop: `3px solid ${color.dot}` }}
    >
      {/* Avatar */}
      {staff.photo ? (
        <img
          src={staff.photo}
          alt={staff.name}
          className={`rounded-full object-cover ${compact ? "h-6 w-6" : "h-8 w-8"}`}
        />
      ) : (
        <span
          className={`flex items-center justify-center rounded-full font-bold ${
            compact ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[10px]"
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

      {/* Name */}
      <p
        className={`truncate text-center font-semibold leading-tight text-gray-800 dark:text-white ${
          compact ? "max-w-[70px] text-[10px]" : "max-w-[90px] text-xs"
        }`}
        title={staff.name}
      >
        {staff.name}
      </p>

      {/* Working hours */}
      {!compact && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {workingHoursLabel}
        </p>
      )}

      {/* Availability badge */}
      <span
        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${badgeStyles[availability.kind]}`}
      >
        {availability.label}
      </span>
    </div>
  );
}
