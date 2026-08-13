"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/assets/icons";
import { globalDashboardSearch } from "@/actions/dashboard/global-search";

const DEBOUNCE_MS = 300;

export function HeaderSearch() {
  const router = useRouter();
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function handleChange(e) {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await globalDashboardSearch(trimmed);
        setResults(result.success ? result.results : []);
        setIsOpen(true);
      });
    }, DEBOUNCE_MS);
  }

  function handleSelect(href) {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    router.push(href);
  }

  return (
    <div ref={containerRef} className="relative hidden w-full max-w-75 sm:block">
      <input
        type="search"
        placeholder="Rechercher un client, une commande, un produit..."
        value={query}
        onChange={handleChange}
        onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
        className="bg-gray-2 focus-visible:border-primary dark:border-dark-3 dark:bg-dark-2 dark:hover:border-dark-4 dark:hover:bg-dark-3 dark:hover:text-dark-6 dark:focus-visible:border-primary flex w-full items-center gap-3.5 rounded-full border py-3 pr-5 pl-13.25 transition-colors outline-none"
      />

      <SearchIcon className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 max-[1015px]:size-5" />

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-2 max-h-96 overflow-y-auto rounded-xl border border-stroke bg-white py-2 shadow-lg dark:border-dark-3 dark:bg-gray-dark"
        >
          {isPending ? (
            <p className="px-4 py-3 text-sm text-gray-6">Recherche...</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-6">Aucun résultat pour "{query}"</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.type}-${r.href}-${i}`}
                type="button"
                onClick={() => handleSelect(r.href)}
                className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-gray-2 dark:hover:bg-dark-3"
              >
                <span className="text-body-xs font-medium uppercase tracking-wide text-primary">
                  {r.type}
                </span>
                <span className="truncate text-sm font-medium text-dark dark:text-white">
                  {r.label}
                </span>
                {r.sublabel ? (
                  <span className="truncate text-body-xs text-gray-6">{r.sublabel}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
