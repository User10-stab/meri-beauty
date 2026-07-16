"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useTransition,
} from "react";
import {
  Search,
  X,
  Plus,
  Loader2,
  ChevronDown,
  Package,
  Tag,
} from "lucide-react";
import { createService, createCategory, getCategories } from "@/actions/services/create-service";
import { toast } from "sonner";
import { InlineCategoryCreate } from "@/components/dashboard/services/InlineCategoryCreate";

// ─── Quick-create service form ────────────────────────────────────────────────

/**
 * Two-step inline form:
 *   Step 1 — choose / create a category
 *   Step 2 — enter service name + optional description
 */
function QuickCreateServiceForm({ onCreated, onCancel }) {
  // Category data
  const [categories, setCategories] = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [showCategoryCreate, setShowCategoryCreate] = useState(false);

  // Service fields (only shown after a category is chosen)
  const [serviceName, setServiceName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState({});
  const [isPending, startTransition] = useTransition();

  // Fetch categories on mount
  useEffect(() => {
    getCategories().then((res) => {
      setCategories(res.data ?? []);
      setLoadingCats(false);
    });
  }, []);

  function handleCategoryCreated(newCat) {
    setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name, "fr")));
    setSelectedCategoryId(newCat.id);
    setShowCategoryCreate(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    setErrors({});

    startTransition(async () => {
      const res = await createService({
        name: serviceName,
        categoryId: selectedCategoryId,
        description,
      });
      if (res.success) {
        toast.success(res.message);
        onCreated(res.service);
      } else {
        if (res.errors) setErrors(res.errors);
        else toast.error(res.message);
      }
    });
  }

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const canSubmit = selectedCategoryId && serviceName.trim();

  return (
    <div className="border-t border-gray-100 bg-slate-50 p-3 space-y-3">

      {/* Header */}
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
        Nouveau service
      </p>

      {/* ── Step 1: Category ──────────────────────────────────────── */}
      <div>
        <p className="mb-1 text-xs font-medium text-gray-600">
          1. Choisir une catégorie{" "}
          <span className="text-red-400">*</span>
        </p>

        {/* Category selector row */}
        <div className="flex items-center gap-1.5">
          {loadingCats ? (
            <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-400">
              <Loader2 size={11} className="animate-spin" /> Chargement…
            </div>
          ) : (
            <div className="relative flex-1">
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className={`h-8 w-full appearance-none rounded-lg border bg-white px-3 pr-7 text-sm text-gray-700 outline-none transition-colors focus:ring-2 ${
                  errors.categoryId
                    ? "border-red-300 focus:ring-red-100"
                    : "border-gray-200 focus:border-indigo-400 focus:ring-indigo-100"
                }`}
              >
                <option value="">Sélectionner…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
              />
            </div>
          )}

          {/* + New category button */}
          <button
            type="button"
            onClick={() => setShowCategoryCreate((p) => !p)}
            title="Créer une nouvelle catégorie"
            aria-label="Créer une nouvelle catégorie"
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${
              showCategoryCreate
                ? "border-indigo-400 bg-indigo-100 text-indigo-700"
                : "border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
            }`}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Inline category creation */}
        {showCategoryCreate && (
          <InlineCategoryCreate
            onCreated={handleCategoryCreated}
            onCancel={() => setShowCategoryCreate(false)}
          />
        )}

        {errors.categoryId && (
          <p className="mt-0.5 text-xs text-red-600">{errors.categoryId}</p>
        )}
      </div>

      {/* ── Step 2: Service fields (unlocked after category chosen) ── */}
      <div
        className={`space-y-2 transition-opacity duration-150 ${
          selectedCategoryId ? "opacity-100" : "pointer-events-none opacity-40"
        }`}
      >
        <p className="text-xs font-medium text-gray-600">
          2. Nommer le service{" "}
          {selectedCategory && (
            <span className="font-normal text-indigo-600">
              dans « {selectedCategory.name} »
            </span>
          )}
          <span className="text-red-400"> *</span>
        </p>

        {/* Service name */}
        <div>
          <div className="relative">
            <Tag
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleSubmit(e);
              }}
              placeholder="Nom du service"
              disabled={!selectedCategoryId}
              className={`h-8 w-full rounded-lg border py-0 pl-8 pr-3 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 ${
                errors.name
                  ? "border-red-300 focus:ring-red-100"
                  : "border-gray-200 focus:border-indigo-400 focus:ring-indigo-100"
              }`}
            />
          </div>
          {errors.name && (
            <p className="mt-0.5 text-xs text-red-600">{errors.name}</p>
          )}
        </div>

        {/* Description (optional) */}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optionnel)"
          disabled={!selectedCategoryId}
          className="h-8 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 border-t border-gray-100 pt-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Plus size={11} />
          )}
          Créer le service
        </button>
      </div>
    </div>
  );
}

// ─── Main multi-select component ──────────────────────────────────────────────

/**
 * Searchable multi-select dropdown for services.
 * Services are grouped by category.
 * The + button opens an inline two-step form to create a service (and optionally
 * a category) without leaving the modal.
 *
 * @param {{
 *   services: Array<{ id: string, name: string, category: { id: string, name: string } }>,
 *   value: string[],
 *   onChange: (ids: string[]) => void,
 *   error?: string,
 * }} props
 */
export function ServiceMultiSelect({ services: initialServices, value = [], onChange, error }) {
  const [services, setServices] = useState(initialServices);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
        setShowCreate(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (e.key === "Escape") {
        if (showCreate) {
          setShowCreate(false); // close create form first
        } else {
          setOpen(false);
          setSearch("");
        }
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, showCreate]);

  const toggle = useCallback(
    (id) =>
      onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]),
    [value, onChange]
  );

  const removeTag = useCallback(
    (id) => onChange(value.filter((v) => v !== id)),
    [value, onChange]
  );

  function handleServiceCreated(newService) {
    setServices((prev) => [...prev, newService]);
    onChange([...value, newService.id]);
    setShowCreate(false);
  }

  // Filter + group by category
  const filtered = search.trim()
    ? services.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.category.name.toLowerCase().includes(search.toLowerCase())
      )
    : services;

  const grouped = filtered.reduce((acc, s) => {
    const cat = s.category.name;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const selectedServices = value
    .map((id) => services.find((s) => s.id === id))
    .filter(Boolean);

  return (
    <div ref={containerRef} className="relative">

      {/* ── Trigger ───────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex min-h-[38px] w-full flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
          error
            ? "border-red-300"
            : open
            ? "border-indigo-400 ring-2 ring-indigo-100"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        {selectedServices.length === 0 ? (
          <span className="flex-1 text-sm text-gray-400">
            Sélectionner des services…
          </span>
        ) : (
          selectedServices.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
            >
              {s.name}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeTag(s.id); }}
                aria-label={`Retirer ${s.name}`}
                className="ml-0.5 text-indigo-400 hover:text-indigo-700"
              >
                <X size={11} />
              </button>
            </span>
          ))
        )}
        <ChevronDown
          size={14}
          className={`ml-auto flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* ── Dropdown ──────────────────────────────────────────────── */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-[200] mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-200/60">

          {/* Search bar + toggle create button */}
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Search size={13} className="flex-shrink-0 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un service…"
              autoFocus={!showCreate}
              className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
            />
            <button
              type="button"
              onClick={() => { setShowCreate((p) => !p); setSearch(""); }}
              aria-label={showCreate ? "Fermer le formulaire" : "Créer un nouveau service"}
              title={showCreate ? "Fermer" : "Nouveau service"}
              className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                showCreate
                  ? "bg-indigo-100 text-indigo-700 rotate-45"
                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Quick-create service form (two-step) */}
          {showCreate && (
            <QuickCreateServiceForm
              onCreated={handleServiceCreated}
              onCancel={() => setShowCreate(false)}
            />
          )}

          {/* Service list */}
          {!showCreate && (
            <div className="max-h-52 overflow-y-auto">
              {Object.keys(grouped).length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Package size={20} className="text-gray-300" />
                  <p className="text-sm text-gray-400">
                    {search ? "Aucun service trouvé." : "Aucun service disponible."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="text-xs font-medium text-indigo-600 hover:underline"
                  >
                    + Créer un service
                  </button>
                </div>
              ) : (
                Object.entries(grouped).map(([catName, items]) => (
                  <div key={catName}>
                    {/* Category header */}
                    <p className="sticky top-0 bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                      {catName}
                    </p>

                    {items.map((s) => {
                      const selected = value.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => toggle(s.id)}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                            selected
                              ? "bg-indigo-50 text-indigo-700"
                              : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {/* Checkbox indicator */}
                          <span
                            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                              selected
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-gray-300"
                            }`}
                          >
                            {selected && (
                              <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3">
                                <path
                                  d="M2 6l3 3 5-5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
