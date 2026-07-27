"use client";

import { useState, useCallback, useEffect  } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MailPlus } from "lucide-react";
import { DataTable } from "@/components/dashboard/Tables/DataTable";
import { NewsletterRow } from "./NewsletterRow";
import { NewsletterEmptyState } from "./NewsletterEmptyState";
import { NewsletterViewModal } from "./NewsletterViewModal";
import { NewsletterCreateEditModal } from "./NewsletterCreateEditModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { createNewsletter } from "@/actions/newsletter/create-newsletter";
import { updateNewsletter } from "@/actions/newsletter/update-newsletter";
import { deleteNewsletter } from "@/actions/newsletter/delete-newsletter";
import { sendNewsletter } from "@/actions/newsletter/send-newsletter";

const NEWSLETTER_COLUMNS = [
  { key: "title", label: "Titre" },
  { key: "subject", label: "Objet" },
  { key: "createdAt", label: "Créée le" },
  { key: "sentAt", label: "Envoyée le" },
  { key: "status", label: "Statut" },
  { key: "recipientCount", label: "Destinataires" },
];

/**
 * Client shell for the newsletter management page.
 */
export function NewsletterPageClient({ initialData }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(initialData);
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  // ── Modal states ──────────────────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNewsletter, setEditingNewsletter] = useState(null);
  const [viewingNewsletter, setViewingNewsletter] = useState(null);

  // ── Confirmation dialog state ─────────────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    danger: false,
    confirmLabel: "Confirmer",
    onConfirm: null,
  });

  const handleMutated = useCallback(() => {
    router.refresh();
  }, [router]);

  const updateLocalData = useCallback((id, updates) => {
    setData((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const removeLocalData = useCallback((id) => {
    setData((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // ── View ──────────────────────────────────────────────────────────────────
  const handleView = useCallback((row) => {
    setViewingNewsletter(row);
  }, []);

  // ── Create ────────────────────────────────────────────────────────────────
  const handleCreateClick = useCallback(() => {
    setEditingNewsletter(null);
    setShowCreateModal(true);
  }, []);

  const handleCreateSuccess = useCallback(() => {
    handleMutated();
  }, [handleMutated]);

  // ── Edit ──────────────────────────────────────────────────────────────────
  const handleEdit = useCallback((row) => {
    setEditingNewsletter(row);
    setShowCreateModal(true);
  }, []);

  const handleEditSuccess = useCallback(() => {
    handleMutated();
  }, [handleMutated]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback((row) => {
    setConfirmDialog({
      open: true,
      title: "Envoyer la newsletter",
      message: `Êtes-vous sûr de vouloir envoyer "${row.title}" à tous vos clients abonnés ? Cette action est irréversible.`,
      danger: false,
      confirmLabel: "Envoyer",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        setLoading(true);
        try {
          const result = await sendNewsletter(row.id);
          if (result.success) {
            toast.success(result.message);
            updateLocalData(row.id, {
              status: "SENT",
              sentAt: new Date().toISOString(),
              recipientCount: result.recipientCount,
            });
            handleMutated();
          } else {
            toast.error(result.message);
          }
        } catch (err) {
          toast.error(err.message);
        } finally {
          setLoading(false);
        }
      },
    });
  }, [updateLocalData, handleMutated]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback((row) => {
    setConfirmDialog({
      open: true,
      title: "Supprimer la newsletter",
      message: `Êtes-vous sûr de vouloir supprimer "${row.title}" ? Cette action est irréversible.`,
      danger: true,
      confirmLabel: "Supprimer",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        setLoading(true);
        try {
          const result = await deleteNewsletter(row.id);
          if (result.success) {
            toast.success(result.message);
            removeLocalData(row.id);
            handleMutated();
          } else {
            toast.error(result.message);
          }
        } catch (err) {
          toast.error(err.message);
        } finally {
          setLoading(false);
        }
      },
    });
  }, [removeLocalData, handleMutated]);

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const searchFilter = useCallback((row, query) => {
    const q = query.toLowerCase();
    return (
      row.title?.toLowerCase().includes(q) ||
      row.subject?.toLowerCase().includes(q) ||
      row.status?.toLowerCase().includes(q)
    );
  }, []);

  return (
    <>
      {/* View modal */}
      <NewsletterViewModal
        newsletter={viewingNewsletter}
        open={!!viewingNewsletter}
        onClose={() => setViewingNewsletter(null)}
      />

      {/* Create/Edit modal */}
      <NewsletterCreateEditModal
        open={showCreateModal}
        newsletter={editingNewsletter}
        serverAction={
          editingNewsletter
            ? (formData) => updateNewsletter(editingNewsletter.id, formData)
            : createNewsletter
        }
        onClose={() => {
          setShowCreateModal(false);
          setEditingNewsletter(null);
        }}
        onSuccess={editingNewsletter ? handleEditSuccess : handleCreateSuccess}
      />

      {/* Confirmation dialog (for send and delete) */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel="Annuler"
        danger={confirmDialog.danger}
        loading={loading}
        onConfirm={confirmDialog.onConfirm || (() => {})}
        onCancel={closeConfirmDialog}
      />

      <DataTable
        data={data}
        isLoading={loading}
        columns={NEWSLETTER_COLUMNS}
        renderRow={(props) => <NewsletterRow {...props} />}
        emptyState={NewsletterEmptyState}
        searchPlaceholder="Rechercher par titre, objet, statut..."
        searchFilter={searchFilter}
        onView={handleView}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onApprove={handleSend}
      />

      {/* Floating action button to create */}
      <button
        type="button"
        onClick={handleCreateClick}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#2f3a2e] text-white shadow-lg transition-all hover:bg-[#3d4e3a] hover:shadow-xl hover:scale-105"
        aria-label="Nouvelle newsletter"
        title="Créer une newsletter"
      >
        <MailPlus size={24} />
      </button>
    </>
  );
}