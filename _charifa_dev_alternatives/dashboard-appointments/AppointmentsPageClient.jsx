"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { AppointmentRow } from "./AppointmentRow";
import { confirmAppointment } from "@/actions/appointment/manage-appointment";
import { rejectAppointment } from "@/actions/appointment/manage-appointment";
import { getAllAppointments } from "@/actions/appointment/get-all-appointments";

// ─── Column definitions ───────────────────────────────────────────────────────

const APPOINTMENTS_COLUMNS = [
  { key: "customerName", label: "Client" },
  { key: "serviceName", label: "Service" },
  { key: "staffName", label: "Prestataire" },
  { key: "date", label: "Date" },
  { key: "startTime", label: "Horaire" },
  { key: "status", label: "Statut" },
];

// ─── Search filter ────────────────────────────────────────────────────────────

function appointmentSearchFilter(row, query) {
  return (
    row.customerName?.toLowerCase().includes(query) ||
    row.customerEmail?.toLowerCase().includes(query) ||
    row.serviceName?.toLowerCase().includes(query) ||
    row.staffName?.toLowerCase().includes(query)
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Client shell for the "Tous les rendez-vous" dashboard page.
 *
 * Handles inline Confirm / Cancel actions on PENDING rows with:
 *  - Optimistic UI update (status flips immediately in local state)
 *  - Server action call via useTransition
 *  - Toast feedback (sonner)
 *  - Full data re-fetch on success to stay in sync
 *
 * @param {{ initialAppointments: Array<object> }} props
 */
export function AppointmentsPageClient({ initialAppointments }) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [isPending, startTransition] = useTransition();

  // ── Optimistic helpers ────────────────────────────────────────────────────

  function patchStatus(id, status) {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a)),
    );
  }

  // Re-fetch the full list from the server and replace local state
  function refreshFromServer() {
    startTransition(async () => {
      const result = await getAllAppointments();
      if (result.success) {
        setAppointments(result.data ?? []);
      }
    });
  }

  // ── Action handlers ───────────────────────────────────────────────────────

  async function handleConfirm(row) {
    // Optimistic flip
    patchStatus(row.id, "CONFIRMED");

    const result = await confirmAppointment(row.id);

    if (result.success) {
      toast.success(result.message ?? "Rendez-vous confirmé.");
      refreshFromServer();
    } else {
      // Rollback
      patchStatus(row.id, "PENDING");
      toast.error(result.message ?? "Impossible de confirmer ce rendez-vous.");
    }
  }

  async function handleCancel(row) {
    // Optimistic flip
    patchStatus(row.id, "CANCELLED");

    const result = await rejectAppointment(row.id);

    if (result.success) {
      toast.success(result.message ?? "Rendez-vous annulé.");
      refreshFromServer();
    } else {
      // Rollback
      patchStatus(row.id, "PENDING");
      toast.error(result.message ?? "Impossible d'annuler ce rendez-vous.");
    }
  }

  // Stub — wired up when the detail modal is implemented
  function handleView(row) {
    // TODO: open appointment detail drawer/modal
    console.log("View appointment", row.id);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DataTable
      data={appointments}
      isLoading={isPending}
      columns={APPOINTMENTS_COLUMNS}
      renderRow={(props) => (
        <AppointmentRow
          {...props}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onView={handleView}
        />
      )}
      searchPlaceholder="Rechercher par client, service ou prestataire..."
      searchFilter={appointmentSearchFilter}
    />
  );
}
