"use client";

/**
 * CountrySelect
 *
 * A searchable country selector backed by /data/countries.json.
 * Stores the country NAME (e.g. "Belgique") as the value — not the ISO code —
 * so the stored value is human-readable everywhere it appears (invoices, tables,
 * profile page, etc.).
 *
 * Props
 * ─────
 * value        string   – currently selected country name (controlled)
 * onChange     fn       – called with the new country name string
 * id           string   – forwarded to the hidden <input> (for label association)
 * name         string   – forwarded to the hidden <input> (for form submit)
 * error        boolean  – when true, applies red border styling
 * placeholder  string   – label shown when nothing is selected
 * className    string   – extra classes added to the trigger button
 * disabled     boolean
 *
 * Two style variants via the `variant` prop:
 *   "default"  – rounded-lg border used in dashboard modals (indigo focus ring)
 *   "boutique" – square border used in checkout / profile pages (gold focus ring)
 *   "rounded"  – rounded-full border used in reservation form (dark focus ring)
 */

import { useState, useRef, useEffect, useCallback, useMemo, useId } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import countriesData from "@/data/countries.json";

// ── Pre-processed list (name only, sorted as supplied in JSON) ────────────────
const COUNTRY_NAMES = countriesData.map((c) => c.name);

// ── Variant style maps ────────────────────────────────────────────────────────
const TRIGGER_BASE = "relative flex h-9 w-full cursor-pointer items-center justify-between gap-2 border px-3 text-sm outline-none transition-colors";

const VARIANT_STYLES = {
  default: {
    trigger: `${TRIGGER_BASE} rounded-lg`,
    triggerNormal: "border-gray-200 bg-white text-gray-700 hover:border-indigo-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100",
    triggerError: "border-red-300 bg-white text-gray-700 focus:border-red-400 focus:ring-2 focus:ring-red-100",
    triggerDisabled: "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400",
    searchInput: "w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100",
    option: "cursor-pointer px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50",
    optionSelected: "bg-indigo-50 font-medium text-indigo-700",
    dropdown: "absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg",
  },
  boutique: {
    trigger: `${TRIGGER_BASE} h-[50px] rounded-none`,
    triggerNormal: "border-neutral-200 bg-white text-gray-700 hover:border-[#C8A46A] focus:border-[#C8A46A]",
    triggerError: "border-red-300 bg-white text-gray-700 focus:border-red-400",
    triggerDisabled: "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400",
    searchInput: "w-full border border-neutral-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-[#C8A46A]",
    option: "cursor-pointer px-4 py-2 text-sm text-gray-700 hover:bg-[#C8A46A]/10",
    optionSelected: "bg-[#C8A46A]/15 font-medium text-[#2F3A2E]",
    dropdown: "absolute z-50 mt-1 w-full border border-neutral-200 bg-white shadow-lg",
  },
  rounded: {
    trigger: `${TRIGGER_BASE} h-[46px] rounded-full`,
    triggerNormal: "border-[#ede5d8] bg-white text-[#2F3A2E] hover:border-[#2F3A2E] focus:border-[#2F3A2E] focus:ring-2 focus:ring-[#2F3A2E]/10",
    triggerError: "border-red-300 bg-white text-[#2F3A2E] focus:border-red-400 focus:ring-2 focus:ring-red-100",
    triggerDisabled: "cursor-not-allowed border-[#ede5d8] bg-[#fafafa] text-[#9a9590]",
    searchInput: "w-full rounded-full border border-[#ede5d8] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#2F3A2E] focus:ring-1 focus:ring-[#2F3A2E]/10",
    option: "cursor-pointer px-3 py-2 text-sm text-[#2F3A2E] hover:bg-[#f5ece0]",
    optionSelected: "bg-[#f5ece0] font-medium text-[#2F3A2E]",
    dropdown: "absolute z-50 mt-1 w-full rounded-xl border border-[#ede5d8] bg-white shadow-lg",
  },
};

export function CountrySelect({
  value = "",
  onChange,
  id,
  name,
  error = false,
  placeholder = "Sélectionnez un pays",
  className = "",
  disabled = false,
  variant = "default",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const internalId = useId();
  const inputId = id ?? internalId;

  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.default;

  // Filter countries by search query
  const filtered = useMemo(() => {
    if (!query.trim()) return COUNTRY_NAMES;
    const q = query.toLowerCase();
    return COUNTRY_NAMES.filter((name) => name.toLowerCase().includes(q));
  }, [query]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    function handleEscape(e) {
      if (e.key === "Escape") { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 10);
    }
  }, [open]);

  // Scroll selected item into view when dropdown opens
  useEffect(() => {
    if (open && value && listRef.current) {
      const selected = listRef.current.querySelector("[data-selected='true']");
      selected?.scrollIntoView({ block: "nearest" });
    }
  }, [open, value]);

  const handleSelect = useCallback((name) => {
    onChange(name);
    setOpen(false);
    setQuery("");
  }, [onChange]);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    onChange("");
  }, [onChange]);

  const triggerState = disabled
    ? styles.triggerDisabled
    : error
      ? styles.triggerError
      : styles.triggerNormal;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Hidden input for form submit / react-hook-form register */}
      <input
        type="hidden"
        id={inputId}
        name={name}
        value={value}
        readOnly
      />

      {/* Trigger button */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${inputId}-listbox`}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`${styles.trigger} ${triggerState}`}
      >
        <span className={value ? "" : "text-gray-400"}>
          {value || placeholder}
        </span>
        <div className="flex shrink-0 items-center gap-1 text-gray-400">
          {value && !disabled && (
            <span
              role="button"
              aria-label="Effacer la sélection"
              onClick={handleClear}
              className="rounded p-0.5 hover:text-gray-600"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={14}
            className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          id={`${inputId}-listbox`}
          role="listbox"
          aria-label="Liste des pays"
          className={styles.dropdown}
        >
          {/* Search input */}
          <div className="p-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un pays…"
                className={`${styles.searchInput} pl-7`}
                aria-label="Rechercher un pays"
              />
            </div>
          </div>

          {/* Options list */}
          <ul
            ref={listRef}
            className="max-h-52 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-gray-400 text-center">
                Aucun pays trouvé
              </li>
            ) : (
              filtered.map((countryName) => {
                const isSelected = countryName === value;
                return (
                  <li
                    key={countryName}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    onClick={() => handleSelect(countryName)}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ""}`}
                  >
                    {countryName}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
