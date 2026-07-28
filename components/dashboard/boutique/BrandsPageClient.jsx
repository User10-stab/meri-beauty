"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Tag } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { RowActions } from "@/components/dashboard/Tables/RowActions";
import { deleteBrand } from "@/actions/boutique/brands";
import { BrandModal } from "@/components/dashboard/boutique/BrandModal";

export function BrandsPageClient({ initialBrands }) {
  const router = useRouter();
  const [modal, setModal] = useState(null); // null | "new" | brand
  const [toDelete, setToDelete] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result = await deleteBrand(toDelete.id);
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
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex items-center justify-end border-b border-stroke px-6 py-4 dark:border-dark-3">
        <Button onClick={() => setModal("new")}>
          <Plus size={16} />
          Ajouter une marque
        </Button>
      </div>

      {initialBrands.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Tag size={22} className="text-gray-300" />
          <div>
            <p className="font-medium text-gray-700">Aucune marque pour le moment</p>
            <p className="mt-1 text-sm text-gray-400">Ajoutez les marques vendues en boutique.</p>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Marque</TableHead>
              <TableHead>Produits</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialBrands.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="pl-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
                      {b.logo ? (
                        <img src={b.logo} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Tag size={14} className="text-gray-300" />
                      )}
                    </div>
                    <span className="font-medium text-gray-800 dark:text-white">{b.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-gray-600 dark:text-dark-6">{b.productCount}</span>
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                      b.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-gray-100 text-gray-500 border-gray-200"
                    }`}
                  >
                    {b.isActive ? "Active" : "Inactive"}
                  </span>
                </TableCell>
                <TableCell className="pr-6">
                  <RowActions row={b} onEdit={() => setModal(b)} onDelete={() => setToDelete(b)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <BrandModal
        open={!!modal}
        brand={modal === "new" ? null : modal}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Supprimer cette marque ?"
        message={
          toDelete
            ? `"${toDelete.name}" sera supprimée. ${toDelete.productCount ? `${toDelete.productCount} produit(s) conserveront leur référence.` : ""}`
            : ""
        }
        confirmLabel="Supprimer"
        danger
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
