"use client";

import { ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";

/**
 * @param {object} props
 * @param {string} props.column        - column key
 * @param {string} props.label         - display label
 * @param {string | null} props.sortKey       - currently sorted column key
 * @param {"asc" | "desc" | null} props.sortDir - current sort direction
 * @param {(column: string) => void} props.onSort
 * @param {string} [props.className]
 */
export function SortableTableHead({
  column,
  label,
  sortKey,
  sortDir,
  onSort,
  className = "",
}) {
  const isActive = sortKey === column;

  const Icon = isActive
    ? sortDir === "asc"
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown;

  return (
    <th
      className={`
        h-12 px-4 text-left align-middle font-semibold text-gray-500
        text-sm whitespace-nowrap ${className}
      `}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="
          inline-flex items-center gap-1 rounded transition-colors
          hover:text-indigo-600 focus-visible:outline focus-visible:outline-2
          focus-visible:outline-indigo-500
        "
        aria-label={`Sort by ${label}`}
      >
        <span className={isActive ? "text-indigo-600" : ""}>{label}</span>
        <Icon
          size={14}
          className={isActive ? "text-indigo-600" : "text-gray-400"}
        />
      </button>
    </th>
  );
}
