"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Plus, Pencil, Trash2, FolderOpen, Tag, Package } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteBrand } from "@/actions/boutique/brands";
import { deleteProductCategory, deleteProductSubcategory } from "@/actions/boutique/categories";
import { deleteProduct } from "@/actions/boutique/products";
import { BrandModal } from "@/components/dashboard/boutique/BrandModal";
import { CategoryModal } from "@/components/dashboard/boutique/CategoryModal";
import { SubcategoryModal } from "@/components/dashboard/boutique/SubcategoryModal";
import { useTranslations } from "next-intl";

/**
 * Brand → Category → Subcategory, three nested accordions (client decision,
 * 29 Jul 2026 — brand is the root of the catalogue tree, so there's no
 * separate "Marques" page anymore; brand CRUD lives here, at the top).
 */
export function CategoriesPageClient({ initialBrands }) {
  const router = useRouter();
  const t = useTranslations("dashboardBoutique.categories");
  const [expandedBrands, setExpandedBrands] = useState(() => new Set(initialBrands.map((b) => b.id)));
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());
  const [expandedSubcategories, setExpandedSubcategories] = useState(() => new Set());
  const [brandModal, setBrandModal] = useState(null); // null | "new" | brand
  const [categoryModal, setCategoryModal] = useState(null); // null | { brandId, category? }
  const [subcategoryModal, setSubcategoryModal] = useState(null); // null | { categoryId, subcategory? }
  const [toDelete, setToDelete] = useState(null); // { type, id, name }
  const [isPending, startTransition] = useTransition();

  function toggleBrand(id) {
    setExpandedBrands((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleCategory(id) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSubcategory(id) {
    setExpandedSubcategories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result =
        toDelete.type === "brand"
          ? await deleteBrand(toDelete.id)
          : toDelete.type === "category"
          ? await deleteProductCategory(toDelete.id)
          : toDelete.type === "subcategory"
          ? await deleteProductSubcategory(toDelete.id)
          : await deleteProduct(toDelete.id);

      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
      setToDelete(null);
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setBrandModal("new")}>
          <Plus size={16} />
          {t("addBrand")}
        </Button>
      </div>

      {initialBrands.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-stroke bg-white px-6 py-16 text-center dark:border-dark-3 dark:bg-gray-dark">
          <Tag size={22} className="text-gray-300" />
          <div>
            <p className="font-medium text-gray-700">{t("noBrands")}</p>
            <p className="mt-1 text-sm text-gray-400">
              {t("noBrandsDesc")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {initialBrands.map((brand) => {
            const brandOpen = expandedBrands.has(brand.id);
            return (
              <div key={brand.id} className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
                <div className="flex items-center gap-3 bg-[#2f3a2e]/3 px-5 py-4">
                  <button type="button" onClick={() => toggleBrand(brand.id)} className="flex flex-1 items-center gap-3 text-left">
                    <ChevronDown size={16} className={`flex-shrink-0 text-gray-400 transition-transform ${brandOpen ? "" : "-rotate-90"}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">{brand.name}</span>
                        {!brand.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{t("inactive")}</span>}
                      </div>
                      <span className="text-xs text-gray-400">
                        {brand.categoryCount} {brand.categoryCount !== 1 ? t("categoryCount_plural") : t("categoryCount")} · {brand.productCount} {brand.productCount !== 1 ? t("productCount_plural") : t("productCount")}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategoryModal({ brandId: brand.id })}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e]/10"
                  >
                    <Plus size={13} />
                    {t("addCategory")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBrandModal(brand)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete({ type: "brand", id: brand.id, name: brand.name })}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {brandOpen && (
                  <div className="space-y-2 border-t border-stroke p-3 dark:border-dark-3">
                    {brand.categories.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8 text-center">
                        <FolderOpen size={18} className="text-gray-300" />
                        <p className="text-sm text-gray-400">{t("noCategories", { brand: brand.name })}</p>
                      </div>
                    ) : (
                      brand.categories.map((cat) => {
                        const catOpen = expandedCategories.has(cat.id);
                        return (
                          <div key={cat.id} className="rounded-lg border border-gray-100">
                            <div className="flex items-center gap-3 px-4 py-3">
                              <button type="button" onClick={() => toggleCategory(cat.id)} className="flex flex-1 items-center gap-3 text-left">
                                <ChevronDown size={14} className={`flex-shrink-0 text-gray-400 transition-transform ${catOpen ? "" : "-rotate-90"}`} />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-800 dark:text-white">{cat.name}</span>
                                    {!cat.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{t("inactive")}</span>}
                                  </div>
                                  <span className="text-xs text-gray-400">
                                    {cat.subcategories.length} {cat.subcategories.length !== 1 ? t("subcategoryCount_plural") : t("subcategoryCount")}
                                  </span>
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => setSubcategoryModal({ categoryId: cat.id })}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e]/5"
                              >
                                <Plus size={12} />
                                {t("addSubcategory")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setCategoryModal({ brandId: brand.id, category: cat })}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setToDelete({ type: "category", id: cat.id, name: cat.name })}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>

                            {catOpen && (
                              <div className="border-t border-gray-100 px-4 py-2">
                                {cat.subcategories.length === 0 ? (
                                  <p className="py-2 text-sm text-gray-400">{t("noSubcategories", { category: cat.name })}</p>
                                ) : (
                                  <ul className="divide-y divide-gray-100">
                                    {cat.subcategories.map((sub) => {
                                      const subOpen = expandedSubcategories.has(sub.id);
                                      const products = sub.products ?? [];
                                      return (
                                      <li key={sub.id} className="py-1">
                                        <div className="flex items-center justify-between py-1.5">
                                          <button
                                            type="button"
                                            onClick={() => toggleSubcategory(sub.id)}
                                            className="flex flex-1 items-center gap-2 text-left"
                                            disabled={sub.productCount === 0}
                                          >
                                            {sub.productCount > 0 && (
                                              <ChevronDown size={12} className={`flex-shrink-0 text-gray-400 transition-transform ${subOpen ? "" : "-rotate-90"}`} />
                                            )}
                                            <span className="text-sm text-gray-700 dark:text-dark-6">{sub.name}</span>
                                            {!sub.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{t("inactive")}</span>}
                                            <span className="text-xs text-gray-400">
                                              {sub.productCount} {sub.productCount !== 1 ? t("productCount_plural") : t("productCount")}
                                            </span>
                                          </button>
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => setSubcategoryModal({ categoryId: cat.id, subcategory: sub })}
                                              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                            >
                                              <Pencil size={13} />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setToDelete({ type: "subcategory", id: sub.id, name: sub.name })}
                                              disabled={sub.productCount > 0}
                                              title={sub.productCount > 0 ? t("cannotDeleteTooltip") : undefined}
                                              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                                            >
                                              <Trash2 size={13} />
                                            </button>
                                          </div>
                                        </div>

                                        {subOpen && products.length > 0 && (
                                          <ul className="ml-5 mb-2 space-y-1 border-l border-gray-100 pl-3">
                                            {products.map((product) => {
                                              const prices = product.variants.map((v) => Number(v.price));
                                              const priceLabel =
                                                prices.length === 0
                                                  ? "—"
                                                  : Math.min(...prices) === Math.max(...prices)
                                                  ? `€${Math.min(...prices).toFixed(2)}`
                                                  : `€${Math.min(...prices).toFixed(2)} – €${Math.max(...prices).toFixed(2)}`;
                                              const totalStock = product.variants.reduce(
                                                (sum, v) => sum + v.stockQuantity,
                                                0
                                              );
                                              return (
                                                <li key={product.id} className="flex items-center justify-between rounded-md py-1.5 pr-1 text-sm hover:bg-gray-50">
                                                  <div className="flex items-center gap-2 min-w-0">
                                                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                                                      {product.thumbnail ? (
                                                        <img src={product.thumbnail} alt="" className="h-full w-full object-cover" />
                                                      ) : (
                                                        <Package size={12} className="text-gray-300" />
                                                      )}
                                                    </div>
                                                    <span className="truncate text-gray-700 dark:text-dark-6">{product.name}</span>
                                                    {product.status !== "ACTIVE" && (
                                                      <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                                                        {product.status === "DRAFT" ? t("statusDraft") : t("statusArchived")}
                                                      </span>
                                                    )}
                                                    <span className="flex-shrink-0 text-xs text-gray-400">{priceLabel}</span>
                                                    <span className="flex-shrink-0 text-xs text-gray-400">{t("stockLabel", { count: totalStock })}</span>
                                                  </div>
                                                  <div className="flex flex-shrink-0 items-center gap-1">
                                                    <button
                                                      type="button"
                                                      onClick={() => router.push(`/dashboard/boutique/products/${product.id}`)}
                                                      className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                                      title={t("edit")}
                                                    >
                                                      <Pencil size={12} />
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => setToDelete({ type: "product", id: product.id, name: product.name })}
                                                      className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                                                      title={t("deleteProduct")}
                                                    >
                                                      <Trash2 size={12} />
                                                    </button>
                                                  </div>
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        )}
                                      </li>
                                    );
                                    })}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <BrandModal
        open={!!brandModal}
        brand={brandModal === "new" ? null : brandModal}
        onClose={() => setBrandModal(null)}
        onSaved={() => {
          setBrandModal(null);
          router.refresh();
        }}
      />

      <CategoryModal
        open={!!categoryModal}
        category={categoryModal?.category ?? null}
        brands={initialBrands}
        defaultBrandId={categoryModal?.brandId ?? null}
        onClose={() => setCategoryModal(null)}
        onSaved={(savedCategory) => {
          setCategoryModal(null);
          if (savedCategory?.id) {
            setExpandedCategories((prev) => new Set(prev).add(savedCategory.id));
          }
          router.refresh();
        }}
      />

      <SubcategoryModal
        open={!!subcategoryModal}
        categoryId={subcategoryModal?.categoryId}
        subcategory={subcategoryModal?.subcategory ?? null}
        onClose={() => setSubcategoryModal(null)}
        onSaved={() => {
          setSubcategoryModal(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title={
          toDelete?.type === "brand"
            ? t("deleteBrand")
            : toDelete?.type === "category"
            ? t("deleteCategory")
            : toDelete?.type === "subcategory"
            ? t("deleteSubcategory")
            : t("deleteProduct")
        }
        message={
          toDelete
            ? toDelete.type === "product"
              ? t("deleteProductMessage", { name: toDelete.name })
              : toDelete.type === "brand"
              ? t("deleteBrandMessage", { name: toDelete.name })
              : toDelete.type === "category"
              ? t("deleteCategoryMessage", { name: toDelete.name })
              : t("deleteSubcategoryMessage", { name: toDelete.name })
            : ""
        }
        confirmLabel={t("deleteConfirm")}
        danger
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
