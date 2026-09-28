"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronUp, ImageOff, LayoutGrid, Link2, Loader2, PackageSearch, Plus, RotateCcw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { getPointOfSaleCatalogue } from "@/actions/boutique/point-of-sale";
import { buildSearchEntry, rankSearchEntries, tokenizeSearchQuery } from "@/lib/counter/product-search";

/**
 * The till's product picker: every product in stock as a photo tile, in a
 * large scrollable grid, narrowed by brand → category → sous-catégorie
 * chips, a sort, and the forgiving search from lib/counter/product-search.
 * Out-of-stock products and variants are never shown for sale (Marie: "je
 * ne vends pas un produit qui n'est pas en stock") — only in the barcode
 * « Associer » mode, where linking a code is catalogue upkeep, not a sale.
 *
 * Built because typing names stopped scaling with the catalogue: the cashier
 * now finds a product by sight, and the grid opens on the best sellers so
 * most sales are one tap. The whole catalogue is loaded once (a few hundred
 * products) and filtered here, so chips and search react instantly; it is
 * re-fetched after each sale (refreshKey), on window focus and every
 * REFRESH_INTERVAL_MS, so a unit sold online drops out of the grid on its
 * own. The grid is still a snapshot: CounterCart re-checks live stock when
 * a tile is tapped and while the product sits in the cart, and the server
 * locks and re-checks it at payment.
 *
 * One tile per product. A product with several sizes/shades opens a picker
 * rather than listing near-identical tiles. While linkBarcode is set (an
 * unknown barcode was just scanned), a pick links that code instead of
 * adding to the cart — see CounterCart's « Associer » flow.
 *
 * The filters and grid fold away behind « Afficher les produits » so the
 * till stays compact when the cashier only scans. Folded by default, the
 * choice is remembered on this device, and typing a search or an unknown
 * scan unfolds it on its own — a result is never hidden behind the button.
 */

const EXPANDED_STORAGE_KEY = "meri-pos-catalogue-expanded";

const SORTS = [
  { value: "popular", label: "Meilleures ventes" },
  { value: "name", label: "Nom A → Z" },
  { value: "price-asc", label: "Prix croissant" },
  { value: "price-desc", label: "Prix décroissant" },
];

const FOCUS_REFRESH_MS = 30_000;
const REFRESH_INTERVAL_MS = 20_000;

function formatPrice(value) {
  return `${value.toFixed(2)} €`;
}

function priceLabel(product) {
  const prices = product.variants.map((variant) => variant.unitPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min) : `dès ${formatPrice(min)}`;
}

function availableOf(product) {
  return product.variants.reduce((sum, variant) => sum + variant.availableQuantity, 0);
}

function variantLabel(product, variant) {
  return variant.variantName && variant.variantName !== "Standard" ? `${product.name} — ${variant.variantName}` : product.name;
}

function Chip({ active, onClick, children, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors ${
        active
          ? "border-[#2f3a2e] bg-[#2f3a2e] text-white"
          : "border-gray-200 bg-white text-gray-700 hover:border-[#2f3a2e] hover:text-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6 dark:hover:text-white"
      }`}
    >
      {children}
      {count !== undefined && <span className={`text-xs ${active ? "text-white/70" : "text-gray-400"}`}>{count}</span>}
    </button>
  );
}

function StockBadge({ available, low }) {
  if (available <= 0) {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
        Rupture
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        low
          ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      }`}
    >
      {available} en stock
    </span>
  );
}

function ProductPhoto({ path, dimmed, sizes }) {
  if (!path) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-dark-2">
        <ImageOff size={22} className="text-gray-300" />
      </div>
    );
  }
  return (
    <Image src={path} alt="" fill sizes={sizes} className={`object-cover ${dimmed ? "opacity-40 grayscale" : ""}`} />
  );
}

export function CounterCatalogue({ refreshKey = 0, cart, onAdd, linkBarcode = null, onPickForLink }) {
  const [products, setProducts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [brandId, setBrandId] = useState(null);
  const [categoryId, setCategoryId] = useState(null);
  const [subcategoryId, setSubcategoryId] = useState(null);
  const [linkableOnly, setLinkableOnly] = useState(true);
  const [sort, setSort] = useState("popular");
  const [pickerProduct, setPickerProduct] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const searchInputRef = useRef(null);
  const lastFetchRef = useRef(0);
  const requestRef = useRef(0);

  // Read after mount: localStorage doesn't exist during the server render.
  useEffect(() => {
    try {
      if (localStorage.getItem(EXPANDED_STORAGE_KEY) === "1") setExpanded(true);
    } catch {
      // Private window / blocked storage: just start folded.
    }
  }, []);

  function toggleExpanded(next) {
    setExpanded(next);
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Not remembered — harmless.
    }
  }

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    lastFetchRef.current = Date.now();
    const result = await getPointOfSaleCatalogue();
    if (requestId !== requestRef.current) return;
    if (!result.success) {
      setLoadError(result.message);
      return;
    }
    setLoadError(null);
    setProducts(result.data);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Another till, an online order or a restock moves stock too.
  useEffect(() => {
    function onFocus() {
      if (Date.now() - lastFetchRef.current > FOCUS_REFRESH_MS) load();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Online orders reserve stock without anyone touching the till.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // An unknown barcode was just scanned: start the pick from a clean grid,
  // showing only products that can still take a code.
  useEffect(() => {
    if (!linkBarcode) return;
    setQuery("");
    setLinkableOnly(true);
    setPickerProduct(null);
    setExpanded(true);
    searchInputRef.current?.focus();
  }, [linkBarcode]);

  // Keep an open picker in sync with refreshed stock figures.
  useEffect(() => {
    if (!pickerProduct || !products) return;
    const fresh = products.find((product) => product.id === pickerProduct.id);
    setPickerProduct(fresh ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const inCartByVariant = useMemo(() => {
    const map = new Map();
    for (const line of cart) if (line.variantId) map.set(line.variantId, (map.get(line.variantId) ?? 0) + line.quantity);
    return map;
  }, [cart]);

  const searchItems = useMemo(
    () =>
      (products ?? []).flatMap((product) =>
        product.variants.map((variant) => ({
          productId: product.id,
          searchEntry: buildSearchEntry({
            productName: product.name,
            variantName: variant.variantName,
            brandName: product.brandName,
            categoryNames: [product.categoryName, product.subcategoryName],
            sku: variant.sku,
            barcode: variant.barcode,
          }),
        }))
      ),
    [products]
  );

  const searching = tokenizeSearchQuery(query).length > 0;
  const scoreByProduct = useMemo(() => {
    if (!searching) return null;
    const map = new Map();
    for (const { item, score } of rankSearchEntries(searchItems, query)) {
      map.set(item.productId, Math.max(map.get(item.productId) ?? 0, score));
    }
    return map;
  }, [searchItems, query, searching]);

  // Facets are counted on everything except the facet itself, so a chip's
  // number is what you get by tapping it.
  const baseFiltered = useMemo(
    () =>
      (products ?? []).filter((product) => {
        if (scoreByProduct && !scoreByProduct.has(product.id)) return false;
        if (!linkBarcode && availableOf(product) <= 0) return false;
        if (linkBarcode && linkableOnly && !product.variants.some((variant) => variant.barcodeLinkable)) return false;
        return true;
      }),
    [products, scoreByProduct, linkBarcode, linkableOnly]
  );

  const brands = useMemo(() => {
    const map = new Map();
    for (const product of baseFiltered) {
      const key = product.brandId ?? "none";
      const entry = map.get(key) ?? { id: product.brandId, name: product.brandName ?? "Sans marque", count: 0 };
      entry.count += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => (a.id === null) - (b.id === null) || a.name.localeCompare(b.name, "fr"));
  }, [baseFiltered]);

  const inBrand = useMemo(
    () => (brandId === null ? baseFiltered : baseFiltered.filter((product) => (product.brandId ?? "none") === brandId)),
    [baseFiltered, brandId]
  );

  const categories = useMemo(() => {
    if (brandId === null) return [];
    const map = new Map();
    for (const product of inBrand) {
      if (!product.categoryId) continue;
      const entry = map.get(product.categoryId) ?? { id: product.categoryId, name: product.categoryName, position: product.categoryPosition, count: 0 };
      entry.count += 1;
      map.set(product.categoryId, entry);
    }
    return [...map.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "fr"));
  }, [inBrand, brandId]);

  const inCategory = useMemo(
    () => (categoryId === null ? inBrand : inBrand.filter((product) => product.categoryId === categoryId)),
    [inBrand, categoryId]
  );

  const subcategories = useMemo(() => {
    if (categoryId === null) return [];
    const map = new Map();
    for (const product of inCategory) {
      if (!product.subcategoryId) continue;
      const entry = map.get(product.subcategoryId) ?? { id: product.subcategoryId, name: product.subcategoryName, position: product.subcategoryPosition, count: 0 };
      entry.count += 1;
      map.set(product.subcategoryId, entry);
    }
    const list = [...map.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "fr"));
    return list.length > 1 ? list : [];
  }, [inCategory, categoryId]);

  const visible = useMemo(() => {
    const rows = subcategoryId === null ? inCategory : inCategory.filter((product) => product.subcategoryId === subcategoryId);
    const minPrice = (product) => Math.min(...product.variants.map((variant) => variant.unitPrice));
    return [...rows].sort((a, b) => {
      // Sellable first; an empty product stays listed (it exists, it's just
      // out) but never above one that can be sold.
      const aSellable = availableOf(a) > 0;
      const bSellable = availableOf(b) > 0;
      if (aSellable !== bSellable) return aSellable ? -1 : 1;
      if (scoreByProduct && sort === "popular") {
        const diff = (scoreByProduct.get(b.id) ?? 0) - (scoreByProduct.get(a.id) ?? 0);
        if (diff !== 0) return diff;
      }
      if (sort === "price-asc") return minPrice(a) - minPrice(b);
      if (sort === "price-desc") return minPrice(b) - minPrice(a);
      if (sort === "popular" && a.sold !== b.sold) return b.sold - a.sold;
      return a.name.localeCompare(b.name, "fr");
    });
  }, [inCategory, subcategoryId, scoreByProduct, sort]);

  // Selecting a facet that the search/stock filters then empty out would
  // leave the grid blank with the chip no longer shown — drop it instead.
  useEffect(() => {
    if (brandId !== null && !brands.some((brand) => (brand.id ?? "none") === brandId)) setBrandId(null);
  }, [brands, brandId]);
  useEffect(() => {
    if (categoryId !== null && !categories.some((category) => category.id === categoryId)) setCategoryId(null);
  }, [categories, categoryId]);
  useEffect(() => {
    if (subcategoryId !== null && !subcategories.some((subcategory) => subcategory.id === subcategoryId)) setSubcategoryId(null);
  }, [subcategories, subcategoryId]);

  const filtersActive = brandId !== null || query.trim() !== "" || sort !== "popular";

  function resetFilters() {
    setQuery("");
    setBrandId(null);
    setCategoryId(null);
    setSubcategoryId(null);
    setSort("popular");
  }

  function selectBrand(id) {
    setBrandId((current) => (current === id ? null : id));
    setCategoryId(null);
    setSubcategoryId(null);
  }

  function selectCategory(id) {
    setCategoryId((current) => (current === id ? null : id));
    setSubcategoryId(null);
  }

  function chooseVariant(product, variant) {
    const item = {
      variantId: variant.variantId,
      productName: product.name,
      variantName: variant.variantName,
      unitPrice: variant.unitPrice,
      availableQuantity: variant.availableQuantity,
      barcodeLinkable: variant.barcodeLinkable,
      hasInternalBarcode: variant.hasInternalBarcode,
    };
    if (linkBarcode) {
      if (!variant.barcodeLinkable) {
        toast.error("Ce produit a déjà un code-barres fournisseur — pour le changer, modifiez la fiche produit.");
        return;
      }
      setPickerProduct(null);
      onPickForLink(item);
      return;
    }
    // onAdd re-checks live stock first (async) and says whether it added.
    Promise.resolve(onAdd(item)).then((added) => {
      if (added) setPickerProduct(null);
    });
  }

  function openProduct(product) {
    const choices = pickableVariants(product);
    if (choices.length === 1) {
      chooseVariant(product, choices[0]);
      return;
    }
    setPickerProduct(product);
  }

  // Only what can be sold (or, when linking a barcode, every variant).
  function pickableVariants(product) {
    return linkBarcode ? product.variants : product.variants.filter((variant) => variant.availableQuantity > 0);
  }

  function handleSearchKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      // One match left: Enter takes it, like a scan.
      if (visible.length === 1) openProduct(visible[0]);
    } else if (event.key === "Escape" && query) {
      setQuery("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim()) setExpanded(true);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Chercher : nom, marque, teinte, contenance, référence…"
            autoComplete="off"
            aria-label="Rechercher un produit par nom"
            className="h-11 w-full rounded-lg border border-gray-200 pl-10 pr-9 text-sm outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition-colors hover:text-gray-600"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {linkBarcode && (
          <label className="flex h-11 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
            <input type="checkbox" checked={linkableOnly} onChange={(event) => setLinkableOnly(event.target.checked)} className="h-4 w-4 accent-sky-700" />
            Sans code-barres uniquement
          </label>
        )}
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          aria-label="Trier les produits"
          className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {searching && option.value === "popular" ? "Pertinence" : option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => toggleExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="counter-catalogue-panel"
          className={`flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
            expanded
              ? "border border-[#2f3a2e] text-[#2f3a2e] hover:bg-[#2f3a2e]/5 dark:border-dark-3 dark:text-white"
              : "bg-[#2f3a2e] text-white hover:bg-[#2f3a2e]/90"
          }`}
        >
          {expanded ? <ChevronUp size={16} /> : <LayoutGrid size={16} />}
          {expanded ? "Masquer les produits" : `Afficher les produits${products ? ` (${visible.length})` : ""}`}
          {!expanded && <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div id="counter-catalogue-panel" className="space-y-3">
          {brands.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Marques">
              <Chip active={brandId === null} onClick={() => selectBrand(null)} count={baseFiltered.length}>
                Toutes les marques
              </Chip>
              {brands.map((brand) => (
                <Chip key={brand.id ?? "none"} active={brandId === (brand.id ?? "none")} onClick={() => selectBrand(brand.id ?? "none")} count={brand.count}>
                  {brand.name}
                </Chip>
              ))}
            </div>
          )}

          {categories.length > 1 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Catégories">
              <Chip active={categoryId === null} onClick={() => selectCategory(null)}>
                Toutes les catégories
              </Chip>
              {categories.map((category) => (
                <Chip key={category.id} active={categoryId === category.id} onClick={() => selectCategory(category.id)} count={category.count}>
                  {category.name}
                </Chip>
              ))}
            </div>
          )}

          {subcategories.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Sous-catégories">
              <Chip active={subcategoryId === null} onClick={() => setSubcategoryId(null)}>
                Tout
              </Chip>
              {subcategories.map((subcategory) => (
                <Chip
                  key={subcategory.id}
                  active={subcategoryId === subcategory.id}
                  onClick={() => setSubcategoryId((current) => (current === subcategory.id ? null : subcategory.id))}
                  count={subcategory.count}
                >
                  {subcategory.name}
                </Chip>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-dark-6">
            <span>
              {products === null ? "Chargement du catalogue…" : `${visible.length} produit${visible.length > 1 ? "s" : ""}`}
            </span>
            {filtersActive && (
              <button type="button" onClick={resetFilters} className="flex items-center gap-1 font-semibold text-[#2f3a2e] hover:underline dark:text-white">
                <RotateCcw size={12} />
                Réinitialiser
              </button>
            )}
          </div>

          <div className="h-[min(68vh,760px)] min-h-[360px] overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/60 p-3 dark:border-dark-3 dark:bg-dark-2/40">
            {products === null && !loadError && (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                Chargement du catalogue…
              </div>
            )}

            {loadError && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
                {loadError}
                <button type="button" onClick={load} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-white">
                  Réessayer
                </button>
              </div>
            )}

            {products !== null && visible.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500">
                <PackageSearch size={22} className="text-gray-400" />
                {query.trim() ? `Aucun produit ne correspond à « ${query.trim()} ».` : "Aucun produit dans ce filtre."}
                {filtersActive && (
                  <button type="button" onClick={resetFilters} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                    Réinitialiser les filtres
                  </button>
                )}
              </div>
            )}

            {visible.length > 0 && (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {visible.map((product) => {
                  const available = availableOf(product);
                  const outOfStock = available <= 0;
                  const inCart = product.variants.reduce((sum, variant) => sum + (inCartByVariant.get(variant.variantId) ?? 0), 0);
                  const linkable = product.variants.some((variant) => variant.barcodeLinkable);
                  const dimmed = linkBarcode ? !linkable : outOfStock;
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => openProduct(product)}
                        title={variantLabel(product, product.variants[0])}
                        className={`group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3a2e] dark:bg-gray-dark ${
                          inCart > 0 ? "border-[#2f3a2e] ring-1 ring-[#2f3a2e]" : "border-gray-200 dark:border-dark-3"
                        }`}
                      >
                        <div className="relative aspect-square w-full bg-gray-50 dark:bg-dark-2">
                          <ProductPhoto path={product.imagePath} dimmed={dimmed} sizes="(max-width: 640px) 50vw, 200px" />
                          {inCart > 0 && (
                            <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-[#2f3a2e] px-2 text-xs font-bold text-white shadow">
                              {inCart}
                            </span>
                          )}
                          {pickableVariants(product).length > 1 && (
                            <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-gray-700 shadow-sm dark:bg-dark-2/90 dark:text-dark-6">
                              {pickableVariants(product).length} choix
                            </span>
                          )}
                          {linkBarcode && linkable && (
                            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-sky-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                              <Link2 size={11} />
                              Associer
                            </span>
                          )}
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-2.5">
                          {product.brandName && (
                            <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-[#c8a46a]">{product.brandName}</span>
                          )}
                          <span className={`line-clamp-2 text-sm font-semibold leading-snug ${dimmed ? "text-gray-400 dark:text-dark-6" : "text-gray-900 dark:text-white"}`}>
                            {product.name}
                          </span>
                          <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-1">
                            <span className="text-sm font-bold text-gray-900 dark:text-white">{priceLabel(product)}</span>
                            <StockBadge available={available} low={product.variants.some((variant) => variant.isLowStock)} />
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {pickerProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="counter-variant-picker-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPickerProduct(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setPickerProduct(null);
          }}
        >
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-dark">
            <div className="flex items-start gap-4 border-b border-gray-100 p-4 dark:border-dark-3">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-gray-100 dark:border-dark-3">
                <ProductPhoto path={pickerProduct.imagePath} sizes="80px" />
              </div>
              <div className="min-w-0 flex-1">
                {pickerProduct.brandName && (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#c8a46a]">{pickerProduct.brandName}</p>
                )}
                <h2 id="counter-variant-picker-title" className="text-base font-bold text-gray-900 dark:text-white">
                  {pickerProduct.name}
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {linkBarcode ? `Choisissez la variante à associer au code ${linkBarcode}.` : "Choisissez la contenance ou la teinte."}
                </p>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setPickerProduct(null)}
                aria-label="Fermer"
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-2"
              >
                <X size={18} />
              </button>
            </div>
            <ul className="divide-y divide-gray-100 overflow-y-auto dark:divide-dark-3">
              {pickableVariants(pickerProduct).map((variant) => {
                const inCart = inCartByVariant.get(variant.variantId) ?? 0;
                const outOfStock = variant.availableQuantity <= 0;
                const maxedOut = !outOfStock && inCart >= variant.availableQuantity;
                const disabled = linkBarcode ? !variant.barcodeLinkable : outOfStock || maxedOut;
                return (
                  <li key={variant.variantId} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{variant.variantName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-gray-900 dark:text-white">{formatPrice(variant.unitPrice)}</span>
                        <StockBadge available={variant.availableQuantity} low={variant.isLowStock} />
                        {inCart > 0 && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-dark-3 dark:text-dark-6">
                            {inCart} au panier
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => chooseVariant(pickerProduct, variant)}
                      title={
                        linkBarcode && !variant.barcodeLinkable
                          ? "A déjà un code-barres fournisseur — modifiez la fiche produit pour le changer"
                          : maxedOut && !linkBarcode
                            ? "Tout le stock disponible est déjà au panier"
                            : undefined
                      }
                      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-dark-3 dark:disabled:text-dark-6 ${
                        linkBarcode ? "bg-sky-700 hover:bg-sky-700/90" : "bg-[#2f3a2e] hover:bg-[#2f3a2e]/90"
                      }`}
                    >
                      {linkBarcode ? <Link2 size={15} /> : <Plus size={15} />}
                      {linkBarcode ? (variant.barcodeLinkable ? "Associer" : "A déjà un code") : maxedOut ? "Max" : "Ajouter"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
