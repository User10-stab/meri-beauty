"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "@/components/dashboard/Tables/DataTable";
import { RentalRequestRow } from "./RentalRequestRow";
import { RentalRequestEmptyState } from "./RentalRequestEmptyState";
import { RentalRequestDetailsModal } from "./RentalRequestDetailsModal";
import { CreateStaffModal } from "@/components/dashboard/staff/CreateStaffModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { createStaffFromRental } from "@/actions/staff/create-staff-from-rental";

/** `<input type="date">` needs a plain YYYY-MM-DD value — the request's
 * dates come back from the server as ISO datetime strings. */
function toDateInputValue(value) {
  if (!value) return "";
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.slice(0, 10);
}

const COLUMNS = [
  { key: "rentalType", label: "Type" },
  { key: "user", label: "Utilisateur" },
  { key: "period", label: "Période" },
  { key: "status", label: "Statut" },
  { key: "message", label: "Message" },
  { key: "createdAt", label: "Date de création" },
];

/**
 * Client shell for the rental requests page.
 * Handles view, approve, reject, and delete actions.
 */
export function RentalRequestsPageClient({ initialData, services = [] }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showCreateStaff, setShowCreateStaff] = useState(false);
  const approvingRef = useRef(null);

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

  /** Updates a single rental request in local state (e.g. after status change). */
  const updateLocalRequest = useCallback((id, updates) => {
    setData((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  const handleView = useCallback((row) => {
    setSelectedRequest(row);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setSelectedRequest(null);
  }, []);

  // ─── Approve flow ────────────────────────────────────────────────────
  const handleApprove = useCallback((row) => {
    approvingRef.current = row;
    setShowCreateStaff(true);
  }, []);

  const handleStaffCreated = useCallback(() => {
    const pending = approvingRef.current;
    if (!pending) {
      console.warn("[handleStaffCreated] No pending approval request found.");
      return;
    }

    updateLocalRequest(pending.id, { status: "APPROVED" });
    handleMutated();
  }, [handleMutated, updateLocalRequest]);

  const handleCloseCreateStaff = useCallback(() => {
    setShowCreateStaff(false);
    approvingRef.current = null;
  }, []);

  // ─── Reject flow ─────────────────────────────────────────────────────
  const handleReject = useCallback(
    (row) => {
      setConfirmDialog({
        open: true,
        title: "Rejeter la demande",
        message: `Êtes-vous sûr de vouloir rejeter la demande de location "${row.rentalType}" ? Cette action est irréversible.`,
        danger: true,
        confirmLabel: "Rejeter",
        onConfirm: async () => {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
          try {
            setLoading(true);
            const response = await fetch(`/api/rental-requests/${row.id}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ status: "REJECTED" }),
            });

            if (!response.ok) {
              throw new Error(`Erreur HTTP: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
              toast.success("Demande rejetée.");
              updateLocalRequest(row.id, { status: "REJECTED" });
              handleMutated();
            } else {
              toast.error(result.message || "Erreur lors du rejet");
            }
          } catch (err) {
            toast.error(err.message);
          } finally {
            setLoading(false);
          }
        },
      });
    },
    [handleMutated, updateLocalRequest]
  );

  // ─── Delete flow ─────────────────────────────────────────────────────
  const handleDelete = useCallback(
    (row) => {
      setConfirmDialog({
        open: true,
        title: "Supprimer la demande",
        message: `Êtes-vous sûr de vouloir supprimer la demande de location "${row.rentalType}" ? Cette action est irréversible.`,
        danger: true,
        confirmLabel: "Supprimer",
        onConfirm: async () => {
          setConfirmDialog((prev) => ({ ...prev, open: false }));
          try {
            setLoading(true);
            const response = await fetch(`/api/rental-requests/${row.id}`, {
              method: "DELETE",
            });

            if (!response.ok) {
              throw new Error(`Erreur HTTP: ${response.status}`);
            }

            toast.success("Demande supprimée.");
            handleMutated();
          } catch (err) {
            toast.error(err.message);
          } finally {
            setLoading(false);
          }
        },
      });
    },
    [handleMutated]
  );

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const searchFilter = useCallback((row, query) => {
    const q = query.toLowerCase();
    return (
      row.id?.toLowerCase().includes(q) ||
      row.rentalType?.toLowerCase().includes(q) ||
      row.message?.toLowerCase().includes(q) ||
      row.status?.toLowerCase().includes(q) ||
      row.user?.fullName?.toLowerCase().includes(q) ||
      row.user?.email?.toLowerCase().includes(q)
    );
  }, []);

  return (
    <>
      <RentalRequestDetailsModal
        rentalRequest={selectedRequest}
        open={modalOpen}
        onClose={handleCloseModal}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      {/* Create Staff modal — shown when Approve is clicked */}
      {showCreateStaff && approvingRef.current && (
        <CreateStaffModal
          services={services}
          onClose={handleCloseCreateStaff}
          onSuccess={handleStaffCreated}
          serverAction={(data) => createStaffFromRental(data, approvingRef.current.id)}
          initialValues={{
            fullName: approvingRef.current.user?.fullName ?? "",
            email: approvingRef.current.user?.email ?? "",
            phone: approvingRef.current.user?.phone ?? "",
            // Prefill the applicant's registered address — the admin can
            // still correct it, and it is what the rental invoice prints.
            addressLine1: approvingRef.current.user?.addressLine1 ?? "",
            addressLine2: approvingRef.current.user?.addressLine2 ?? "",
            addressCity: approvingRef.current.user?.addressCity ?? "",
            addressPostalCode: approvingRef.current.user?.addressPostalCode ?? "",
            addressCountry: approvingRef.current.user?.addressCountry ?? "BE",
            // The applicant already chose these on their rental request —
            // re-asking the admin to retype them from scratch is how a
            // start date silently drifts from what was actually agreed.
            contract: {
              startDate: toDateInputValue(approvingRef.current.startDate),
            },
          }}
        />
      )}

      {/* Confirmation dialog for reject and delete */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel || "Confirmer"}
        cancelLabel="Annuler"
        danger={confirmDialog.danger}
        loading={loading}
        onConfirm={confirmDialog.onConfirm || (() => {})}
        onCancel={closeConfirmDialog}
      />

      <DataTable
        data={data}
        isLoading={loading}
        columns={COLUMNS}
        renderRow={RentalRequestRow}
        emptyState={RentalRequestEmptyState}
        searchPlaceholder="Rechercher par type, message, statut..."
        searchFilter={searchFilter}
        onView={handleView}
        onApprove={handleApprove}
        onReject={handleReject}
        onDelete={handleDelete}
      />
    </>
  );
}
