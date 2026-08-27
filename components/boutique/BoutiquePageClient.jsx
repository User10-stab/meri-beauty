"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { getStorefrontProducts } from "@/actions/boutique/storefront";
import { ProductCard } from "@/components/boutique/ProductCard";
import { useTranslations } from "next-intl";

const SORT_OPTIONS = [
  { value: "newest", labelKey: "sortNewest" },
  { value: "price-asc", labelKey: "sortPriceAsc" },
  { value: "price-desc", labelKey: "sortPriceDesc" },
  { value: "name", labelKey: "sortName" },
];

export function BoutiquePageClient({ initialProducts, categories }) {
  const t = useTranslations("boutique");
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [categorySlug, setCategorySlug] = useState(null);
  const [subcategorySlug, setSubcategorySlug] = useState(null);
  const [sort, setSort] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const activeCategory = useMemo(
    () => categories.find((c) => c.slug === categorySlug) ?? null,
    [categories, categorySlug]
  );

  function refetch(next) {
    const params = {
      search: next.search ?? search,
      categorySlug: next.categorySlug !== undefined ? next.categorySlug : categorySlug,
      subcategorySlug: next.subcategorySlug !== undefined ? next.subcategorySlug : subcategorySlug,
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

  function selectCategory(slug) {
    const next = slug === categorySlug ? null : slug;
    setCategorySlug(next);
    setSubcategorySlug(null);
    refetch({ categorySlug: next, subcategorySlug: null });
  }

  function selectSubcategory(catSlug, subSlug) {
    const next = subSlug === subcategorySlug ? null : subSlug;
    setCategorySlug(catSlug);
    setSubcategorySlug(next);
    refetch({ categorySlug: catSlug, subcategorySlug: next });
  }

  function changeSort(value) {
    setSort(value);
    refetch({ sort: value });
  }

  function clearFilters() {
    setSearch("");
    setCategorySlug(null);
    setSubcategorySlug(null);
    setSort("newest");
    startTransition(async () => {
      const result = await getStorefrontProducts({});
      setProducts(result.data ?? []);
    });
  }

  const hasActiveFilters = Boolean(search || categorySlug || subcategorySlug);

  const filtersPanel = (
    <div className="space-y-8">
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

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">
          {t("categories")}
        </h3>
        <ul className="space-y-1.5">
          {categories.map((cat) => (
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
          {categories.length === 0 && <li className="text-sm text-gray-400">{t("emptyCategories")}</li>}
        </ul>
      </div>
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
        {/* Search + sort bar */}
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

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex items-center gap-2 border border-neutral-200 px-4 py-2.5 text-sm font-medium text-[#2F3A2E] lg:hidden"
            >
              <SlidersHorizontal size={15} />
              {t("filters")}
              {hasActiveFilters && <span className="h-1.5 w-1.5 rounded-full bg-[#C8A46A]" />}
            </button>
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
            <div className="lg:sticky lg:top-24">{filtersPanel}</div>
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

          {/* Product grid */}
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
              <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
