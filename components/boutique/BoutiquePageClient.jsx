"use client";

import { useState, useTransition, useMemo } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { getStorefrontProducts } from "@/actions/boutique/storefront";
import { ProductCard } from "@/components/boutique/ProductCard";

const SORT_OPTIONS = [
  { value: "newest", label: "Nouveautés" },
  { value: "price-asc", label: "Prix croissant" },
  { value: "price-desc", label: "Prix décroissant" },
  { value: "name", label: "Nom (A–Z)" },
];

export function BoutiquePageClient({ initialProducts, categories, brands }) {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [categorySlug, setCategorySlug] = useState(null);
  const [brandId, setBrandId] = useState(null);
  const [sort, setSort] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const activeCategory = useMemo(
    () => categories.find((c) => c.slug === categorySlug) ?? null,
    [categories, categorySlug]
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

  function selectCategory(slug) {
    const next = slug === categorySlug ? null : slug;
    setCategorySlug(next);
    refetch({ categorySlug: next });
  }

  function selectBrand(id) {
    const next = id === brandId ? null : id;
    setBrandId(next);
    refetch({ brandId: next });
  }

  function changeSort(value) {
    setSort(value);
    refetch({ sort: value });
  }

  function clearFilters() {
    setSearch("");
    setCategorySlug(null);
    setBrandId(null);
    setSort("newest");
    startTransition(async () => {
      const result = await getStorefrontProducts({});
      setProducts(result.data ?? []);
    });
  }

  const hasActiveFilters = Boolean(search || categorySlug || brandId);

  return (
    <div className="w-full bg-white">
      {/* Banner */}
      <div className="bg-[#2F3A2E] px-6 py-16 text-center md:px-10">
        <span className="mb-4 inline-block text-xs font-semibold uppercase tracking-[0.32em] text-[#C8A46A]">
          Boutique Meri Beauty
        </span>
        <h1 className="text-4xl text-[#F8F6F2] sm:text-5xl">Nos produits</h1>
        <div className="mx-auto mt-6 h-[3px] w-16 rounded-full bg-[#C8A46A]" />
        <p className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-gray-300">
          Une sélection de soins et produits professionnels, à retirer en boutique ou à faire livrer chez vous.
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
              placeholder="Rechercher un produit…"
              className="w-full border border-neutral-200 py-2.5 pl-9 pr-4 text-sm transition-colors focus:border-[#C8A46A] focus:outline-none"
            />
          </form>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex items-center gap-2 border border-neutral-200 px-4 py-2.5 text-sm font-medium text-[#2F3A2E] lg:hidden"
            >
              <SlidersHorizontal size={15} />
              Filtres
            </button>
            <select
              value={sort}
              onChange={(e) => changeSort(e.target.value)}
              className="border border-neutral-200 py-2.5 pl-3 pr-8 text-sm text-[#2F3A2E] focus:border-[#C8A46A] focus:outline-none"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_1fr]">
          {/* Filters sidebar */}
          <aside className={`${filtersOpen ? "block" : "hidden"} lg:block`}>
            <div className="space-y-8 lg:sticky lg:top-24">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[#C8A46A] hover:text-[#B8945A]"
                >
                  <X size={13} />
                  Réinitialiser les filtres
                </button>
              )}

              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">
                  Catégories
                </h3>
                <ul className="space-y-4">
                  {categoriesByBrand.map((group) => (
                    <li key={group.brand?.id ?? "unknown"}>
                      <p className="mb-1.5 text-xs font-semibold text-[#2F3A2E]">{group.brand?.name ?? "Autre"}</p>
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
                            {activeCategory?.id === cat.id && cat.subcategories.filter(s => s.name !== "Général").length > 0 && (
                              <ul className="ml-3 mt-1.5 space-y-1 border-l border-neutral-200 pl-3">
                                {cat.subcategories.filter(s => s.name !== "Général").map((sub) => (
                                  <li key={sub.id} className="text-sm text-gray-500">
                                    {sub.name}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                  {categories.length === 0 && <li className="text-sm text-gray-400">Aucune catégorie.</li>}
                </ul>
              </div>

              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Marques</h3>
                <ul className="space-y-1.5">
                  {brands.map((brand) => (
                    <li key={brand.id}>
                      <button
                        type="button"
                        onClick={() => selectBrand(brand.id)}
                        className={`text-left text-sm transition-colors ${
                          brandId === brand.id ? "font-semibold text-[#C8A46A]" : "text-gray-600 hover:text-[#2F3A2E]"
                        }`}
                      >
                        {brand.name}
                      </button>
                    </li>
                  ))}
                  {brands.length === 0 && <li className="text-sm text-gray-400">Aucune marque.</li>}
                </ul>
              </div>
            </div>
          </aside>

          {/* Product grid */}
          <div className={isPending ? "opacity-50 transition-opacity" : "transition-opacity"}>
            {products.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <p className="text-lg text-[#2F3A2E]">Aucun produit ne correspond à votre recherche.</p>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm font-medium text-[#C8A46A] hover:text-[#B8945A]"
                  >
                    Réinitialiser les filtres
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
