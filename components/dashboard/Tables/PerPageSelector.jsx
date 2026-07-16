"use client";

import { ChevronDown } from "lucide-react";

const OPTIONS = [5, 10, 20, 50];

/**
 * @param {object} props
 * @param {number} props.value
 * @param {(value: number) => void} props.onChange
 */
export function PerPageSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <span className="whitespace-nowrap font-medium">Per Page:</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Rows per page"
          className="
            h-9 appearance-none rounded-md border border-gray-200 bg-white
            py-1 pl-3 pr-7 text-sm text-gray-700 outline-none
            transition-colors focus:border-indigo-400 focus:ring-2
            focus:ring-indigo-100 cursor-pointer
          "
        >
          {OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
        />
      </div>
    </div>
  );
}
