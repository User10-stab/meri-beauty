"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, Grid3x3, LayoutGrid, List, Search, SlidersHorizontal, X } from "lucide-react";
import { getStorefrontProducts } from "@/actions/boutique/storefront";
import { ProductCard } from "@/components/boutique/ProductCard";
import { useTranslations } from "next-intl";

const SORT_OPTIONS = [
  { value: "newest", labelKey: "sortNewest" },
  { value: "price-asc", labelKey: "sortPriceAsc" },
  { value: "price-desc", labelKey: "sortPriceDesc" },
  { value: "name", labelKey: "sortName" },
];

const VIEW_OPTIONS = [
  { value: "comfortable", Icon: LayoutGrid, labelKey: "viewComfortable" },
  { value: "dense", Icon: Grid3x3, labelKey: "viewDense" },
  { value: "list", Icon: List, labelKey: "viewList" },
];

const GRID_CLASSES = {
  comfortable: "grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3",
  dense: "grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 xl:grid-cols-4",
  list: "flex flex-col divide-y divide-neutral-200",
};

const VIEW_STORAGE_KEY = "boutique:view";

function FilterSection({ title, isOpen, onToggle, toggleLabel, children }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={toggleLabel}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]"
      >
        {title}
        <ChevronDown
          size={15}
          className={`text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function BoutiquePageClient({ initialProducts, categories, brands }) {
  const t = useTranslations("boutique");
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [categorySlug, setCategorySlug] = useState(null);
  const [subcategorySlug, setSubcategorySlug] = useState(null);
  const [brandId, setBrandId] = useState(null);
  const [sort, setSort] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openSections, setOpenSections] = useState({ categories: true, brands: true });
  const [view, setView] = useState("dense");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === "comfortable" || saved === "dense" || saved === "list") setView(saved);
    } catch {
      // localStorage unavailable — keep the default view
    }
  }, []);

  function changeView(value) {
    setView(value);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, value);
    } catch {
      // ignore — the choice just won't persist
    }
  }

  function toggleSection(key) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const activeCategory = useMemo(
    () => categories.find((c) => c.slug === categorySlug) ?? null,
    [categories, categorySlug]
  );

  const activeSubcategory = useMemo(
    () => activeCategory?.subcategories.find((s) => s.slug === subcategorySlug) ?? null,
    [activeCategory, subcategorySlug]
  );

  const activeBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brands, brandId]
  );

  // Categories are brand-scoped — the same name (e.g. "Non classé", "Accessoires")
  // legitimately recurs under several brands, so group by brand here instead of
  // showing one flat list where duplicate names can't be told apart.
  const categoriesByBrand = useMemo(() => {
    const groups = new Map();
    for (const cat of categories) {
      const key = cat.brand?.id ?? "unknown";
      if (!groups.has(key)) groups.set(key, { brand: cat.brand, categories: [] });
      groups.get(key).categories.push(cat);
    }
    return [...groups.values()];
  }, [categories]);

  function refetch(next) {
    const params = {
      search: next.search ?? search,
      categorySlug: next.categorySlug !== undefined ? next.categorySlug : categorySlug,
      subcategorySlug: next.subcategorySlug !== undefined ? next.subcategorySlug : subcategorySlug,
      brandId: next.brandId !== undefined ? next.brandId : brandId,
      sort: next.sort ?? sort,
    };
    startTransition(async () => {
      const result = await getStorefrontProducts(params);
      setProducts(result.data ?? []);
    });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    refetch({});
  }

  function clearSearch() {
    setSearch("");
    refetch({ search: "" });
  }

  function selectCategory(slug) {
    const next = slug === categorySlug ? null : slug;
    setCategorySlug(next);
    setSubcategorySlug(null);
    setBrandId(null);
    refetch({ categorySlug: next, subcategorySlug: null, brandId: null });
  }

  function selectSubcategory(catSlug, subSlug) {
    const next = subSlug === subcategorySlug ? null : subSlug;
    setCategorySlug(catSlug);
    setSubcategorySlug(next);
    setBrandId(null);
    refetch({ categorySlug: catSlug, subcategorySlug: next, brandId: null });
  }

  function selectBrand(id) {
    const next = id === brandId ? null : id;
    setBrandId(next);
    setCategorySlug(null);
    setSubcategorySlug(null);
    refetch({ brandId: next, categorySlug: null, subcategorySlug: null });
  }

  function changeSort(value) {
    setSort(value);
    refetch({ sort: value });
  }

  function clearFilters() {
    setSearch("");
    setCategorySlug(null);
    setSubcategorySlug(null);
    setBrandId(null);
    setSort("newest");
    startTransition(async () => {
      const result = await getStorefrontProducts({});
      setProducts(result.data ?? []);
    });
  }

  const hasActiveFilters = Boolean(search || categorySlug || subcategorySlug || brandId);

  const activeChips = [
    search && { key: "search", label: `“${search}”`, onRemove: clearSearch },
    activeCategory && {
      key: "category",
      label: activeCategory.name,
      onRemove: () => selectCategory(activeCategory.slug),
    },
    activeSubcategory && {
      key: "subcategory",
      label: activeSubcategory.name,
      onRemove: () => selectSubcategory(categorySlug, activeSubcategory.slug),
    },
    activeBrand && {
      key: "brand",
      label: activeBrand.name,
      onRemove: () => selectBrand(activeBrand.id),
    },
  ].filter(Boolean);

  const filtersPanel = (
    <div className="space-y-7">
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[#C8A46A] hover:text-[#B8945A]"
        >
          <X size={13} />
          {t("resetFilters")}
        </button>
      )}

      <FilterSection
        title={t("categories")}
        isOpen={openSections.categories}
        onToggle={() => toggleSection("categories")}
        toggleLabel={t("toggleSection")}
      >
        <ul className="space-y-4">
          {categoriesByBrand.map((group) => (
            <li key={group.brand?.id ?? "unknown"}>
              <p className="mb-1.5 text-xs font-semibold text-[#2F3A2E]">{group.brand?.name ?? t("otherCategory")}</p>
              <ul className="space-y-1.5 border-l border-neutral-200 pl-3">
                {group.categories.map((cat) => (
                  <li key={cat.id}>
                    <button
                      type="button"
                      onClick={() => selectCategory(cat.slug)}
                      className={`text-left text-sm transition-colors ${
                        categorySlug === cat.slug ? "font-semibold text-[#C8A46A]" : "text-gray-600 hover:text-[#2F3A2E]"
                      }`}
                    >
                      {cat.name}
                    </button>
                    {activeCategory?.id === cat.id && cat.subcategories.length > 0 && (
                      <ul className="ml-3 mt-1.5 space-y-1 border-l border-neutral-200 pl-3">
                        {cat.subcategories.map((sub) => (
                          <li key={sub.id}>
                            <button
                              type="button"
                              onClick={() => selectSubcategory(cat.slug, sub.slug)}
                              className={`text-left text-sm transition-colors ${
                                subcategorySlug === sub.slug ? "font-semibold text-[#C8A46A]" : "text-gray-500 hover:text-[#2F3A2E]"
                              }`}
                            >
                              {sub.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {categories.length === 0 && <li className="text-sm text-gray-400">{t("emptyCategories")}</li>}
        </ul>
      </FilterSection>
    </div>
  );

  return (
    <div className="w-full bg-white">
      {/* Banner */}
      <div className="bg-[#2F3A2E] px-6 py-16 text-center md:px-10">
        <span className="mb-4 inline-block text-xs font-semibold uppercase tracking-[0.32em] text-[#C8A46A]">
          {t("title")} Meri Beauty
        </span>
        <h1 className="text-4xl text-[#F8F6F2] sm:text-5xl">{t("products")}</h1>
        <div className="mx-auto mt-6 h-[3px] w-16 rounded-full bg-[#C8A46A]" />
        <p className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-gray-300">
          {t("subtitle")}
        </p>
      </div>

      <div className="mx-auto max-w-[1400px] px-6 py-10 md:px-10 lg:px-14">
        {/* Collection toolbar */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <form onSubmit={handleSearchSubmit} className="relative w-full max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full border border-neutral-200 py-2.5 pl-9 pr-4 text-sm transition-colors focus:border-[#C8A46A] focus:outline-none"
            />
          </form>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex items-center gap-2 border border-neutral-200 px-4 py-2.5 text-sm font-medium text-[#2F3A2E] lg:hidden"
            >
              <SlidersHorizontal size={15} />
              {t("filters")}
              {hasActiveFilters && <span className="h-1.5 w-1.5 rounded-full bg-[#C8A46A]" />}
            </button>

            {/* View mode toggle */}
            <div className="flex items-center border border-neutral-200">
              {VIEW_OPTIONS.map(({ value, Icon, labelKey }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeView(value)}
                  aria-label={t(labelKey)}
                  aria-pressed={view === value}
                  title={t(labelKey)}
                  className={`flex h-[42px] w-[42px] items-center justify-center transition-colors ${
                    view === value ? "bg-[#2F3A2E] text-[#F8F6F2]" : "text-gray-400 hover:text-[#2F3A2E]"
                  }`}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>

            <select
              value={sort}
              onChange={(e) => changeSort(e.target.value)}
              className="border border-neutral-200 py-2.5 pl-3 pr-8 text-sm text-[#2F3A2E] focus:border-[#C8A46A] focus:outline-none"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_1fr]">
          {/* Filters sidebar — desktop */}
          <aside className="hidden lg:block">
            <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-3">
              {filtersPanel}
            </div>
          </aside>

          {/* Filters drawer — mobile/tablet */}
          {filtersOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <button
                type="button"
                aria-label={t("resetFilters")}
                onClick={() => setFiltersOpen(false)}
                className="absolute inset-0 bg-black/40"
              />
              <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
                  <span className="text-sm font-semibold uppercase tracking-[0.15em] text-[#2F3A2E]">
                    {t("filters")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="text-gray-400 hover:text-[#2F3A2E]"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-6">{filtersPanel}</div>
              </div>
            </div>
          )}

          {/* Product column */}
          <div>
            {/* Results bar: count + active-filter chips */}
            <div className="mb-6 flex flex-wrap items-center gap-2.5">
              <span className={`text-sm ${isPending ? "text-gray-300" : "text-gray-500"}`}>
                {t("productCount", { count: products.length })}
              </span>
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={t("removeFilter")}
                  className="flex items-center gap-1.5 border border-neutral-200 px-2.5 py-1 text-xs text-[#2F3A2E] transition-colors hover:border-[#C8A46A] hover:text-[#C8A46A]"
                >
                  {chip.label}
                  <X size={12} />
                </button>
              ))}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium uppercase tracking-wide text-[#C8A46A] hover:text-[#B8945A]"
                >
                  {t("resetFilters")}
                </button>
              )}
            </div>

            <div className={isPending ? "opacity-50 transition-opacity" : "transition-opacity"}>
              {products.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                  <p className="text-lg text-[#2F3A2E]">{t("noProductMatch")}</p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-sm font-medium text-[#C8A46A] hover:text-[#B8945A]"
                    >
                      {t("resetFilters")}
                    </button>
                  )}
                </div>
              ) : (
                <div className={GRID_CLASSES[view]}>
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      variant={view === "list" ? "list" : "grid"}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
