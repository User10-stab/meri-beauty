"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "@/components/dashboard/Tables/DataTable";
import { ReviewRow } from "./ReviewRow";
import { ReviewEmptyState } from "./ReviewEmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteReview } from "@/actions/review/review-actions";

const COLUMNS = [
  { key: "customer", label: "Client" },
  { key: "rating", label: "Note" },
  { key: "service", label: "Service" },
  { key: "staff", label: "Staff" },
  { key: "comment", label: "Commentaire" },
  { key: "date", label: "Date" },
];

/**
 * Client shell for the reviews page.
 * Handles view and delete actions.
 */
export function ReviewsPageClient({ initialData }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);

  // −−− Confirmation dialog state −−−
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    danger: false,
    onConfirm: null,
  });

  const handleMutated = useCallback(() => {
    router.refresh();
  }, [router]);

  /** Updates a single review in local state (e.g. after deletion). */
  const updateLocalReview = useCallback((id, updates) => {
    setData((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  // ─── Delete flow ──────────────────────────────────────────────────────
  const handleDelete = useCallback((review) => {
    setConfirmDialog({
      open: true,
      title: "Supprimer l'avis",
      message: `Êtes-vous sûr de vouloir supprimer l'avis de ${review.customerName} ? Cette action est irréversible.`,
      danger: true,
      onConfirm: async () => {
        try {
          setLoading(true);
          const result = await deleteReview(review.id);

          if (result.success) {
            toast.success("Avis supprimé avec succès.");
            updateLocalReview(review.id, { isDeleted: true });
            setData((prev) => prev.filter((item) => item.id !== review.id));
            handleMutated();
          } else {
            toast.error(result.message || "Erreur lors de la suppression");
          }
        } catch (error) {
          console.error("[handleDelete]", error);
          toast.error("Erreur lors de la suppression de l'avis");
        } finally {
          setLoading(false);
          setConfirmDialog({ open: false, title: "", message: "", danger: false, onConfirm: null });
        }
      },
    });
  }, [updateLocalReview, handleMutated]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDialog({ open: false, title: "", message: "", danger: false, onConfirm: null });
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────
  if (data.length === 0) {
    return <ReviewEmptyState />;
  }

  return (
    <>
      <DataTable
        columns={COLUMNS}
        data={data}
        renderRow={ReviewRow}
        onDelete={handleDelete}
        emptyState={ReviewEmptyState}
        searchPlaceholder="Rechercher par client, service..."
        searchFilter={(review, query) => {
          const q = query.toLowerCase();
          return (
            review.customerName?.toLowerCase().includes(q) ||
            review.customerEmail?.toLowerCase().includes(q) ||
            review.serviceName?.toLowerCase().includes(q) ||
            review.staffName?.toLowerCase().includes(q) ||
            review.comment?.toLowerCase().includes(q)
          );
        }}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        danger={confirmDialog.danger}
        onConfirm={confirmDialog.onConfirm}
        onCancel={handleCancelDelete}
      />
    </>
  );
}
