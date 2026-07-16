"use client";

import { Search } from "lucide-react";

/**
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder]
 */
export function SearchBar({
  value,
  onChange,
  placeholder = "Rechercher...",
}) {
  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Rechercher"
        className="
          h-9 w-64 rounded-md border border-gray-200 bg-white
          pl-3 pr-10 text-sm text-gray-700 outline-none
          transition-colors placeholder:text-gray-400
          focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
          sm:w-72
        "
      />
      <button
        type="button"
        aria-label="Lancer la recherche"
        className="
          absolute right-0 top-0 flex h-9 w-9 items-center justify-center
          rounded-r-md text-white transition-colors
          bg-[#2f3a2e] hover:bg-[#3d4e3b] focus-visible:outline
          focus-visible:outline-2 focus-visible:outline-offset-2
          focus-visible:outline-[#2f3a2e] active:scale-[0.98]
        "
      >
        <Search size={15} strokeWidth={2.5} />
      </button>
    </div>
  );
}
