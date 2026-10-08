"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, Loader2, Package, Search, X, UserRound } from "lucide-react";
import { listPromoServices, searchPromoCustomers, searchPromoProducts } from "@/actions/promo-codes";
import { formatEuro } from "./promo-format";

const inputClass =
  "h-10 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white";

/** Debounced server search; `minLength` 0 loads suggestions on focus. */
function useRemoteSearch(fetcher, query, { minLength = 0, enabled = true } = {}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const q = query.trim();
    if (q.length < minLength) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await fetcher(q);
      if (cancelled) return;
      setResults(result.data ?? []);
      setLoading(false);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetcher, query, minLength, enabled]);

  return { results, loading };
}

function Chip({ children, onRemove, icon: Icon }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#2f3a2e] py-1 pl-2.5 pr-1 text-xs font-medium text-white">
      {Icon && <Icon size={12} className="shrink-0 text-[#C8A46A]" />}
      <span className="truncate">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
        aria-label="Retirer"
      >
        <X size={12} />
      </button>
    </span>
  );
}

function Dropdown({ open, children }) {
  if (!open) return null;
  return (
    <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-gray-100 bg-white p-1 shadow-xl dark:border-dark-3 dark:bg-gray-dark">
      {children}
    </div>
  );
}

function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onOutside]);
  return ref;
}

const PRODUCT_EMPTY_HINT = "Choisissez au moins un produit (ou repassez sur « Toute la boutique »).";

/** `emptyHint={null}` when picking no product at all is a valid choice. */
export function ProductPicker({ value, onChange, error, emptyHint = PRODUCT_EMPTY_HINT }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const { results, loading } = useRemoteSearch(searchPromoProducts, query, { enabled: open });
  const selectedIds = new Set(value.map((p) => p.id));

  function toggle(product) {
    onChange(selectedIds.has(product.id) ? value.filter((p) => p.id !== product.id) : [...value, { id: product.id, name: product.name }]);
  }

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher un produit…"
          className={inputClass}
        />
        <Dropdown open={open}>
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
          ) : results.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-gray-500">Aucun produit trouvé.</p>
          ) : (
            results.map((product) => {
              const selected = selectedIds.has(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => toggle(product)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    selected ? "bg-[#2f3a2e]/5" : "hover:bg-gray-50 dark:hover:bg-dark-2"
                  }`}
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#fdf8f0] text-[#b89664]">
                    {product.image ? (
                      <Image src={product.image} alt="" fill sizes="40px" className="object-cover" />
                    ) : (
                      <Package size={16} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800 dark:text-white">{product.name}</span>
                    {product.price != null && <span className="text-xs text-gray-400">dès {formatEuro(product.price)}</span>}
                  </span>
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      selected ? "border-[#2f3a2e] bg-[#2f3a2e] text-white" : "border-gray-300"
                    }`}
                  >
                    {selected && <Check size={12} />}
                  </span>
                </button>
              );
            })
          )}
        </Dropdown>
      </div>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <Chip key={p.id} icon={Package} onRemove={() => onChange(value.filter((x) => x.id !== p.id))}>{p.name}</Chip>
          ))}
        </div>
      ) : (
        emptyHint && <p className="text-xs text-amber-700">{emptyHint}</p>
      )}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

export function ServicePicker({ value, onChange, error }) {
  const [services, setServices] = useState(null);
  const [query, setQuery] = useState("");
  const selectedIds = new Set(value.map((s) => s.id));

  useEffect(() => {
    let cancelled = false;
    listPromoServices().then((result) => {
      if (!cancelled) setServices(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map();
    for (const s of services ?? []) {
      if (q && !s.name.toLowerCase().includes(q) && !s.category.toLowerCase().includes(q)) continue;
      if (!groups.has(s.category)) groups.set(s.category, []);
      groups.get(s.category).push(s);
    }
    return [...groups.entries()];
  }, [services, query]);

  function toggle(service) {
    onChange(selectedIds.has(service.id) ? value.filter((s) => s.id !== service.id) : [...value, { id: service.id, name: service.name }]);
  }

  function toggleGroup(items) {
    const allSelected = items.every((s) => selectedIds.has(s.id));
    if (allSelected) onChange(value.filter((s) => !items.some((i) => i.id === s.id)));
    else onChange([...value, ...items.filter((s) => !selectedIds.has(s.id)).map((s) => ({ id: s.id, name: s.name }))]);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer les prestations…"
          className={inputClass}
        />
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-gray-100 p-3 dark:border-dark-3">
        {services == null ? (
          <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
        ) : grouped.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-500">Aucune prestation trouvée.</p>
        ) : (
          grouped.map(([category, items]) => {
            const allSelected = items.every((s) => selectedIds.has(s.id));
            return (
              <div key={category}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#b89664]">{category}</span>
                  <button type="button" onClick={() => toggleGroup(items)} className="text-[11px] font-medium text-[#2f3a2e] hover:underline dark:text-[#C8A46A]">
                    {allSelected ? "Tout retirer" : "Tout choisir"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((s) => {
                    const selected = selectedIds.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggle(s)}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          selected
                            ? "border-[#2f3a2e] bg-[#2f3a2e] text-white"
                            : "border-gray-200 text-gray-600 hover:border-[#2f3a2e]/40 dark:border-dark-3 dark:text-dark-6"
                        }`}
                      >
                        {selected && <Check size={12} />}
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
      <p className={`text-xs ${value.length ? "text-gray-500" : "text-amber-700"}`}>
        {value.length
          ? `${value.length} prestation${value.length > 1 ? "s" : ""} sélectionnée${value.length > 1 ? "s" : ""}`
          : "Choisissez au moins une prestation (ou repassez sur « Toutes les prestations »)."}
      </p>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

export function CustomerPicker({ value, onChange, error }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const { results, loading } = useRemoteSearch(searchPromoCustomers, query, { minLength: 2, enabled: open });
  const selectedIds = new Set(value.map((c) => c.id));

  function add(customer) {
    if (!selectedIds.has(customer.id)) onChange([...value, { id: customer.id, fullName: customer.fullName, email: customer.email }]);
    setQuery("");
  }

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Nom, e-mail ou téléphone de la cliente…"
          className={inputClass}
        />
        <Dropdown open={open && query.trim().length >= 2}>
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 size={16} className="animate-spin" /></div>
          ) : results.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-gray-500">Aucune cliente trouvée.</p>
          ) : (
            results.map((c) => {
              const selected = selectedIds.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={selected}
                  onClick={() => add(c)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-dark-2"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fdf8f0] text-xs font-bold text-[#b89664]">
                    {initials(c.fullName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800 dark:text-white">{c.fullName}</span>
                    <span className="block truncate text-xs text-gray-400">{c.email}{c.phone ? ` · ${c.phone}` : ""}</span>
                  </span>
                  {selected && <Check size={14} className="text-emerald-600" />}
                </button>
              );
            })
          )}
        </Dropdown>
      </div>
      {value.length > 0 ? (
        <div className="space-y-1.5">
          {value.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2 dark:border-dark-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f3a2e] text-[11px] font-bold text-[#C8A46A]">
                {initials(c.fullName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800 dark:text-white">{c.fullName}</span>
                <span className="block truncate text-xs text-gray-400">{c.email}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.id !== c.id))}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Retirer ${c.fullName}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <UserRound size={13} />
          Ajoutez au moins une cliente (ou repassez sur « Tout le monde »).
        </p>
      )}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

function initials(name) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}
