"use client";

import { getStaffColor } from "./staffColors";
import { Users } from "lucide-react";

/**
 * Horizontal filter chips for filtering the calendar by staff member.
 * Only rendered for Admin / Owner.
 * Ultra-clean design with improved active states, better visual hierarchy,
 * and seamless integration with the calendar aesthetic.
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
    <div className="flex flex-wrap items-center gap-2.5 overflow-x-auto pb-1">
      {/* All Staff chip */}
      <button
        onClick={() => onSelect(null)}
        className={`group flex items-center gap-2 rounded-xl border px-4 py-2 text-[13px] font-semibold transition-all ${
          selectedStaffId === null
            ? "border-[#303c2f]/80 bg-[#303c2f] text-white shadow-[0_2px_8px_rgba(48,60,47,0.25)] dark:border-[#303c2f] dark:shadow-[0_2px_8px_rgba(48,60,47,0.4)]"
            : "border-gray-200/80 bg-white text-gray-600 shadow-sm hover:border-[#303c2f]/20 hover:bg-[#303c2f]/5 hover:text-[#303c2f] dark:border-gray-700/80 dark:bg-gray-800/60 dark:text-gray-400 dark:hover:border-[#303c2f]/30 dark:hover:bg-[#303c2f]/10 dark:hover:text-white"
        }`}
      >
        <Users 
          size={14} 
          strokeWidth={2.5} 
          className={`transition-transform ${selectedStaffId === null ? '' : 'group-hover:scale-110'}`}
        />
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
            className={`group flex items-center gap-2.5 rounded-xl border px-4 py-2 text-[13px] font-semibold transition-all ${
              isSelected
                ? "shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
                : "shadow-sm hover:shadow-md hover:scale-[1.02]"
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
                    borderColor: "#E5E7EB80",
                    color: "#6B7280",
                  }
            }
          >
            {/* Avatar or initials */}
            {member.photo ? (
              <img
                src={member.photo}
                alt={member.name}
                className={`h-5 w-5 rounded-full object-cover ring-2 transition-all ${
                  isSelected 
                    ? "ring-white/50" 
                    : "ring-transparent group-hover:ring-gray-200"
                }`}
              />
            ) : (
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ring-2 transition-all ${
                  isSelected 
                    ? "ring-white/50" 
                    : "ring-transparent group-hover:ring-gray-200"
                }`}
                style={{ 
                  backgroundColor: isSelected ? color.dot : color.bg, 
                  color: isSelected ? "white" : color.text 
                }}
              >
                {member.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
            )}

            {/* Name */}
            <span className="font-semibold">{member.name}</span>

            {/* Colored indicator dot */}
            {isSelected && (
              <span
                className="ml-0.5 h-2 w-2 flex-shrink-0 rounded-full shadow-sm ring-1 ring-white/30"
                style={{ backgroundColor: color.dot }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
