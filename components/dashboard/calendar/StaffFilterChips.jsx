"use client";

import { getStaffColor } from "./staffColors";

/**
 * Horizontal filter chips for filtering the calendar by staff member.
 * Only rendered for Admin / Owner.
 *
 * @param {{
 *   staff: Array<{ id: string, name: string, photo: string | null }>,
 *   selectedStaffId: string | null,   // null = "All Staff"
 *   onSelect: (id: string | null) => void,
 * }} props
 */
export function StaffFilterChips({ staff, selectedStaffId, onSelect }) {
  if (!staff || staff.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
      {/* All Staff chip */}
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all ${
          selectedStaffId === null
            ? "border-[#2f3a2e] bg-[#2f3a2e] text-white shadow-sm dark:border-white dark:bg-white dark:text-[#2f3a2e]"
            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        }`}
      >
        Tous les employés
      </button>

      {/* Per-staff chips */}
      {staff.map((member) => {
        const color = getStaffColor(member.id);
        const isSelected = selectedStaffId === member.id;

        return (
          <button
            key={member.id}
            onClick={() => onSelect(member.id)}
            className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all ${
              isSelected
                ? "shadow-sm"
                : "hover:brightness-95"
            }`}
            style={
              isSelected
                ? {
                    backgroundColor: color.bg,
                    borderColor: color.border,
                    color: color.text,
                  }
                : {
                    backgroundColor: "white",
                    borderColor: "#E5E7EB",
                    color: "#4B5563",
                  }
            }
          >
            {/* Colored dot */}
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: isSelected ? color.dot : color.dot }}
              aria-hidden="true"
            />

            {/* Avatar or initials */}
            {member.photo ? (
              <img
                src={member.photo}
                alt={member.name}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ backgroundColor: color.bg, color: color.text }}
              >
                {member.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
            )}

            {member.name}
          </button>
        );
      })}
    </div>
  );
}
