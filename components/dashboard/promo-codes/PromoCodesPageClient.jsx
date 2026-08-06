"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Tag } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/dashboard/Tables/RowActions";
import { deletePromoCode } from "@/actions/promo-codes";
import { PromoCodeModal } from "./PromoCodeModal";

function formatValue(promo) {
  return promo.type === "PERCENTAGE" ? `${promo.value}%` : `${promo.value.toFixed(2)} €`;
}

export function PromoCodesPageClient({ initialPromoCodes }) {
  const [promoCodes, setPromoCodes] = useState(initialPromoCodes);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [isPending, startTransition] = useTransition();

  function refresh(updated) {
    // Re-fetch isn't needed for a flat admin list this size — server actions
    // already return the saved row, so just patch local state directly.
    setPromoCodes((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      return exists ? prev.map((p) => (p.id === updated.id ? updated : p)) : [updated, ...prev];
    });
  }

  function handleDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result = await deletePromoCode(toDelete.id);
      if (result.success) {
        toast.success(result.message);
        setPromoCodes((prev) => prev.map((p) => (p.id === toDelete.id ? { ...p, isActive: false } : p)));
      } else {
        toast.error(result.message);
      }
      setToDelete(null);
    });
  }

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex items-center justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
        <p className="text-sm text-gray-500 dark:text-dark-6">{promoCodes.length} code(s) au total</p>
        <Button
          onClick={() => {
            setEditing(null);
            setShowModal(true);
          }}
        >
          <Plus size={16} />
          Ajouter un code
        </Button>
      </div>

      {promoCodes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Tag size={28} className="text-gray-300" />
          <p className="text-sm text-gray-500">Aucun code promo pour l'instant.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Code</TableHead>
              <TableHead>Réduction</TableHead>
              <TableHead>Minimum de commande</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {promoCodes.map((promo) => (
              <TableRow key={promo.id}>
                <TableCell className="pl-6 font-mono text-sm font-semibold text-gray-900 dark:text-white">
                  {promo.code}
                </TableCell>
                <TableCell>{formatValue(promo)}</TableCell>
                <TableCell>{promo.minOrderAmount != null ? `${promo.minOrderAmount.toFixed(2)} €` : "—"}</TableCell>
                <TableCell>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      promo.isActive
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "bg-gray-100 text-gray-500 dark:bg-dark-2 dark:text-dark-6"
                    }`}
                  >
                    {promo.isActive ? "Actif" : "Inactif"}
                  </span>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <RowActions
                    row={promo}
                    onEdit={() => {
                      setEditing(promo);
                      setShowModal(true);
                    }}
                    onDelete={promo.isActive ? () => setToDelete(promo) : undefined}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <PromoCodeModal
        open={showModal}
        promoCode={editing}
        onClose={() => setShowModal(false)}
        onSaved={(data) => {
          if (data) refresh(data);
          setShowModal(false);
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Désactiver ce code promo ?"
        message={toDelete ? `Le code "${toDelete.code}" ne pourra plus être utilisé, mais reste visible dans l'historique.` : ""}
        confirmLabel="Désactiver"
        danger
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
