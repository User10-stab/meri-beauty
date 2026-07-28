"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Plus, Pencil, Trash2, FolderOpen } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  deleteProductCategory,
  deleteProductSubcategory,
} from "@/actions/boutique/categories";
import { CategoryModal } from "@/components/dashboard/boutique/CategoryModal";
import { SubcategoryModal } from "@/components/dashboard/boutique/SubcategoryModal";

/**
 * Wix Collections-style: each category is a row that expands to show its
 * subcategories. Categories organize the catalogue; a product always
 * belongs to a subcategory, never the category directly.
 */
export function CategoriesPageClient({ initialCategories }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(() => new Set(initialCategories.map((c) => c.id)));
  const [categoryModal, setCategoryModal] = useState(null); // null | "new" | category
  const [subcategoryModal, setSubcategoryModal] = useState(null); // null | { categoryId, subcategory? }
  const [toDelete, setToDelete] = useState(null); // { type: "category"|"subcategory", id, name }
  const [isPending, startTransition] = useTransition();

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result =
        toDelete.type === "category"
          ? await deleteProductCategory(toDelete.id)
          : await deleteProductSubcategory(toDelete.id);

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
        <Button onClick={() => setCategoryModal("new")}>
          <Plus size={16} />
          Ajouter une catégorie
        </Button>
      </div>

      {initialCategories.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-stroke bg-white px-6 py-16 text-center dark:border-dark-3 dark:bg-gray-dark">
          <FolderOpen size={22} className="text-gray-300" />
          <div>
            <p className="font-medium text-gray-700">Aucune catégorie pour le moment</p>
            <p className="mt-1 text-sm text-gray-400">Créez votre première catégorie pour commencer à organiser le catalogue.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {initialCategories.map((cat) => {
            const isOpen = expanded.has(cat.id);
            return (
              <div key={cat.id} className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
                <div className="flex items-center gap-3 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggle(cat.id)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <ChevronDown
                      size={16}
                      className={`flex-shrink-0 text-gray-400 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800 dark:text-white">{cat.name}</span>
                        {!cat.isActive && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Inactive</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {cat.subcategories.length} sous-catégorie{cat.subcategories.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubcategoryModal({ categoryId: cat.id })}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e]/5"
                  >
                    <Plus size={13} />
                    Sous-catégorie
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoryModal(cat)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete({ type: "category", id: cat.id, name: cat.name })}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-stroke px-5 py-3 dark:border-dark-3">
                    {cat.subcategories.length === 0 ? (
                      <p className="py-2 text-sm text-gray-400">Aucune sous-catégorie.</p>
                    ) : (
                      <ul className="divide-y divide-gray-100">
                        {cat.subcategories.map((sub) => (
                          <li key={sub.id} className="flex items-center justify-between py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-700 dark:text-dark-6">{sub.name}</span>
                              {!sub.isActive && (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Inactive</span>
                              )}
                              <span className="text-xs text-gray-400">
                                {sub.productCount} produit{sub.productCount !== 1 ? "s" : ""}
                              </span>
                            </div>
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
                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CategoryModal
        open={!!categoryModal}
        category={categoryModal === "new" ? null : categoryModal}
        onClose={() => setCategoryModal(null)}
        onSaved={(savedCategory) => {
          setCategoryModal(null);
          // A brand-new category isn't in `expanded` yet — its id was only
          // ever added at mount time, so without this it would render
          // collapsed immediately after creation.
          if (savedCategory?.id) {
            setExpanded((prev) => new Set(prev).add(savedCategory.id));
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
          if (subcategoryModal?.categoryId) {
            setExpanded((prev) => new Set(prev).add(subcategoryModal.categoryId));
          }
          setSubcategoryModal(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title={toDelete?.type === "category" ? "Supprimer cette catégorie ?" : "Supprimer cette sous-catégorie ?"}
        message={toDelete ? `"${toDelete.name}" sera définitivement supprimée.` : ""}
        confirmLabel="Supprimer"
        danger
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
